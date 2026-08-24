# Runs a queue of opencode tasks in order, unattended.
#
# opencode has no built-in queue: `opencode run` does one task and exits. This
# is the thin wrapper that turns "the next five packets" into one command you
# walk away from.
#
#   .\scripts\run-queue.ps1                 # run the default queue
#   .\scripts\run-queue.ps1 -WhatIf         # print what it would do, run nothing
#   .\scripts\run-queue.ps1 -From 3         # skip the first two entries
#
# Each entry runs to completion before the next starts. That is deliberate:
# packets in the queue depend on each other, and two agents editing the same
# working tree at once would corrupt both.
#
# Logs land in .opencode-runs/<timestamp>/NN-<label>.log, and the run stops on
# the first failure rather than pressing on into work whose prerequisite broke.

[CmdletBinding(SupportsShouldProcess)]
param(
    [int]$From = 1,
    [string]$Agent = 'harness-lead'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# The queue. Edit this list to change what runs — it is meant to be edited.
# Order here is the order in docs/tasks/README.md § Current priority.
$queue = @(
    @{ label = 'T16-parts-store'
       text  = 'Take T16 (docs/tasks/T16-parts-library-store.md) through the full loop: scout, implement, review, fix, re-review. Read its Traps section before starting - it introduces the projects first native module (better-sqlite3) and electron-builder.cjs currently assumes there are none. It is not done until a packaged build opens a library; a dev-mode run proves nothing. Stop and report when the reviewer says merge.' },

    @{ label = 'T17-versioning'
       text  = 'Take T17 (docs/tasks/T17-part-versioning.md) through scout, implement, review, fix, re-review. Needs T16. Pay attention to the no-op case: a save with no changes must not bump the version or write log rows. Stop and report when the reviewer says merge.' },

    @{ label = 'T18-sourcing'
       text  = 'Take T18 (docs/tasks/T18-procurement-sourcing.md) through scout, implement, review, fix, re-review. Needs T16. Null lead time means unknown and must not collapse to zero. Stop and report when the reviewer says merge.' },

    @{ label = 'T20-buffer-spools'
       text  = 'Take T20 (docs/tasks/T20-scrap-buffer-and-spools.md) through scout, implement, review, fix, re-review. Needs T16. The buffer applies per connection before summing, never after - a test must pin that. Stop and report when the reviewer says merge.' },

    @{ label = 'T19-resolution'
       text  = 'Take T19 (docs/tasks/T19-part-number-resolution.md) through scout, implement, review, fix, re-review. Needs T16 and T18. It carries forward the whole sync contract from the superseded T11 - read that packet too. Stop and report when the reviewer says merge.' }
)

$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir  = Join-Path $repo ".opencode-runs\$stamp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host ""
Write-Host "opencode queue - $($queue.Count) entries, starting at $From" -ForegroundColor Cyan
Write-Host "logs: $logDir"
Write-Host ""

for ($i = $From - 1; $i -lt $queue.Count; $i++) {
    $entry = $queue[$i]
    $n     = '{0:D2}' -f ($i + 1)
    $log   = Join-Path $logDir "$n-$($entry.label).log"

    Write-Host "[$n] $($entry.label)" -ForegroundColor Yellow

    if (-not $PSCmdlet.ShouldProcess($entry.label, 'opencode run')) {
        Write-Host "     would run: opencode run --agent $Agent --auto ..."
        continue
    }

    $started = Get-Date

    # Start-Process rather than the call operator: it keeps the very long
    # prompt out of PowerShell's argument mangling, and gives a real exit code.
    $p = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', "opencode run --agent $Agent --auto `"$($entry.text)`" > `"$log`" 2>&1" `
        -WorkingDirectory $repo -PassThru -Wait -WindowStyle Hidden

    $mins = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)

    if ($p.ExitCode -ne 0) {
        Write-Host "     FAILED after $mins min (exit $($p.ExitCode))" -ForegroundColor Red
        Write-Host "     $log"
        Write-Host ""
        Write-Host "Stopping. Later entries depend on this one." -ForegroundColor Red
        Write-Host "Fix, then resume with:  .\scripts\run-queue.ps1 -From $($i + 1)"
        exit 1
    }

    Write-Host "     done in $mins min" -ForegroundColor Green

    # Surface anything the run left uncommitted, so a stalled loop is visible
    # rather than discovered three packets later.
    $dirty = @(git status --porcelain)
    if ($dirty.Count -gt 0) {
        Write-Host "     $($dirty.Count) uncommitted file(s) left in the tree" -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host "Queue complete. Review the logs before merging anything:" -ForegroundColor Cyan
Write-Host "  $logDir"
Write-Host ""
Write-Host "Not yet done by any agent:" -ForegroundColor DarkYellow
Write-Host "  - T04's running-app check (needs eyes on a screen)"
Write-Host "  - T14 and T15, deliberately deferred behind this track"
