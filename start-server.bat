@echo off
title MiniBlynk IoT Server
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%
echo ======================================================
echo   Starting MiniBlynk IoT Server...
echo ======================================================
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
node server.js
pause
