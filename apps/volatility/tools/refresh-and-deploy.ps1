param(
    [switch]$NoPush,
    [switch]$SkipReleaseTest
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$allowedFiles = @(
    "apps/volatility/data/local-nasdaq-snapshot.json",
    "apps/volatility/js/weekly-reference.generated.js"
)
$mutex = [System.Threading.Mutex]::new($false, "Local\PersonalTapVolatilityRefresh")
$acquired = $false

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Program,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

function Git-Lines {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $result = @(& git -C $repo @Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
    return $result
}

function Changed-TrackedFiles {
    $lines = @(Git-Lines status --porcelain --untracked-files=no)
    return @($lines | ForEach-Object {
        if ($_.Length -ge 4) { $_.Substring(3).Trim('"') }
    } | Where-Object { $_ })
}

function Artifact-Fingerprint {
    param(
        [Parameter(Mandatory = $true)][string]$SnapshotText,
        [Parameter(Mandatory = $true)][string]$WeeklyText
    )
    $snapshot = $SnapshotText | ConvertFrom-Json
    $snapshot.PSObject.Properties.Remove("generatedAt")
    $snapshot.provider.PSObject.Properties.Remove("sourceSha256")
    $snapshot.provider.PSObject.Properties.Remove("sourceRowCount")

    $weeklyMatch = [regex]::Match($WeeklyText, 'deepFreeze\((?<json>[\s\S]+)\);\s*$')
    if (!$weeklyMatch.Success) {
        throw "Unable to parse weekly-reference.generated.js for semantic comparison."
    }
    $weekly = $weeklyMatch.Groups["json"].Value | ConvertFrom-Json
    $weekly.PSObject.Properties.Remove("calculatedAt")
    $weekly.PSObject.Properties.Remove("sourceSha256")

    $canonical = @{ snapshot = $snapshot; weekly = $weekly } | ConvertTo-Json -Depth 100 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($canonical)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
}

try {
    $acquired = $mutex.WaitOne(0)
    if (!$acquired) {
        Write-Host "[SKIP] Another Volatility refresh is already running."
        exit 0
    }

    Set-Location $repo
    $branch = (Git-Lines branch --show-current | Select-Object -First 1).Trim()
    if ($branch -ne "main") {
        throw "Automatic Volatility deployment only runs on main (current: $branch)."
    }

    $beforeChanges = @(Changed-TrackedFiles)
    $unsafeBefore = @($beforeChanges | Where-Object { $_ -notin $allowedFiles })
    if ($unsafeBefore.Count -gt 0) {
        throw "Repository has unrelated tracked changes: $($unsafeBefore -join ', ')"
    }

    Invoke-Checked git -C $repo fetch origin main
    $counts = ((Git-Lines rev-list --left-right --count origin/main...HEAD) -join " ").Trim() -split "\s+"
    $behind = [int]$counts[0]
    $ahead = [int]$counts[1]
    if ($behind -gt 0) {
        if ($beforeChanges.Count -gt 0) {
            throw "Repository is behind origin/main while generated files are modified; manual review is required."
        }
        Invoke-Checked git -C $repo merge --ff-only origin/main
    }

    $headSnapshot = (Git-Lines show "HEAD:$($allowedFiles[0])") -join "`n"
    $headWeekly = (Git-Lines show "HEAD:$($allowedFiles[1])") -join "`n"
    $headFingerprint = Artifact-Fingerprint -SnapshotText $headSnapshot -WeeklyText $headWeekly

    Write-Host "[RUN] Generate the local Nasdaq fallback and weekly reference."
    Invoke-Checked npm run sync:volatility-data

    $workSnapshot = Get-Content -LiteralPath (Join-Path $repo $allowedFiles[0]) -Raw -Encoding utf8
    $workWeekly = Get-Content -LiteralPath (Join-Path $repo $allowedFiles[1]) -Raw -Encoding utf8
    $workFingerprint = Artifact-Fingerprint -SnapshotText $workSnapshot -WeeklyText $workWeekly
    if ($headFingerprint -eq $workFingerprint) {
        $restoreArguments = @("-C", $repo, "restore", "--worktree", "--") + $allowedFiles
        Invoke-Checked -Program "git" -Arguments $restoreArguments
        Write-Host "[OK] No completed-session or weekly-analysis change; timestamp-only output was discarded."
        if (!$NoPush -and $ahead -gt 0) {
            Invoke-Checked git -C $repo push origin main
        }
        exit 0
    }

    $afterChanges = @(Changed-TrackedFiles)
    $unsafeAfter = @($afterChanges | Where-Object { $_ -notin $allowedFiles })
    if ($unsafeAfter.Count -gt 0) {
        throw "Sync changed files outside the deployment allowlist: $($unsafeAfter -join ', ')"
    }

    if ($afterChanges.Count -eq 0) {
        Write-Host "[OK] Volatility generated data is already current."
        if (!$NoPush -and $ahead -gt 0) {
            Invoke-Checked git -C $repo push origin main
        }
        exit 0
    }

    if (!$SkipReleaseTest) {
        Write-Host "[RUN] Full release validation."
        Invoke-Checked npm run test:release
    }

    $gitAddArguments = @("-C", $repo, "add", "--") + $allowedFiles
    Invoke-Checked -Program "git" -Arguments $gitAddArguments
    & git -C $repo diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] No publishable Volatility data change remains."
        exit 0
    }
    if ($LASTEXITCODE -ne 1) {
        throw "Unable to inspect the staged Volatility data diff."
    }

    $snapshot = Get-Content -LiteralPath (Join-Path $repo $allowedFiles[0]) -Raw -Encoding utf8 | ConvertFrom-Json
    $sessionDate = if ($snapshot.session.date) { $snapshot.session.date } else { "latest" }
    Invoke-Checked git -C $repo commit -m "chore: refresh volatility data $sessionDate"

    if ($NoPush) {
        Write-Host "[OK] Volatility data committed locally; push skipped by option."
    } else {
        Invoke-Checked git -C $repo push origin main
        Write-Host "[OK] Volatility data validated, committed, and pushed."
    }
} catch {
    Write-Error "[ERROR] Volatility refresh/deploy stopped safely: $($_.Exception.Message)"
    exit 1
} finally {
    Set-Location $PSScriptRoot
    if ($acquired) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
