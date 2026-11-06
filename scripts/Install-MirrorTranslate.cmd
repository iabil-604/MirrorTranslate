@echo off
chcp 65001 >nul
"%~dp0server-plugin\runtime\node.exe" "%~dp0install-mirrortranslate.mjs" %*
set "MIRRORTRANSLATE_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %MIRRORTRANSLATE_EXIT%
