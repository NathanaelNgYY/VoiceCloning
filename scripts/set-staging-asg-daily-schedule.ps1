param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content "$PSScriptRoot\staging-autoscaling.config.json" -Raw | ConvertFrom-Json

$actions = @(
  @{
    Name = 'vcs-staging-daily-start'
    Recurrence = [string]$cfg.dailyStartCron
    Min = 1
  },
  @{
    Name = 'vcs-staging-daily-stop'
    Recurrence = [string]$cfg.dailyStopCron
    # Off-hours floor, from config. A floor of 0 alone does NOT stop anything:
    # the group keeps whatever desired capacity it already has, so the action has
    # to set desired too. offHoursDesiredCapacity is therefore applied when the
    # key is present, which is what makes 19:00 a real stop matching the fixed
    # GPUs' schedule. Note the tradeoff this reintroduces: work still running at
    # 19:00 is terminated, so an event that must overrun needs its own scheduled
    # action or a temporary suspension of this one.
    Min = [int]$cfg.offHoursMinCapacity
    Desired = $cfg.offHoursDesiredCapacity
  }
)

foreach ($action in $actions) {
  $hasDesired = $null -ne $action.Desired
  $desiredLabel = if ($hasDesired) { "desired $($action.Desired)" } else { 'desired unchanged' }
  if (-not $Apply) {
    Write-Host "[dry-run] $($action.Name): $($action.Recurrence) $($cfg.dailyScheduleTimeZone), min $($action.Min), $desiredLabel"
    continue
  }

  $args = @(
    '--region', $cfg.region,
    '--auto-scaling-group-name', $cfg.autoScalingGroupName,
    '--scheduled-action-name', $action.Name,
    '--recurrence', $action.Recurrence,
    '--time-zone', $cfg.dailyScheduleTimeZone,
    '--min-size', $action.Min,
    '--max-size', $cfg.maxSize
  )
  if ($hasDesired) { $args += @('--desired-capacity', [int]$action.Desired) }

  & aws autoscaling put-scheduled-update-group-action @args
  if ($LASTEXITCODE -ne 0) { throw "Failed to apply $($action.Name)." }
}

if ($Apply) {
  Write-Host "Applied staging inference daily baseline schedule."
}
