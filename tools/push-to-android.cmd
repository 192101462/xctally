@echo off
rem ---------------------------------------------------------------
rem  xctally - sync the web app, then build + install to the phone
rem
rem  Run this on the machine that has Android Studio:
rem
rem      tools\push-to-android.cmd -Project "D:\AndroidStudioProjects\xctally"
rem      tools\push-to-android.cmd -Project "D:\AndroidStudioProjects\xctally" -Mode apk
rem
rem  It picks whichever PowerShell exists and bypasses the script policy
rem  for this run only. ASCII-only on purpose.
rem ---------------------------------------------------------------
setlocal

set "PS=powershell.exe"
where pwsh.exe >nul 2>nul && set "PS=pwsh.exe"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0push-to-android.ps1" %*
set "RC=%ERRORLEVEL%"

endlocal & exit /b %RC%
