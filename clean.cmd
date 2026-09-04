@echo off
rem Remove the installed plugin from a vault and install the built one fresh.
rem Unlike copy.bat this also deletes data.json (settings) and any device state
rem the plugin folder holds, so the plugin starts as on a new install.
rem
rem Usage:  clean.cmd [vault-path]     (vault resolution as in copy.bat)
setlocal
set "SRC=%~dp0native-file-editor"
call :resolve_vault "%~1" || exit /b 1
set "DST=%NFE_VAULT%\.obsidian\plugins\native-file-editor"

if not exist "%SRC%\main.js" (
  echo native-file-editor\main.js is missing; run npm run build first.
  exit /b 1
)
if exist "%DST%" rd /S /Q "%DST%"
if exist "%DST%" (
  echo Failed to remove "%DST%". Is Obsidian holding a file open?
  exit /b 1
)
md "%DST%"
for %%F in (main.js manifest.json styles.css) do (
  copy /Y "%SRC%\%%F" "%DST%\%%F" >nul || (echo Failed to copy %%F & exit /b 1)
)
echo Reinstalled into "%DST%" with no settings. Reload the plugin in Obsidian; re-enable it if it was disabled.
exit /b 0

:resolve_vault
if not "%~1"=="" set "NFE_VAULT=%~1"
if "%NFE_VAULT%"=="" if exist "%~dp0local.cmd" call "%~dp0local.cmd"
if "%NFE_VAULT%"=="" (
  echo Vault path unknown. Pass it as the first argument, set NFE_VAULT, or create local.cmd with: set NFE_VAULT=C:\path\to\vault
  exit /b 1
)
if not exist "%NFE_VAULT%\.obsidian" (
  echo "%NFE_VAULT%" has no .obsidian folder; is it a vault?
  exit /b 1
)
exit /b 0
