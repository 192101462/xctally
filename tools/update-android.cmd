@echo off
rem ---------------------------------------------------------------
rem  xcnote - git pull, then sync the web app and build+install
rem
rem  Run this on the machine that has Android Studio:
rem
rem      tools\update-android.cmd -Project "D:\AndroidStudioProjects\XCNote"
rem      tools\update-android.cmd -Project "D:\AndroidStudioProjects\XCNote" -Mode apk
rem
rem  ASCII-only on purpose.
rem ---------------------------------------------------------------
setlocal

set "PS=powershell.exe"
where pwsh.exe >nul 2>nul && set "PS=pwsh.exe"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-android.ps1" %*
set "RC=%ERRORLEVEL%"

endlocal & exit /b %RC%
