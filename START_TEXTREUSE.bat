@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title TEXTREUSE Viewer

echo Starting TEXTREUSE Viewer...
echo.

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys" >nul 2>nul
  if not errorlevel 1 (
    py -3 start_server.py
    goto :after
  )
)

where python >nul 2>nul
if not errorlevel 1 (
  python -c "import sys" >nul 2>nul
  if not errorlevel 1 (
    python start_server.py
    goto :after
  )
)

where python3 >nul 2>nul
if not errorlevel 1 (
  python3 -c "import sys" >nul 2>nul
  if not errorlevel 1 (
    python3 start_server.py
    goto :after
  )
)

where node >nul 2>nul
if not errorlevel 1 (
  node -e "process.exit(0)" >nul 2>nul
  if not errorlevel 1 (
    node start_server.js
    goto :after
  )
)

where powershell >nul 2>nul
if not errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_server.ps1"
  goto :after
)

echo ERROR: No supported local runtime was found.
echo Install Python 3, or upload this folder to GitHub Pages.

:after
if errorlevel 1 (
  echo.
  echo The viewer stopped with an error. The message above may explain why.
)
echo.
echo You can close this window when you are done.
pause
