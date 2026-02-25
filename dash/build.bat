@echo off
title Startup Shell Dashboard — Build
echo.
echo  Building Startup Shell Dashboard...
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [!] Node.js is not installed or not on PATH.
    echo      Download it from https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo  Installing dependencies...
    npm install
    if %ERRORLEVEL% neq 0 (
        echo  [!] npm install failed.
        pause
        exit /b 1
    )
)

npm run build

if %ERRORLEVEL% == 0 (
    echo.
    echo  [OK] Build complete ^-^> dist/
    echo.
    echo  Run start.bat to serve the dashboard on port 6969.
) else (
    echo.
    echo  [!] Build failed.
)

echo.
pause
