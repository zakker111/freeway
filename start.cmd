@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node app.mjs
if errorlevel 1 pause
exit /b 0

:nonode
echo.
echo Node.js was not found on this computer.
echo Install the LTS version from https://nodejs.org/en/download and run this file again.
echo.
pause
exit /b 1
