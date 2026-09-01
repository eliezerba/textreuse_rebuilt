# Local start

## Windows

Double-click `START_TEXTREUSE.bat`.

The launcher tries, in order:

1. Python launcher (`py -3`)
2. `python`
3. `python3`
4. Node.js
5. built-in Windows PowerShell fallback

It opens the browser at a localhost address, normally `http://localhost:8765/`.

## macOS / Linux

Run:

```sh
./start_server.sh
```

or:

```sh
python3 start_server.py
```

Do not rely on double-clicking `index.html` with a `file://` URL. Browsers restrict fetching local JSON and Web Workers in that mode. Use the launcher/local server instead.
