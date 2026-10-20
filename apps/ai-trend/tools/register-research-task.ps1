$ErrorActionPreference = 'Stop'
$state = Join-Path $env:LOCALAPPDATA 'PersonalTap\ai-trend'
New-Item -ItemType Directory -Path $state -Force | Out-Null
$pythonPath = (& python -c 'import sys; print(sys.executable)').Trim()
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Python executable unavailable' }
[System.IO.File]::WriteAllText((Join-Path $state 'python-path.txt'), $pythonPath, [System.Text.Encoding]::Unicode)
$launcher = Join-Path $PSScriptRoot 'research-hidden.vbs'
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\wscript.exe') -Argument ('//B //Nologo "{0}"' -f $launcher) -WorkingDirectory $PSScriptRoot
$triggers = @('02:35', '08:35', '14:35', '20:35' | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ })
$settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Personal Tap AI Trend Research' -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Korean AI Trend research every 6 hours; hidden window; local Codex authentication; data-only publication' -Force | Out-Null
Get-ScheduledTask -TaskName 'Personal Tap AI Trend Research' | Select-Object TaskName, State, Actions, Triggers
