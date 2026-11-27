@echo off
rem Snorkeling pre-upgrade backup - double-clickable wrapper.
rem
rem Double-click: backs up to E:\backup (AI sessions index + instance DBs),
rem               then pauses so you can read the summary.
rem Command line (optional):
rem   backup-before-upgrade.cmd [destination] [label] [-DryRun]
rem   e.g.  backup-before-upgrade.cmd E:\backup pre-0.0.141
rem   dry-run preview: append -DryRun as the 3rd argument.
rem
rem Stop Snorkeling before running for the cleanest copy (the script warns
rem if it is still running).
setlocal
set "DEST=E:\backup"
if not "%~1"=="" set "DEST=%~1"
set "LABEL="
if not "%~2"=="" set "LABEL=-Label %~2"

echo Snorkeling backup-before-upgrade
echo Destination: %DEST%
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-before-upgrade.ps1" -Destination "%DEST%" %LABEL% %~3
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
    echo [OK] Backup finished.
) else (
    echo [FAILED] exit code %RC% - 1 = nothing to back up, 2 = copy error.
)
pause
endlocal & exit /b %RC%
