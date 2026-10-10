@echo off
rem One-time migration: make <repo>\apps\android the real Studio project.
rem Usage: tools\adopt-studio-project.cmd -Project "D:\AndroidStudioProjects\xctally" -Repo "D:\xcnote"
setlocal
set "PS=pwsh.exe"
where pwsh.exe >nul 2>nul || set "PS=powershell.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0adopt-studio-project.ps1" %*
exit /b %ERRORLEVEL%
