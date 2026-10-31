@echo off
setlocal
set NODE_ENV=production
if not defined HOST set HOST=127.0.0.1
if not defined PORT set PORT=4321
if not defined FREESPEAK_APP_DIR set FREESPEAK_APP_DIR=%~dp0
node "%~dp0dist\server\entry.mjs"
