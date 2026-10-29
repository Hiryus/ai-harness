# Links the harness directories to this repository, wherever it is cloned. Safe to run several times:
# a correct junction is kept, and a link elsewhere is replaced.
# An existing claude code or opencode installation is copied into the repository (its files never overwrite the repository's),
# then replaced by the junction and deleted.
# Junctions need no admin privileges, and hold absolute paths: they resolve through the `~/.claude` junction,
# where a relative symbolic link would be resolved from `~/.claude` itself.
$ErrorActionPreference = "Stop"

$Repository = $PSScriptRoot

# Copy the content of $Source into $Destination, keeping the files already there. Links are not followed.
function Copy-Missing([string]$Source, [string]$Destination) {
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        $target = Join-Path $Destination $item.Name
        if ($item.LinkType) {
            Write-Warning "not copied: $($item.FullName) is a link"
        } elseif ($item.PSIsContainer) {
            New-Item -ItemType Directory -Force $target | Out-Null
            Copy-Missing $item.FullName $target
        } elseif (Test-Path -LiteralPath $target) {
            Write-Host "kept:    $target (the installed one is discarded)"
        } else {
            Copy-Item -LiteralPath $item.FullName -Destination $target
        }
    }
}

# Make $Path a junction to $Target. With -Migrate, an existing directory is copied into $Target first, then deleted.
function Set-Junction([string]$Path, [string]$Target, [switch]$Migrate) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    $migrated = $null
    if ($null -ne $item -and $item.LinkType) {
        if (@($item.Target)[0] -eq $Target) {
            Write-Host "ok:      $Path -> $Target"
            return
        }
        # Deletes the link only, never the directory it points to (unlike `Remove-Item -Recurse` in Windows PowerShell).
        [System.IO.Directory]::Delete($Path)
        $action = "updated"
    } elseif ($null -ne $item -and $Migrate -and $item.PSIsContainer) {
        Copy-Missing $Path $Target
        # Moved aside rather than deleted right away: the installation is only deleted once the junction exists.
        $migrated = "$Path.migrated"
        Move-Item -LiteralPath $Path -Destination $migrated
        $action = "migrated"
    } elseif ($null -ne $item) {
        Write-Warning "skipped: $Path exists and is not a link, move it away and run again"
        return
    } else {
        $action = "created"
    }
    New-Item -ItemType Directory -Force (Split-Path -Parent $Path) | Out-Null
    New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null
    Write-Host "${action}: $Path -> $Target"
    if ($migrated) {
        # `rmdir /s` deletes the links it contains, never the directories they point to (unlike `Remove-Item -Recurse` in Windows PowerShell).
        cmd /c rmdir /s /q "$migrated"
        if ($LASTEXITCODE -ne 0) { throw "could not delete $migrated" }
        Write-Host "deleted: $migrated"
    }
}

# First, so that an installed `scripts` or `skills` is migrated into the shared directories.
Set-Junction "$Repository\claude\scripts" "$Repository\scripts"
Set-Junction "$Repository\claude\skills" "$Repository\skills"
Set-Junction "$HOME\.claude" "$Repository\claude" -Migrate
Set-Junction "$HOME\.config\opencode" "$Repository\opencode" -Migrate
