@echo off
title MiniBlynk ESP8266 Simulator
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%
node simulator.js
pause
