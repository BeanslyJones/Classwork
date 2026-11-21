@echo off
rem Amann Assault: start NATS + game server + weather service, each in its own window.
rem Put nats-server.exe in this folder (next to this file), or have it on your PATH.
cd /d "%~dp0"

where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org & pause & exit /b 1)

if not exist "node_modules\nats" (
  echo Installing the NATS package for Node (first run only)...
  call npm install || (echo npm install failed. & pause & exit /b 1)
)

set NATS_EXE=
if exist "%~dp0nats-server.exe" set NATS_EXE=%~dp0nats-server.exe
if not defined NATS_EXE for /f "delims=" %%i in ('where nats-server 2^>nul') do if not defined NATS_EXE set NATS_EXE=%%i
if not defined NATS_EXE (
  echo Could not find nats-server.exe. Copy it into this folder: %~dp0
  pause & exit /b 1
)

tasklist /fi "imagename eq nats-server.exe" | find /i "nats-server.exe" >nul
if errorlevel 1 (
  start "NATS" "%NATS_EXE%"
  timeout /t 2 >nul
) else (
  echo NATS is already running.
)

start "Amann Assault server" cmd /k "set BUS=nats://localhost:4222&& set WEATHER=external&& node prototypes\02-combat\server.js"
timeout /t 2 >nul
start "Amann Assault weather" cmd /k "set BUS=nats://localhost:4222&& node prototypes\02-combat\weather-service.js"

echo.
echo Started. Open http://localhost:8080 to play, http://localhost:8080/perf.html for the load page.
echo Close the three windows to stop.
pause
