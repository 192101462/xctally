# Sync the web app into an Android project, then build and install it.
#
# Run this ON THE MACHINE THAT HAS ANDROID STUDIO (the remote desktop box).
#
# Usage:
#   tools\push-to-android.cmd -Project "D:\AndroidStudioProjects\XCNote"
#   tools\push-to-android.cmd -Project "D:\AndroidStudioProjects\XCNote" -Mode apk
#
# Params:
#   -Project   path to the Android Studio project (required)
#   -Mode      install (default) = build + install to the connected phone
#              apk              = build a debug APK only, no phone needed
#   -SkipSync  do not copy the web app, only build
#
# ASCII-only and no BOM on purpose (see copy-into-android-project.ps1).

param(
    [Parameter(Mandatory = $true)][string]$Project,
    [ValidateSet('install', 'apk')][string]$Mode = 'install',
    [switch]$SkipSync
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $Project)) { throw "Project folder not found: $Project" }
$dst = (Resolve-Path $Project).Path

Write-Host "=== xcnote push ===" -ForegroundColor Cyan
Write-Host "repo   : $root"
Write-Host "project: $dst"
Write-Host "mode   : $Mode"
Write-Host ""

# ---------------------------------------------------------------- 1. sync web app
if ($SkipSync) {
    Write-Host "[1/2] sync skipped (-SkipSync)" -ForegroundColor DarkGray
} else {
    Write-Host "[1/2] syncing web app + shell files" -ForegroundColor White
    & (Join-Path $PSScriptRoot 'copy-into-android-project.ps1') -Project $dst
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "copy step failed (exit $LASTEXITCODE)" }
}

# ---------------------------------------------------------------- 2. gradle
# gradlew.bat needs JAVA_HOME. When you run it from Android Studio it inherits
# the IDE's JDK, but from a plain shell it does not - so point it at the JDK that
# ships with Android Studio.
if (-not $env:JAVA_HOME) {
    $cands = @(
        (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr'),
        "$env:ProgramFiles\Android\Android Studio\jbr"
    )
    foreach ($c in $cands) {
        if ($c -and (Test-Path (Join-Path $c 'bin\java.exe'))) {
            $env:JAVA_HOME = $c
            Write-Host "[2/2] JAVA_HOME -> $c" -ForegroundColor DarkGray
            break
        }
    }
}

$gradlew = Join-Path $dst 'gradlew.bat'
if (-not (Test-Path $gradlew)) { throw "gradlew.bat not found in $dst" }

$task = if ($Mode -eq 'apk') { 'assembleDebug' } else { 'installDebug' }
Write-Host "[2/2] running  gradlew $task" -ForegroundColor White
Write-Host ""

$sw = [System.Diagnostics.Stopwatch]::StartNew()
Push-Location $dst
try {
    & $gradlew $task
    $rc = $LASTEXITCODE
} finally {
    Pop-Location
}
$sw.Stop()

Write-Host ""
if ($rc -eq 0) {
    Write-Host ("BUILD OK in {0:N0}s" -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green
    if ($Mode -eq 'apk') {
        $apk = Join-Path $dst 'app\build\outputs\apk\debug\app-debug.apk'
        if (Test-Path $apk) {
            Write-Host "APK: $apk" -ForegroundColor Cyan
        } else {
            Write-Host "APK expected at: $apk" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Installed on the connected device." -ForegroundColor Cyan
    }
} else {
    Write-Host ("BUILD FAILED (exit {0}) - see the Gradle output above." -f $rc) -ForegroundColor Red
    if ($Mode -eq 'install') {
        Write-Host "If it says 'no connected devices', plug the phone in and enable USB debugging," -ForegroundColor Yellow
        Write-Host "or use -Mode apk to just produce the APK file." -ForegroundColor Yellow
    }
}

exit $rc
