# Copy xctally's HarmonyOS shell files into a DevEco Studio project.
#
# Usage (run from anywhere):
#   pwsh tools/copy-into-harmony-project.ps1 -Project "D:\DevEcoProjects\xctally"
#
# What it does:
#   1. verifies the target really is a HarmonyOS project
#   2. copies the web app (prototype/*) into entry/src/main/resources/rawfile/www
#   3. copies Index.ets and QYBridge.ets
# It does NOT overwrite module.json5 (template field names may differ); it prints
# the snippet to paste instead.
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

$root = Split-Path -Parent $PSScriptRoot
$prototype = Join-Path $root 'prototype'
$shell = Join-Path $root 'apps\harmony'

if (-not (Test-Path $prototype)) { throw "Cannot find prototype/ next to tools/: $prototype" }
if (-not (Test-Path $Project)) { throw "Project folder not found: $Project" }

$dst = (Resolve-Path $Project).Path
$entryMain = Join-Path $dst 'entry\src\main'

if (-not (Test-Path $entryMain)) {
    throw "This does not look like a HarmonyOS project (no entry\src\main): $dst"
}

Write-Host "Target project: $dst" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------- backup policy
# Same rule as the Android side: never leave *.bak inside the resource tree
# (entry/src/main/resources), because the resource compiler walks it and chokes on
# unknown files. Keep backups in a dot-folder at the project root instead.
$backupDir = Join-Path $dst '.xctally-backup'
function Backup-File([string]$path) {
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Force -Path $backupDir | Out-Null }
    Copy-Item $path (Join-Path $backupDir (Split-Path $path -Leaf)) -Force
}
$resRoot = Join-Path $entryMain 'resources'
if (Test-Path $resRoot) {
    Get-ChildItem $resRoot -Recurse -File -Filter '*.bak' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ("  [clean]   " + $_.FullName.Replace($dst, '.') + "  (would break the resource compiler)") -ForegroundColor Yellow
        Remove-Item $_.FullName -Force
    }
}

# ---------------------------------------------------------------- 1. web app
# Do not hardcode the file list: sync every web asset in prototype/.
# (Hardcoding it once dropped items.js, and the app silently fell back to old code.)
$webFiles = Get-ChildItem $prototype -File | Where-Object {
    $_.Extension -in '.js', '.css', '.html'
}
$wwwDst = Join-Path $entryMain 'resources\rawfile\www'
if (Test-Path $wwwDst) { Remove-Item $wwwDst -Recurse -Force }
New-Item -ItemType Directory -Force -Path $wwwDst | Out-Null

$copied = 0
foreach ($f in $webFiles) {
    Copy-Item $f.FullName (Join-Path $wwwDst $f.Name) -Force
    $copied++
}
Write-Host ("  [web]  entry\src\main\resources\rawfile\www  ({0} files)" -f $copied) -ForegroundColor Green

# Safety net: every <script src> in index.html must actually exist in the target,
# otherwise the packaged app silently falls back to old code paths.
$htmlPath = Join-Path $wwwDst 'index.html'
if (Test-Path $htmlPath) {
    $html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)
    $missingRefs = @()
    foreach ($m in [regex]::Matches($html, 'src="([^"]+\.js)"')) {
        $name = $m.Groups[1].Value
        if ($name -notmatch '^https?:' -and -not (Test-Path (Join-Path $wwwDst $name))) {
            $missingRefs += $name
        }
    }
    if ($missingRefs.Count) {
        throw ("index.html references files that are not in rawfile\www: " + ($missingRefs -join ', '))
    }
    Write-Host "  [web]  all <script> referenced by index.html are present" -ForegroundColor Green
}

# ---------------------------------------------------------------- 2. ArkTS sources
$pairs = @(
    @{ From = "$shell\entry\src\main\ets\pages\Index.ets";     To = "$entryMain\ets\pages\Index.ets" },
    @{ From = "$shell\entry\src\main\ets\bridge\QYBridge.ets"; To = "$entryMain\ets\bridge\QYBridge.ets" }
)
foreach ($p in $pairs) {
    if (-not (Test-Path $p.From)) { throw "Missing in repo: $($p.From)" }
    $dir = Split-Path -Parent $p.To
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Copy-Item $p.From $p.To -Force
    Write-Host ("  [src]  " + $p.To.Replace($dst, '.')) -ForegroundColor Green
}

# ---------------------------------------------------------------- 3. string.json
# module.json5 references $string:reason_reminder, so the resource must exist or the
# build fails. Also set the launcher label from tools/app-name.txt (this script is
# ASCII-only, so the Chinese name lives in that file).
$appNameFile = Join-Path $PSScriptRoot 'app-name.txt'
$appName = 'xctally'
if (Test-Path $appNameFile) {
    $v = ([System.IO.File]::ReadAllText($appNameFile, [System.Text.Encoding]::UTF8)).Trim()
    if ($v) { $appName = $v }
}

$stringJson = Join-Path $entryMain 'resources\base\element\string.json'
if (-not (Test-Path $stringJson)) {
    Write-Host "  [strings] string.json not found - add these entries yourself:" -ForegroundColor Yellow
    Write-Host '            { "name": "reason_reminder", "value": "Reminder for item expiry dates" }'
} else {
    try {
        $raw = [System.IO.File]::ReadAllText($stringJson, [System.Text.Encoding]::UTF8)
        $obj = $raw | ConvertFrom-Json
        $names = @()
        foreach ($s in @($obj.string)) { $names += $s.name }

        $changed = $false

        # launcher label -> product name
        foreach ($s in @($obj.string)) {
            if ($s.name -eq 'EntryAbility_label' -and $s.value -ne $appName) {
                $s.value = $appName
                $changed = $true
            }
        }

        if ($names -notcontains 'reason_reminder') {
            $obj.string = @($obj.string) + [pscustomobject]@{
                name = 'reason_reminder'
                value = 'Reminder for item expiry dates'
            }
            $changed = $true
        }

        if (-not $changed) {
            Write-Host "  [strings] already up to date" -ForegroundColor Green
        } else {
            Backup-File $stringJson
            $json = $obj | ConvertTo-Json -Depth 10
            # Windows PowerShell escapes non-ASCII as \uXXXX; turn it back into real
            # characters so the file stays readable. Valid JSON either way.
            try {
                $json = [regex]::Replace($json, '\\u([0-9a-fA-F]{4})', {
                    param($m) [char][int]("0x" + $m.Groups[1].Value)
                })
            } catch { }
            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($stringJson, $json, $utf8NoBom)
            Write-Host "  [strings] label + reason_reminder set (backup in .xctally-backup)" -ForegroundColor Green
        }
    } catch {
        Write-Host ("  [strings] could not edit string.json ({0})" -f $_.Exception.Message) -ForegroundColor Yellow
        Write-Host '            add these entries yourself:' -ForegroundColor Yellow
        Write-Host '            { "name": "reason_reminder", "value": "Reminder for item expiry dates" }'
    }
}

Write-Host ""
Write-Host "Done. One manual edit left:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1) entry/src/main/module.json5 - add requestPermissions inside the module block:" -ForegroundColor White
Write-Host @'
     "requestPermissions": [
       {
         "name": "ohos.permission.PUBLISH_AGENT_REMINDER",
         "reason": "$string:reason_reminder",
         "usedScene": {
           "abilities": ["EntryAbility"],
           "when": "inuse"
         }
       }
     ]
'@
Write-Host "Then set up automatic signing (File - Project Structure - Signing Configs) and press Run." -ForegroundColor Cyan
