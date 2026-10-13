param(
    [switch]$NoPush,
    [switch]$SkipReleaseTest
)

$ErrorActionPreference = "Stop"
$sourceRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$repo = $null
$allowedFiles = @(
    "apps/volatility/data/local-nasdaq-snapshot.json",
    "apps/volatility/js/weekly-reference.generated.js"
)
$mutex = [System.Threading.Mutex]::new($false, "Local\PersonalTapVolatilityRefresh")
$acquired = $false
$worktreeAdded = $false
$automationRoot = [System.IO.Path]::GetFullPath(
    (Join-Path ([System.IO.Path]::GetTempPath()) "personal-tap-volatility-automation")
).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$worktree = [System.IO.Path]::GetFullPath(
    (Join-Path $automationRoot ([guid]::NewGuid().ToString("N")))
)
if (!$worktree.StartsWith("$automationRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Automation worktree path escaped its dedicated temporary root."
}

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
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $result = @(& git -C $Repository @Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
    return $result
}

function Changed-TrackedFiles {
    param([Parameter(Mandatory = $true)][string]$Repository)
    $lines = @(Git-Lines -Repository $Repository -Arguments @("status", "--porcelain", "--untracked-files=no"))
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

    $weeklyMatch = [regex]::Match(
        $WeeklyText,
        'export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze\((?<json>[\s\S]+)\);\s*$'
    )
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

function Update-SourceCheckoutIfSafe {
    $sourceBranch = ((Git-Lines -Repository $sourceRepo -Arguments @("branch", "--show-current")) | Select-Object -First 1).Trim()
    $sourceChanges = @(Changed-TrackedFiles -Repository $sourceRepo)
    if ($sourceBranch -ne "main" -or $sourceChanges.Count -gt 0) {
        Write-Host "[INFO] Published from the isolated worktree; the active checkout was left untouched."
        return
    }
    $counts = ((Git-Lines -Repository $sourceRepo -Arguments @("rev-list", "--left-right", "--count", "origin/main...HEAD")) -join " ").Trim() -split "\s+"
    $behind = [int]$counts[0]
    $ahead = [int]$counts[1]
    if ($behind -gt 0 -and $ahead -eq 0) {
        Invoke-Checked git -C $sourceRepo merge --ff-only origin/main
        Write-Host "[OK] Active checkout fast-forwarded to the published Volatility data."
    } elseif ($behind -gt 0 -or $ahead -gt 0) {
        Write-Host "[INFO] Active checkout diverges from origin/main and was left untouched."
    }
}

try {
    $acquired = $mutex.WaitOne(0)
    if (!$acquired) {
        Write-Host "[SKIP] Another Volatility refresh is already running."
        exit 0
    }

    Write-Host "[RUN] Prepare an isolated Volatility deployment worktree."
    Invoke-Checked git -C $sourceRepo fetch origin main
    New-Item -ItemType Directory -Path $automationRoot -Force | Out-Null
    Invoke-Checked git -C $sourceRepo worktree add --detach $worktree origin/main
    $worktreeAdded = $true
    $repo = $worktree
    Set-Location $repo

    $headSnapshot = (Git-Lines -Repository $repo -Arguments @("show", "HEAD:$($allowedFiles[0])")) -join "`n"
    $headWeekly = (Git-Lines -Repository $repo -Arguments @("show", "HEAD:$($allowedFiles[1])")) -join "`n"
    $headFingerprint = Artifact-Fingerprint -SnapshotText $headSnapshot -WeeklyText $headWeekly

    Write-Host "[RUN] Generate the local Nasdaq fallback and weekly reference."
    Invoke-Checked npm run sync:volatility-data

    $workSnapshot = Get-Content -LiteralPath (Join-Path $repo $allowedFiles[0]) -Raw -Encoding utf8
    $workWeekly = Get-Content -LiteralPath (Join-Path $repo $allowedFiles[1]) -Raw -Encoding utf8
    $workFingerprint = Artifact-Fingerprint -SnapshotText $workSnapshot -WeeklyText $workWeekly
    if ($headFingerprint -eq $workFingerprint) {
        Write-Host "[OK] No completed-session or weekly-analysis change; timestamp-only output was discarded."
        Update-SourceCheckoutIfSafe
        exit 0
    }

    $afterChanges = @(Changed-TrackedFiles -Repository $repo)
    $unsafeAfter = @($afterChanges | Where-Object { $_ -notin $allowedFiles })
    if ($unsafeAfter.Count -gt 0) {
        throw "Sync changed files outside the deployment allowlist: $($unsafeAfter -join ', ')"
    }
    if ($afterChanges.Count -eq 0) {
        Write-Host "[OK] Volatility generated data is already current."
        Update-SourceCheckoutIfSafe
        exit 0
    }

    if (!$SkipReleaseTest) {
        Write-Host "[RUN] Full release validation."
        Invoke-Checked npm run test:release
    }

    if ($NoPush) {
        Write-Host "[OK] Volatility data validated in an isolated worktree; commit and push skipped by option."
        exit 0
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
    Invoke-Checked git -C $repo push origin HEAD:main
    Write-Host "[OK] Volatility data validated, committed, and pushed from the isolated worktree."
    Invoke-Checked git -C $sourceRepo fetch origin main
    Update-SourceCheckoutIfSafe
} catch {
    Write-Error "[ERROR] Volatility refresh/deploy stopped safely: $($_.Exception.Message)"
    exit 1
} finally {
    Set-Location $PSScriptRoot
    if ($worktreeAdded) {
        & git -C $sourceRepo worktree remove --force -- $worktree 2>$null
        & git -C $sourceRepo worktree prune 2>$null
    }
    if (Test-Path -LiteralPath $worktree) {
        $resolvedWorktree = [System.IO.Path]::GetFullPath($worktree)
        if ($resolvedWorktree.StartsWith("$automationRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedWorktree -Recurse -Force
        }
    }
    if ($acquired) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
