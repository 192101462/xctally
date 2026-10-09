@echo off
rem ---------------------------------------------------------------
rem  xcnote - copy the HarmonyOS shell into a DevEco Studio project
rem
rem  Usage (from the repo root, cmd or PowerShell):
rem      tools\copy-harmony.cmd -Project "D:\DevEcoProjects\XCNote"
rem
rem  Why this wrapper exists:
rem    - the .ps1 needs an execution policy that allows scripts
rem    - "pwsh" only exists if PowerShell 7 is installed; Windows ships
rem      Windows PowerShell 5.1, whose command is "powershell"
rem  This picks whichever is available and bypasses the policy for this run only.
rem
rem  This file is ASCII-only on purpose (batch files are read with the
rem  system ANSI code page).
rem ---------------------------------------------------------------
setlocal

set "PS=powershell.exe"
where pwsh.exe >nul 2>nul && set "PS=pwsh.exe"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0copy-into-harmony-project.ps1" %*
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo [FAILED] exit code %RC%
)

endlocal & exit /b %RC%
