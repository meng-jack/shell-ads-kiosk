@echo off
title Startup Shell Dashboard — Dev Server
echo.
echo  [DEV ONLY] Starting Vite dev server on port 6969.
echo  In production, launcher.exe serves the built dash/ folder.
echo.
  echo  http://localhost:5173  (dev server — launcher runs on :6969)
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [!] Node.js is not installed or not on PATH.
    echo      Download it from https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo  Installing dependencies first...
    npm install
)

npm run dev
