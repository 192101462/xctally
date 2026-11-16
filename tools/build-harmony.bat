@echo off
rem Build the HarmonyOS HAP from the command line (no IDE needed).
rem Prereq: DevEco Studio installed at D:\software\DevEco Studio (SDK + jbr + node).
rem Output: apps\harmony\entry\build\default\outputs\default\entry-default-unsigned.hap
rem Sign it in DevEco (Project Structure > Signing Configs) or via IDE Run to install.
setlocal
set "DEVECO=D:\software\DevEco Studio"
set "PATH=%DEVECO%\jbr\bin;%DEVECO%\tools\node;%PATH%"
set "JAVA_HOME=%DEVECO%\jbr"
set "DEVECO_SDK_HOME=%DEVECO%\sdk"
cd /d "%~dp0..\apps\harmony"
call hvigorw.bat --mode module -p product=default -p module=entry@default assembleHap --analyze=normal --no-daemon
endlocal
