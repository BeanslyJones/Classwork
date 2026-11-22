@echo off
rem Amann Assault: start NATS + game server + weather service, each in its own window.
rem Put nats-server.exe in this folder (next to this file), or have it on your PATH.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist "node_modules\nats" goto haveNats
echo Installing the NATS package for Node - first run only...
call npm install
if errorlevel 1 goto npmfail
:haveNats

set "NATS_EXE="
if exist "%~dp0nats-server.exe" set "NATS_EXE=%~dp0nats-server.exe"
if defined NATS_EXE goto foundExe
for /f "delims=" %%i in ('where nats-server 2^>nul') do set "NATS_EXE=%%i"
if not defined NATS_EXE goto noexe
:foundExe

tasklist /fi "imagename eq nats-server.exe" | find /i "nats-server.exe" >nul
if not errorlevel 1 goto natsRunning
start "NATS" "%NATS_EXE%"
timeout /t 2 >nul
goto startGame
:natsRunning
echo NATS is already running.

:startGame
start "Amann Assault server" cmd /k "set BUS=nats://localhost:4222&& set WEATHER=external&& node prototypes\02-combat\server.js"
timeout /t 2 >nul
start "Amann Assault weather" cmd /k "set BUS=nats://localhost:4222&& node prototypes\02-combat\weather-service.js"
echo.
echo Started. Open http://localhost:8080 to play, http://localhost:8080/perf.html for the load page.
echo Close the three windows to stop.
pause
goto :eof

:nonode
echo Node.js is not installed. Get the LTS version from https://nodejs.org
pause
goto :eof

:npmfail
echo npm install failed - see the messages above.
pause
goto :eof

:noexe
echo Could not find nats-server.exe. Copy it into this folder:
echo %~dp0
pause
goto :eof
