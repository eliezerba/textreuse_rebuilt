$ErrorActionPreference = 'Stop'

$rootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$datasetPath = Join-Path $rootPath 'dataset\Sefer_HaBahir-Genizah.json'

$raw = Get-Content -LiteralPath $datasetPath -Raw -Encoding UTF8
$obj = $raw | ConvertFrom-Json
$locs = New-Object 'System.Collections.Generic.HashSet[string]'

foreach ($p in $obj.PSObject.Properties) {
  foreach ($c in @($p.Value.candidates)) {
    $d = $c.alignment_details
    $loc = [string]$d.location
    $cat0 = [string](@($d.source_categories)[0])
    if ($cat0 -match 'geniza' -or $loc -match '^Geniza_') {
      [void]$locs.Add($loc)
    }
  }
}

$records = @()
foreach ($loc in $locs) {
  $alma = ([regex]::Match($loc, '(?:BIB_|Geniza_)(\d{12,22})', 'IgnoreCase')).Groups[1].Value
  $ie = ([regex]::Match($loc, 'IE(\d{4,})', 'IgnoreCase')).Groups[1].Value
  $fl = ([regex]::Match($loc, 'FL(\d{4,})', 'IgnoreCase')).Groups[1].Value
  $records += [pscustomobject]@{
    location = $loc
    alma = $alma
    ie = $ie
    fl = $fl
    parseOk = [bool]($alma -and $ie)
  }
}

$almaStates = @{}
foreach ($alma in ($records.alma | Where-Object { $_ } | Sort-Object -Unique)) {
  $url = "https://nli-proxy.avichai-levy.workers.dev/IIIFv21/DOCID/PNX_MANUSCRIPTS$alma-1/manifest"
  try {
    $m = Invoke-RestMethod -Uri $url -Method Get -ErrorAction Stop
    $canvasIds = @($m.sequences[0].canvases | ForEach-Object { [string]$_."@id" })
    $almaStates[$alma] = [pscustomobject]@{
      ok = $true
      code = 200
      canvases = $canvasIds
    }
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode.value__ } else { -1 }
    $almaStates[$alma] = [pscustomobject]@{
      ok = $false
      code = $code
      canvases = @()
    }
  }
}

$rows = foreach ($r in $records) {
  $st = $almaStates[$r.alma]
  $manifestOk = [bool]$st.ok
  $flInManifest = $false
  if ($manifestOk -and $r.fl) {
    $flInManifest = @($st.canvases | Where-Object { $_ -match ('FL' + [regex]::Escape($r.fl) + '$') }).Count -gt 0
  }

  [pscustomobject]@{
    location = $r.location
    alma = $r.alma
    ie = $r.ie
    fl = $r.fl
    parseOk = $r.parseOk
    manifestOk = $manifestOk
    manifestCode = if ($manifestOk) { 200 } else { $st.code }
    flInManifest = $flInManifest
  }
}

$summary = [pscustomobject]@{
  uniqueGenizaLocations = $rows.Count
  parseFailures = @($rows | Where-Object { -not $_.parseOk }).Count
  uniqueAlma = @($rows.alma | Where-Object { $_ } | Sort-Object -Unique).Count
  manifestFailures = @($rows | Where-Object { -not $_.manifestOk } | Select-Object -ExpandProperty alma -Unique).Count
  withoutFL = @($rows | Where-Object { -not $_.fl }).Count
  flNotInManifest = @($rows | Where-Object { $_.manifestOk -and $_.fl -and -not $_.flInManifest }).Count
}

$result = [pscustomobject]@{
  summary = $summary
  manifestFailureByAlma = @(
    $rows | Where-Object { -not $_.manifestOk } | Group-Object alma | ForEach-Object {
      [pscustomobject]@{
        alma = $_.Name
        count = $_.Count
        code = ($_.Group | Select-Object -First 1).manifestCode
      }
    }
  )
  parseFailures = @($rows | Where-Object { -not $_.parseOk } | Select-Object -First 20)
  flMismatchSamples = @($rows | Where-Object { $_.manifestOk -and $_.fl -and -not $_.flInManifest } | Select-Object -First 20)
}

$result | ConvertTo-Json -Depth 6
