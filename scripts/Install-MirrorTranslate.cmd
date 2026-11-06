@echo off
setlocal
chcp 65001 >nul
set "MIRRORTRANSLATE_NODE=%~dp0server-plugin\runtime\node.exe"
if not exist "%MIRRORTRANSLATE_NODE%" set "MIRRORTRANSLATE_NODE=node"
"%MIRRORTRANSLATE_NODE%" "%~dp0install-mirrortranslate.mjs" %*
set "MIRRORTRANSLATE_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %MIRRORTRANSLATE_EXIT%
