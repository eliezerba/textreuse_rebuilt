@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py start_server.py
) else (
  python start_server.py
)

if errorlevel 1 (
  echo.
  echo The server could not start. Make sure Python is installed.
)
pause
