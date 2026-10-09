# Copy xctally's Android shell files into an Android Studio project.
#
# Usage (from the repo root, cmd or PowerShell):
#     tools\copy-android.cmd -Project "C:\Users\you\AndroidStudioProjects\xctally"
#
# What it does automatically:
#   1. verifies the target really is an Android project
#   2. copies the web app (prototype/*) into app/src/main/assets/www
#   3. copies the shell files (manifest / MainActivity / ReminderWorker / file_paths)
#   4. removes every .kt that is NOT under com\qiyu\xctally
#   5. adds the three Gradle dependencies (keeps a .bak of the build file)
#   6. makes sure strings.xml contains app_name (merges, never clobbers)
#   7. checks minSdk
#
# This file is deliberately ASCII-only and has no BOM:
#   - a .ps1 without BOM is read with the system ANSI code page on Windows
#     PowerShell, so non-ASCII characters in string literals break parsing;
#   - some pwsh builds do not strip a UTF-8 BOM, which then corrupts the first token.
# ASCII + no BOM works on both Windows PowerShell 5.1 and PowerShell 7.

param(
    [Parameter(Mandatory = $true)][string]$Project
)

$ErrorActionPreference = 'Stop'

# --- .NET text helpers: explicit UTF-8, never add a BOM -------------------------
function Read-Text([string]$path) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}
function Write-Text([string]$path, [string]$text) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

$root = Split-Path -Parent $PSScriptRoot
$prototype = Join-Path $root 'prototype'
$shell = Join-Path $root 'apps\android'

if (-not (Test-Path $prototype)) { throw "Cannot find prototype/ next to tools/: $prototype" }
if (-not (Test-Path $Project)) { throw "Project folder not found: $Project" }

$dst = (Resolve-Path $Project).Path
$mainDir = Join-Path $dst 'app\src\main'
$manifest = Join-Path $mainDir 'AndroidManifest.xml'

if (-not (Test-Path $manifest)) {
    throw "This does not look like an Android project (no app\src\main\AndroidManifest.xml): $dst"
}

# ---------------------------------------------------------------- 0. detect package + app name
# Read the package name from the project itself instead of hardcoding it, so this
# script keeps working if the package is ever renamed. It also rewrites the
# `package` line of the Kotlin files to match, so the two can never drift apart.
$gradlePath = $null
foreach ($name in @('build.gradle.kts', 'build.gradle')) {
    $p = Join-Path $dst "app\$name"
    if (Test-Path $p) { $gradlePath = $p; break }
}
if ($gradlePath -eq $null) { throw "Cannot find app/build.gradle(.kts) in $dst" }

$gx = Read-Text $gradlePath
$pkg = ''
foreach ($re in @(
    'namespace\s*=\s*"([^"]+)"',
    'applicationId\s*=\s*"([^"]+)"',
    "namespace\s+['""]([^'""]+)",
    "applicationId\s+['""]([^'""]+)"
)) {
    $m = [regex]::Match($gx, $re)
    if ($m.Success) { $pkg = $m.Groups[1].Value; break }
}
if (-not $pkg) { $pkg = 'com.qiyu.xctally' }
$pkgPath = $pkg -replace '\.', '\'
$ktDir = Join-Path $mainDir "java\$pkgPath"

# Display name lives in tools/app-name.txt so this ASCII-only script can still
# write Chinese into the project.
$appNameFile = Join-Path $PSScriptRoot 'app-name.txt'
$appName = 'xctally'
if (Test-Path $appNameFile) {
    $v = (Read-Text $appNameFile).Trim()
    if ($v) { $appName = $v }
}

Write-Host "Target project: $dst" -ForegroundColor Cyan
Write-Host "Package       : $pkg" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------- backup policy
# NEVER leave *.bak inside res/ : the Android resource merger walks that tree and
# fails on any file that is not a recognised resource type
# ("The file name must end with .xml"). Keep backups in a dot-folder at the
# project root instead, and clean up anything older versions left behind.
$backupDir = Join-Path $dst '.xctally-backup'
function Backup-File([string]$path) {
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Force -Path $backupDir | Out-Null }
    Copy-Item $path (Join-Path $backupDir (Split-Path $path -Leaf)) -Force
}
$resRoot = Join-Path $mainDir 'res'
if (Test-Path $resRoot) {
    Get-ChildItem $resRoot -Recurse -File -Filter '*.bak' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ("  [clean]   " + $_.FullName.Replace($dst, '.') + "  (would break the resource merger)") -ForegroundColor Yellow
        Remove-Item $_.FullName -Force
    }
}
# legacy: older versions also dropped build.gradle.kts.bak next to the real file
foreach ($legacy in @("$dst\app\build.gradle.kts.bak", "$dst\app\build.gradle.bak")) {
    if (Test-Path $legacy) {
        if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Force -Path $backupDir | Out-Null }
        Move-Item $legacy (Join-Path $backupDir (Split-Path $legacy -Leaf)) -Force
        Write-Host ("  [clean]   " + $legacy.Replace($dst, '.') + "  (moved into .xctally-backup)") -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------- 1. web app
$webFiles = @(
    'index.html', 'styles.css', 'platform.js', 'data.js',
    'collect.js', 'backup.js', 'selftest.js', 'app.js'
)
$wwwDst = Join-Path $mainDir 'assets\www'
if (Test-Path $wwwDst) { Remove-Item $wwwDst -Recurse -Force }
New-Item -ItemType Directory -Force -Path $wwwDst | Out-Null

$copied = 0
foreach ($f in $webFiles) {
    $from = Join-Path $prototype $f
    if (-not (Test-Path $from)) { throw "Missing in prototype/: $f" }
    Copy-Item $from (Join-Path $wwwDst $f) -Force
    $copied++
}
Write-Host ("  [web]     assets\www  ({0} files)" -f $copied) -ForegroundColor Green

# ---------------------------------------------------------------- 2. shell sources
$pairs = @(
    @{ From = "$shell\app\src\main\AndroidManifest.xml";    To = "$manifest" },
    @{ From = "$shell\app\src\main\res\xml\file_paths.xml"; To = "$mainDir\res\xml\file_paths.xml" }
)
foreach ($p in $pairs) {
    if (-not (Test-Path $p.From)) { throw "Missing in repo: $($p.From)" }
    $dir = Split-Path -Parent $p.To
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Copy-Item $p.From $p.To -Force
    Write-Host ("  [src]     " + $p.To.Replace($dst, '.')) -ForegroundColor Green
}

# Kotlin sources: land them in the package folder the project actually uses,
# and pin the `package` line to the detected name.
foreach ($kt in @('MainActivity.kt', 'ReminderWorker.kt')) {
    $from = "$shell\app\src\main\java\com\qiyu\xctally\$kt"
    if (-not (Test-Path $from)) { throw "Missing in repo: $from" }
    if (-not (Test-Path $ktDir)) { New-Item -ItemType Directory -Force -Path $ktDir | Out-Null }
    $to = Join-Path $ktDir $kt
    Copy-Item $from $to -Force
    $body = Read-Text $to
    $body = [regex]::Replace($body, '(?m)^package\s+[\w.]+', "package $pkg")
    Write-Text $to $body
    Write-Host ("  [src]     " + $to.Replace($dst, '.')) -ForegroundColor Green
}

# ---------------------------------------------------------------- 3. drop template samples
# The template's own MainActivity.kt has the same file name as ours, so filter by folder.
$javaRoot = Join-Path $mainDir 'java'
if (Test-Path $javaRoot) {
    $ourPkg = $ktDir
    $junk = Get-ChildItem $javaRoot -Recurse -Filter '*.kt' | Where-Object {
        -not $_.FullName.StartsWith($ourPkg, [System.StringComparison]::OrdinalIgnoreCase)
    }
    foreach ($j in $junk) {
        Write-Host ("  [del]     " + $j.FullName.Replace($dst, '.')) -ForegroundColor Yellow
        Remove-Item $j.FullName -Force
    }
}

# ---------------------------------------------------------------- 4. strings.xml
# The template already generates res/values/strings.xml with app_name, so the only
# thing that can be missing is the file itself (rare). Never overwrite an existing one.
$stringsPath = Join-Path $mainDir 'res\values\strings.xml'
$stringsFallback = "$shell\app\src\main\res\values\strings.xml"
if (-not (Test-Path (Split-Path -Parent $stringsPath))) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stringsPath) | Out-Null
}
if (Test-Path $stringsPath) {
    $sx = Read-Text $stringsPath
    if ($sx -match 'name\s*=\s*"app_name"') {
        $before = $sx
        $sx = [regex]::Replace($sx, '(name\s*=\s*"app_name"\s*>\s*)([^<]*)(\s*</string>)',
            ('${1}' + $appName + '${3}'))
        if ($sx -eq $before) {
            Write-Host "  [strings] app_name already correct" -ForegroundColor Green
        } else {
            Backup-File $stringsPath
            Write-Text $stringsPath $sx
            Write-Host "  [strings] app_name value updated (backup in .xctally-backup)" -ForegroundColor Green
        }
    } else {
        Backup-File $stringsPath
        $sx = $sx -replace '(?s)</resources>',
            ('    <string name="app_name">' + $appName + '</string>' + "`r`n</resources>")
        Write-Text $stringsPath $sx
        Write-Host "  [strings] added app_name (backup in .xctally-backup)" -ForegroundColor Green
    }
} else {
    Copy-Item $stringsFallback $stringsPath -Force
    $sx = Read-Text $stringsPath
    $sx = [regex]::Replace($sx, '(name\s*=\s*"app_name"\s*>\s*)([^<]*)(\s*</string>)',
        ('${1}' + $appName + '${3}'))
    Write-Text $stringsPath $sx
    Write-Host "  [strings] no strings.xml found, created one from the repo copy" -ForegroundColor Yellow
}

# ---------------------------------------------------------------- 5. Gradle dependencies
$gradle = $gradlePath
if ($gradle -eq $null) {
    Write-Host "  [gradle]  no app/build.gradle(.kts) found, add dependencies manually" -ForegroundColor Yellow
} else {
    $deps = @(
        'implementation("androidx.appcompat:appcompat:1.7.0")',
        'implementation("androidx.webkit:webkit:1.12.1")',
        'implementation("androidx.work:work-runtime-ktx:2.9.1")'
    )
    $gx = Read-Text $gradle
    $missing = @()
    foreach ($d in $deps) {
        $coord = ($d -split '"')[1]
        $key = $coord -replace ':[0-9][0-9.]*$', ''
        if ($gx -notmatch [regex]::Escape($key)) { $missing += $d }
    }
    if ($missing.Count -eq 0) {
        Write-Host "  [gradle]  dependencies already present" -ForegroundColor Green
    } else {
        $m = [regex]::Match($gx, '(?m)^[ \t]*dependencies[ \t]*\{')
        if (-not $m.Success) {
            Write-Host "  [gradle]  no dependencies block found, add manually:" -ForegroundColor Yellow
            foreach ($d in $missing) { Write-Host "              $d" }
        } else {
            Backup-File $gradle
            $block = "`r`n" + (($missing | ForEach-Object { "    $_" }) -join "`r`n")
            $gx = $gx.Insert($m.Index + $m.Length, $block)
            Write-Text $gradle $gx
            Write-Host ("  [gradle]  added {0} dependency line(s) (backup in .xctally-backup)" -f `
                $missing.Count) -ForegroundColor Green
        }
    }

    # minSdk check: our code needs API 23+ (PendingIntent.FLAG_IMMUTABLE),
    # so the usual template default (24) is already fine.
    $ms = [regex]::Match($gx, 'minSdk\s*=?\s*(\d+)')
    if ($ms.Success) {
        $v = [int]$ms.Groups[1].Value
        if ($v -lt 23) {
            Write-Host ("  [gradle]  minSdk is {0}, please raise it to at least 23" -f $v) -ForegroundColor Yellow
        } else {
            Write-Host ("  [gradle]  minSdk = {0}, OK" -f $v) -ForegroundColor Green
        }
    }
}

Write-Host ""
Write-Host "All done. Back in Android Studio:" -ForegroundColor Cyan
Write-Host "  1. click 'Sync Now' (a yellow bar appears at the top)"
Write-Host "  2. connect your phone (developer mode + USB debugging)"
Write-Host "  3. press the green Run button"
Write-Host ""
Write-Host "To build an installable APK: Build > Build Bundle(s)/APK(s) > Build APK(s)" -ForegroundColor Cyan
