@echo off
rem Copy the built plugin into a vault for a local check, replacing files in place.
rem Settings (data.json) and anything else in the plugin folder are kept.
rem
rem Usage:  copy.bat [vault-path]
rem The vault path comes from the argument, else from NFE_VAULT, else from
rem local.cmd next to this script (git-ignored; one line: set NFE_VAULT=...).
rem Run `npm run build` first: this copies native-file-editor\, which the build fills.
setlocal
set "SRC=%~dp0native-file-editor"
call :resolve_vault "%~1" || exit /b 1
set "DST=%NFE_VAULT%\.obsidian\plugins\native-file-editor"

if not exist "%SRC%\main.js" (
  echo native-file-editor\main.js is missing; run npm run build first.
  exit /b 1
)
if not exist "%DST%" md "%DST%"
for %%F in (main.js manifest.json styles.css) do (
  copy /Y "%SRC%\%%F" "%DST%\%%F" >nul || (echo Failed to copy %%F & exit /b 1)
)
echo Copied main.js, manifest.json, styles.css to "%DST%". Reload the plugin in Obsidian.
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
