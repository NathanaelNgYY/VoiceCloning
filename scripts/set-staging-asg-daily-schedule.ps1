param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content "$PSScriptRoot\staging-autoscaling.config.json" -Raw | ConvertFrom-Json

$actions = @(
  @{
    Name = 'vcs-staging-daily-start'
    Recurrence = [string]$cfg.dailyStartCron
    Min = 1
    Desired = 1
  },
  @{
    Name = 'vcs-staging-daily-stop'
    Recurrence = [string]$cfg.dailyStopCron
    # Retain the historical action name, but read the off-hours floor from config.
    # A value of 1 keeps one fully warmed inference GPU available around the clock.
    Min = [int]$cfg.offHoursMinCapacity
    Desired = [int]$cfg.offHoursMinCapacity
  }
)

foreach ($action in $actions) {
  if (-not $Apply) {
    Write-Host "[dry-run] $($action.Name): $($action.Recurrence) $($cfg.dailyScheduleTimeZone), min/desired $($action.Min)"
    continue
  }

  & aws autoscaling put-scheduled-update-group-action `
    --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --scheduled-action-name $action.Name `
    --recurrence $action.Recurrence `
    --time-zone $cfg.dailyScheduleTimeZone `
    --min-size $action.Min `
    --desired-capacity $action.Desired `
    --max-size $cfg.maxSize
  if ($LASTEXITCODE -ne 0) { throw "Failed to apply $($action.Name)." }
}

if ($Apply) {
  Write-Host "Applied staging inference daily baseline schedule."
}
