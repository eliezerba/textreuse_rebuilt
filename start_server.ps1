$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$StartPort = 8765
$EndPort = 8865

function Get-MimeType([string]$Path) {
    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.js' { 'text/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.jsonl' { 'application/x-ndjson; charset=utf-8' }
        '.ndjson' { 'application/x-ndjson; charset=utf-8' }
        '.svg' { 'image/svg+xml' }
        '.png' { 'image/png' }
        '.jpg' { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        default { 'application/octet-stream' }
    }
}

function Send-Response($Stream, [int]$Status, [string]$ContentType, [byte[]]$Body) {
    $reason = if ($Status -eq 200) { 'OK' } elseif ($Status -eq 404) { 'Not Found' } else { 'Error' }
    $header = "HTTP/1.1 $Status $reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store, max-age=0`r`nConnection: close`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($hb, 0, $hb.Length)
    if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
}

$Listener = $null
$Port = $null
for ($p = $StartPort; $p -le $EndPort; $p++) {
    try {
        $candidate = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $p)
        $candidate.Start()
        $Listener = $candidate
        $Port = $p
        break
    } catch { }
}
if (-not $Listener) { throw "Could not find a free port between $StartPort and $EndPort." }

$Url = "http://localhost:$Port/"
Write-Host 'TEXTREUSE Viewer is running.'
Write-Host "Open: $Url"
Write-Host 'Press Ctrl+C to stop the server.'
Start-Process $Url

try {
    while ($true) {
        $Client = $Listener.AcceptTcpClient()
        try {
            $Stream = $Client.GetStream()
            $Reader = New-Object IO.StreamReader($Stream, [Text.Encoding]::ASCII, $false, 4096, $true)
            $RequestLine = $Reader.ReadLine()
            if (-not $RequestLine) { continue }
            while (($line = $Reader.ReadLine()) -ne '') { if ($null -eq $line) { break } }
            $parts = $RequestLine.Split(' ')
            $rawTarget = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
            $uri = [Uri]("http://localhost" + $rawTarget)

            if ($uri.AbsolutePath -eq '/api/health') {
                $body = [Text.Encoding]::UTF8.GetBytes('{"ok":true}')
                Send-Response $Stream 200 'application/json; charset=utf-8' $body
                continue
            }
            if ($uri.AbsolutePath -eq '/api/json-files') {
                $files = @()
                Get-ChildItem -LiteralPath $Root -File | Where-Object { $_.Extension.ToLowerInvariant() -in @('.json','.jsonl','.ndjson') } | ForEach-Object {
                    $files += [ordered]@{ name=$_.Name; url=('/api/file?name=' + [Uri]::EscapeDataString($_.Name)); size=$_.Length; modified=[int][DateTimeOffset]$_.LastWriteTimeUtc.ToUnixTimeSeconds() }
                }
                $body = [Text.Encoding]::UTF8.GetBytes((@{files=$files} | ConvertTo-Json -Depth 5 -Compress))
                Send-Response $Stream 200 'application/json; charset=utf-8' $body
                continue
            }
            if ($uri.AbsolutePath -eq '/api/file') {
                $query = [Web.HttpUtility]::ParseQueryString($uri.Query)
                $name = [IO.Path]::GetFileName($query['name'])
                $full = Join-Path $Root $name
            } else {
                $rel = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
                if (-not $rel) { $rel = 'index.html' }
                $full = Join-Path $Root $rel
            }
            $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
            $resolved = [IO.Path]::GetFullPath($full)
            if (-not $resolved.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
                Send-Response $Stream 404 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Not found'))
                continue
            }
            $body = [IO.File]::ReadAllBytes($resolved)
            Send-Response $Stream 200 (Get-MimeType $resolved) $body
        } catch {
            try { Send-Response $Stream 500 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($_.Exception.Message)) } catch { }
        } finally {
            $Client.Close()
        }
    }
} finally {
    $Listener.Stop()
}
