@echo off
chcp 65001 >nul
title Conectar Microsoft OneDrive
node server\setup-onedrive.js
echo.
pause
