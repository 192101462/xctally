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
function Get-JdkMajor([string]$dir) {
    $m = [regex]::Match((Split-Path $dir -Leaf), '(\d+)')
    if ($m.Success) { return [int]$m.Groups[1].Value }
    return 0
}

$jdkRoot = ''
$found = @()

if ($JavaHome) {
    if (-not (Test-Jdk $JavaHome)) { throw "-JavaHome does not look like a JDK root (no bin\java.exe): $JavaHome" }
    $jdkRoot = $JavaHome
} else {
    if ($env:JAVA_HOME) {
        if (Test-Jdk $env:JAVA_HOME) {
            $jdkRoot = $env:JAVA_HOME
            Write-Host "[2/2] using JAVA_HOME = $jdkRoot" -ForegroundColor DarkGray
        } else {
            Write-Host "[2/2] JAVA_HOME is invalid, ignoring it: $env:JAVA_HOME" -ForegroundColor Yellow
            Write-Host "      (must be a JDK root like ...\jbr or ...\.jdks\ms-17.0.20 - not its bin folder)" -ForegroundColor Yellow
        }
    }

    if (-not $jdkRoot) {
        $probe = @(
            (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'),
            (Join-Path ${env:ProgramFiles(x86)} 'Android\Android Studio\jbr'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr'),
            (Join-Path $env:LOCALAPPDATA 'Android\Android Studio\jbr')
        )

        # JDKs downloaded by Android Studio live in %USERPROFILE%\.jdks\<vendor-version>
        # (ms-17.0.20, corretto-21..., jbr-17...). This is the usual place, so scan it.
        $profiles = @()
        if ($env:USERPROFILE) { $profiles += $env:USERPROFILE }
        $userRoot = Split-Path -Parent $env:USERPROFILE
        if ($userRoot -and (Test-Path $userRoot)) {
            # fallback: profiles other than the current one (seen on renamed/cloned machines)
            Get-ChildItem $userRoot -Directory -ErrorAction SilentlyContinue |
                ForEach-Object { if ($profiles -notcontains $_.FullName) { $profiles += $_.FullName } }
        }
        foreach ($p in $profiles) {
            $dotJdks = Join-Path $p '.jdks'
            if (Test-Path $dotJdks) {
                Get-ChildItem $dotJdks -Directory -ErrorAction SilentlyContinue |
                    ForEach-Object { $probe += $_.FullName }
            }
        }

        foreach ($base in @(
            (Join-Path $env:ProgramFiles 'Java'),
            (Join-Path $env:ProgramFiles 'Eclipse Adoptium'),
            (Join-Path $env:ProgramFiles 'Microsoft')
        )) {
            if (Test-Path $base) {
                Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    $probe += $_.FullName
                    $probe += (Join-Path $_.FullName 'jbr')
                }
            }
        }

        $found = @($probe | Where-Object { Test-Jdk $_ } | Select-Object -Unique)

        if ($found.Count -gt 0) {
            # Highest version first; entries with no version in the name (jbr) count as modern.
            $best = $found |
                ForEach-Object { [pscustomobject]@{ Path = $_; Major = (Get-JdkMajor $_) } } |
                Sort-Object -Property @{ Expression = { if ($_.Major -eq 0) { 17 } else { $_.Major } } } -Descending |
                Select-Object -First 1
            $jdkRoot = $best.Path
            $label = if ($best.Major -eq 0) { 'bundled JBR' } else { 'JDK ' + $best.Major }
            Write-Host "[2/2] JAVA_HOME -> $jdkRoot  ($label)" -ForegroundColor DarkGray
            if ($best.Major -ne 0 -and $best.Major -lt 17) {
                Write-Host "[2/2] WARNING: that JDK is older than 17 and the build will likely fail." -ForegroundColor Yellow
                Write-Host "      Pick a JDK 17+ in Android Studio: Settings - Build Tools - Gradle - Gradle JDK." -ForegroundColor Yellow
            }
        }
    }
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

# If installDebug failed it is almost always "No connected devices" - the build and
# packaging already succeeded by then. Produce the APK anyway so the run is not wasted.
if ($rc -ne 0 -and $Mode -eq 'install') {
    Write-Host ""
    Write-Host "installDebug failed - building the APK instead so you still get something usable" -ForegroundColor Yellow
    Push-Location $dst
    try {
        & $gradlew assembleDebug
        $rc2 = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    $apk = Join-Path $dst 'app\build\outputs\apk\debug\app-debug.apk'
    if ($rc2 -eq 0) {
        $rc = 0
        $script:apkOnly = $true
        # look for whatever was actually produced (the path can differ, e.g. with flavors)
        if (Test-Path $apk) {
            $script:apkFound = $apk
        } else {
            $found = Get-ChildItem (Join-Path $dst 'app\build\outputs\apk') -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($found) { $script:apkFound = $found.FullName }
        }
    }
}
$sw.Stop()

Write-Host ""
$apkPath = Join-Path $dst 'app\build\outputs\apk\debug\app-debug.apk'
if ($rc -eq 0) {
    if ($Mode -eq 'apk' -or $script:apkOnly) {
        Write-Host ("BUILD OK in {0:N0}s" -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green
        if ($script:apkOnly) {
            Write-Host "Nothing was installed - adb saw no device." -ForegroundColor Yellow
        }
        $shown = if ($script:apkFound) { $script:apkFound } elseif (Test-Path $apkPath) { $apkPath } else { '' }
        if ($shown) {
            Write-Host "APK ready - copy it to the phone and tap to install:" -ForegroundColor Cyan
            Write-Host "  $shown" -ForegroundColor Cyan
        } else {
            Write-Host "Look for the .apk under: app\build\outputs\apk\" -ForegroundColor Yellow
        }
    } else {
        Write-Host ("BUILD OK in {0:N0}s" -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green
        Write-Host "Installed on the connected device." -ForegroundColor Cyan
    }
} else {
    Write-Host ("BUILD FAILED (exit {0}) - see the Gradle output above." -f $rc) -ForegroundColor Red
    if ($Mode -eq 'install') {
        Write-Host "If it says 'no connected devices', plug the phone into THIS machine and enable" -ForegroundColor Yellow
        Write-Host "USB debugging, or run with -Mode apk to just produce the APK file." -ForegroundColor Yellow
    }
}

exit $rc
