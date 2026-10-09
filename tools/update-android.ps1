# Pull the latest source, then sync + build + install the Android app.
#
# Run this ON THE MACHINE THAT HAS ANDROID STUDIO (the remote desktop box),
# after cloning the repo there once.
#
# Usage:
#   tools\update-android.cmd -Project "D:\AndroidStudioProjects\XCNote"
#   tools\update-android.cmd -Project "D:\AndroidStudioProjects\XCNote" -Mode apk
#
# It will NOT pull if the working tree has local changes - it prints them and
# stops, so nothing you edited on the build machine gets overwritten.
#
# ASCII-only and no BOM on purpose.

param(
    [Parameter(Mandatory = $true)][string]$Project,
    [ValidateSet('install', 'apk')][string]$Mode = 'install',
    [switch]$SkipPull
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$gitDir = Join-Path $root '.git'

# ---------------------------------------------------------------- 1. git pull
if ($SkipPull) {
    Write-Host "[git] pull skipped (-SkipPull)" -ForegroundColor DarkGray
} elseif (-not (Test-Path $gitDir)) {
    Write-Host "[git] this is not a git working copy, skipping pull" -ForegroundColor DarkGray
} else {
    $remote = (& git -C $root remote) 2>$null
    if (-not $remote) {
        Write-Host "[git] no remote configured, skipping pull" -ForegroundColor DarkGray
    } else {
        $dirty = (& git -C $root status --porcelain) 2>$null
        if ($dirty) {
            Write-Host "[git] local changes found - NOT pulling, so nothing is lost:" -ForegroundColor Yellow
            & git -C $root status --short
            Write-Host ""
            Write-Host "Commit or discard them, then run again. (Or pass -SkipPull to just build.)" -ForegroundColor Yellow
            Write-Host ""
        } else {
            Write-Host "[git] pulling from $remote ..." -ForegroundColor White
            & git -C $root pull --ff-only
            if ($LASTEXITCODE -ne 0) { throw "git pull failed (exit $LASTEXITCODE)" }
            Write-Host ("[git] HEAD = " + ((& git -C $root log -1 --oneline) -join '')) -ForegroundColor DarkGray
        }
    }
}

# ---------------------------------------------------------------- 2. sync + build
& (Join-Path $PSScriptRoot 'push-to-android.ps1') -Project $Project -Mode $Mode

exit $LASTEXITCODE
