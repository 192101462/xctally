# Sync the web app into an Android project, then build and install it.
#
# Run this ON THE MACHINE THAT HAS ANDROID STUDIO (the remote desktop box).
#
# Usage:
#   tools\push-to-android.cmd -Project "D:\AndroidStudioProjects\xctally"
#   tools\push-to-android.cmd -Project "D:\AndroidStudioProjects\xctally" -Mode apk
#
# Params:
#   -Project   path to the Android Studio project (required)
#   -Mode      install (default) = build + install to the connected phone
#              apk              = build a debug APK only, no phone needed
#   -SkipSync  do not copy the web app, only build
#   -JavaHome  JDK root to use (optional; overrides a broken JAVA_HOME)
#
# ASCII-only and no BOM on purpose (see copy-into-android-project.ps1).

param(
    [Parameter(Mandatory = $true)][string]$Project,
    [ValidateSet('install', 'apk')][string]$Mode = 'install',
    [switch]$SkipSync,
    [string]$JavaHome = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $Project)) { throw "Project folder not found: $Project" }
$dst = (Resolve-Path $Project).Path

Write-Host "=== xctally push ===" -ForegroundColor Cyan
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
# gradlew.bat needs JAVA_HOME pointing at a JDK *root* (not its bin folder).
# A machine can have JAVA_HOME set to something broken - a leftover from another
# user profile or an uninstalled JDK - so never trust it without checking that
# <JAVA_HOME>\bin\java.exe actually exists. Fall back to the JDK that ships with
# Android Studio (JBR), which is always a modern JDK 17/21.
function Test-Jdk([string]$dir) {
    if (-not $dir) { return $false }
    return (Test-Path (Join-Path $dir 'bin\java.exe'))
}

# NOTE: do NOT name the local variable $javaHome - PowerShell variable names are
# case-insensitive, so it would silently clobber the -JavaHome parameter.
$jdkRoot = ''

if ($JavaHome) {
    if (Test-Jdk $JavaHome) { $jdkRoot = $JavaHome }
    else { throw "-JavaHome does not look like a JDK root (no bin\java.exe): $JavaHome" }
} elseif ($env:JAVA_HOME) {
    if (Test-Jdk $env:JAVA_HOME) {
        $jdkRoot = $env:JAVA_HOME
        Write-Host "[2/2] using JAVA_HOME = $jdkRoot" -ForegroundColor DarkGray
    } else {
        Write-Host "[2/2] JAVA_HOME is invalid, ignoring it: $env:JAVA_HOME" -ForegroundColor Yellow
        Write-Host "      (it must point at a JDK root, e.g. ...\Android Studio\jbr - not its bin folder)" -ForegroundColor Yellow
    }
}

if (-not $jdkRoot) {
    $cands = @(
        (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'),
        (Join-Path ${env:ProgramFiles(x86)} 'Android\Android Studio\jbr'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr'),
        (Join-Path $env:LOCALAPPDATA 'Android\Android Studio\jbr'),
        "$env:ProgramFiles\Android\Android Studio\jbr"
    )
    # also look for standalone JDKs under the usual vendors
    foreach ($base in @((Join-Path $env:ProgramFiles 'Java'), (Join-Path $env:ProgramFiles 'Eclipse Adoptium'), (Join-Path $env:ProgramFiles 'Microsoft'))) {
        if (Test-Path $base) {
            Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $cands += $_.FullName
                $cands += (Join-Path $_.FullName 'jbr')
            }
        }
    }
    foreach ($c in $cands) {
        if (Test-Jdk $c) { $jdkRoot = $c; break }
    }
    if ($jdkRoot) { Write-Host "[2/2] JAVA_HOME -> $jdkRoot" -ForegroundColor DarkGray }
}

if (-not $jdkRoot) {
    throw @"
No usable JDK found.
Fix one of these, then run again:
  1. pass it explicitly:   -JavaHome "C:\Program Files\Android\Android Studio\jbr"
  2. set the env var:      setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
                           (then open a NEW terminal - the old one keeps the old value)
  3. or just open the project in Android Studio and press Run.
Note: JAVA_HOME must be a JDK root (contains bin\java.exe), NOT the bin folder,
and it must be JDK 17 or newer for current Android Gradle Plugin versions.
"@
}
$env:JAVA_HOME = $jdkRoot

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
