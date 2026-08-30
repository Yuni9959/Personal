param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ReleaseFingerprint,
    [Parameter(Mandatory = $true)][ValidatePattern('^dpl_[A-Za-z0-9]+$')][string]$DeploymentId,
    [Parameter(Mandatory = $true)][string]$ReleasedAt,
    [string]$StableUrl = 'https://university-admission-private-preview-yuni14.vercel.app/'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$allowedFiles = @('apps.js', 'sw.js')
$mutex = [System.Threading.Mutex]::new($false, 'Local\PersonalTapUniversityReleaseSync')
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

function Changed-Files {
    return @(Git-Lines status --porcelain --untracked-files=all | ForEach-Object {
        if ($_.Length -ge 4) { $_.Substring(3).Trim('"') }
    } | Where-Object { $_ })
}

function Assert-Allowlist {
    param([string[]]$Files, [string]$Label)
    $unsafe = @($Files | Where-Object { $_ -notin $allowedFiles })
    if ($unsafe.Count -gt 0) {
        throw "$Label contains files outside the admission release allowlist: $($unsafe -join ', ')"
    }
}

function Wait-PublicRelease {
    $deadline = [DateTime]::UtcNow.AddMinutes(4)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $response = Invoke-WebRequest -UseBasicParsing -Headers @{
                'Cache-Control' = 'no-cache'
                'Pragma' = 'no-cache'
            } -Uri "https://yuni9959.github.io/Personal/sw.js?admission-release=$ReleaseFingerprint&verify=$stamp" -TimeoutSec 30
            if ($response.StatusCode -eq 200 -and $response.Content.Contains(
                "const UNIVERSITY_ADMISSION_RELEASE = `"$ReleaseFingerprint`";"
            )) {
                return
            }
        } catch {
            # GitHub Pages can briefly return an old artifact while the workflow promotes.
        }
        Start-Sleep -Seconds 5
    }
    throw 'GitHub Pages did not expose the expected admission release fingerprint in time.'
}

try {
    $acquired = $mutex.WaitOne(0)
    if (!$acquired) {
        throw 'Another Personal Tap admission release sync is already running.'
    }
    if ([DateTimeOffset]::Parse($ReleasedAt).ToUniversalTime() -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
        throw 'Release timestamp is in the future.'
    }
    if ($StableUrl -ne 'https://university-admission-private-preview-yuni14.vercel.app/') {
        throw 'Unexpected admission stable URL.'
    }

    Set-Location $repo
    $branch = (Git-Lines branch --show-current | Select-Object -First 1).Trim()
    if ($branch -ne 'main') {
        throw "Admission release publishing only runs on main (current: $branch)."
    }
    Assert-Allowlist -Files @(Changed-Files) -Label 'Working tree'

    Invoke-Checked git -C $repo fetch origin main
    $counts = ((Git-Lines rev-list --left-right --count origin/main...HEAD) -join ' ').Trim() -split '\s+'
    $behind = [int]$counts[0]
    $ahead = [int]$counts[1]
    if ($behind -gt 0) {
        if ((Changed-Files).Count -gt 0 -or $ahead -gt 0) {
            throw 'Repository is behind origin/main with local state; manual review is required.'
        }
        Invoke-Checked git -C $repo merge --ff-only origin/main
    }
    if ($ahead -gt 0) {
        Assert-Allowlist -Files @(Git-Lines diff --name-only origin/main..HEAD) -Label 'Unpushed commits'
    }

    $syncOutput = @(& node (Join-Path $repo 'tools\sync-university-release.mjs') `
        --repo $repo `
        --release-fingerprint $ReleaseFingerprint `
        --deployment-id $DeploymentId `
        --released-at $ReleasedAt `
        --stable-url $StableUrl)
    if ($LASTEXITCODE -ne 0) {
        throw 'Admission release metadata sync failed.'
    }
    Assert-Allowlist -Files @(Changed-Files) -Label 'Release sync'

    if ((Changed-Files).Count -gt 0) {
        Invoke-Checked npm run test:release
        Invoke-Checked git -C $repo diff --check
        Invoke-Checked git -C $repo add -- apps.js sw.js
        & git -C $repo diff --cached --quiet
        if ($LASTEXITCODE -eq 1) {
            Invoke-Checked git -C $repo commit -m "chore: sync admission release $($ReleaseFingerprint.Substring(0, 12))"
        } elseif ($LASTEXITCODE -ne 0) {
            throw 'Unable to inspect the staged admission release diff.'
        }
    }

    $counts = ((Git-Lines rev-list --left-right --count origin/main...HEAD) -join ' ').Trim() -split '\s+'
    $ahead = [int]$counts[1]
    if ($ahead -gt 0) {
        Invoke-Checked git -C $repo push origin main
    }
    Wait-PublicRelease
    $publishStatus = if ($ahead -gt 0) { 'published' } else { 'current' }

    [ordered]@{
        status = $publishStatus
        release_fingerprint = $ReleaseFingerprint
        deployment_id = $DeploymentId
        commit = (Git-Lines rev-parse HEAD | Select-Object -First 1).Trim()
        public_verified = $true
    } | ConvertTo-Json -Compress
} catch {
    Write-Error "[ERROR] Personal Tap admission release sync stopped safely: $($_.Exception.Message)"
    exit 1
} finally {
    Set-Location $PSScriptRoot
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
