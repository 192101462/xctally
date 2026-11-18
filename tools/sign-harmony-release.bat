@echo off
rem Build + release-sign the HarmonyOS HAP (distributable to any HarmonyOS phone).
rem
rem Prereq (one-time, already done):
rem   .sign\release\qiyu-release.p12   keystore (password: Qiyu@2026release)
rem   .sign\release\qiyu-release.cer         release cert from AGC
rem   .sign\release\qiyu-release-profile.p7b     release profile from AGC
rem
rem Why manual signing: hvigor only accepts DevEco-ENCRYPTED passwords (32+ chars)
rem in build-profile.json5, so the release material is signed here with the SDK's
rem hap-sign-tool using plain passwords instead.
rem Output: apps\harmony\entry\build\default\outputs\default\xctally-harmony-<ver>-signed.hap
setlocal
set "DEVECO=D:\software\DevEco Studio"
set "PROJ=D:\xcnote\apps\harmony"
set "VER=%~1"
if "%VER%"=="" set VER=dev

rem 1) build the unsigned hap (hvigor signs with debug material; we ignore that copy)
call "D:\xcnote\tools\build-harmony.bat" | findstr /C:"BUILD SUCCESSFUL"
if errorlevel 1 (
  echo [ERROR] build failed
  exit /b 1
)

rem 2) sign the unsigned hap with the release material (single line: cmd caret
rem    continuations misparse with LF line endings)
set "SIGNARGS=-mode localSign -keyAlias qiyuRelease -signAlg SHA256withECDSA -appCertFile %PROJ%\.sign\release\qiyu-release.cer -profileFile %PROJ%\.sign\release\qiyu-release-profile.p7b -inFile %PROJ%\entry\build\default\outputs\default\entry-default-unsigned.hap -keystoreFile %PROJ%\.sign\release\qiyu-release.p12 -keyPwd Qiyu@2026release -keystorePwd Qiyu@2026release -outFile %PROJ%\entry\build\default\outputs\default\xctally-harmony-%VER%-signed.hap -profileSigned 1"
"%DEVECO%\jbr\bin\java.exe" -jar "%DEVECO%\sdk\default\openharmony\toolchains\lib\hap-sign-tool.jar" sign-app %SIGNARGS%
if errorlevel 1 (
  echo [ERROR] signing failed
  exit /b 1
)
echo [OK] %PROJ%\entry\build\default\outputs\default\xctally-harmony-%VER%-signed.hap
endlocal
