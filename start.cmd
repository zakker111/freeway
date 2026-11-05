@echo off
setlocal
cd /d "%~dp0"

rem The Windows ZIP ships Freeway.exe; a source checkout has app.mjs.
rem One launcher has to work for both, so it prefers the executable.
if exist "Freeway.exe" (
  "Freeway.exe" %*
  if errorlevel 1 (
    pause
    exit /b 1
  )
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 goto missing
node app.mjs %*
if errorlevel 1 (
  pause
  exit /b 1
)
exit /b 0

:missing
echo.
echo Neither Freeway.exe nor Node.js was found in this folder.
echo Install the LTS version from https://nodejs.org/en/download and run this file again.
echo.
pause
exit /b 1
