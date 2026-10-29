@echo off
REM Cift tikla veya: baslat.bat   (Node.js 22.13 veya ustu gerekir)
cd /d "%~dp0"
node --no-warnings server.js
pause
