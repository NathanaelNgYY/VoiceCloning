# Sidecar poller: samples ASG capacity, target-group health, and the staging
# scaling alarms on an interval, writing one JSON line per sample so a
# load-test run can be correlated with scaling events afterwards.
# Run it alongside load-test-staging-tts.mjs / load-test-staging-chatbot.mjs;
# keep it running after load stops to observe the 15-minute idle scale-in.
#
#   pwsh scripts/poll-staging-autoscaling.ps1 -DurationMinutes 30 `
#     -OutFile .tmp/autoscaling-timeline.jsonl
param(
  [int]$IntervalSeconds = 15,
  [int]$DurationMinutes = 30,
  [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content "$PSScriptRoot\staging-autoscaling.config.json" -Raw | ConvertFrom-Json
if ($cfg.environment -ne 'staging') { throw 'This script is staging-only.' }
if ($IntervalSeconds -lt 5 -or $IntervalSeconds -gt 300) {
  throw 'IntervalSeconds must be from 5 to 300.'
}
if ($DurationMinutes -lt 1 -or $DurationMinutes -gt 240) {
  throw 'DurationMinutes must be from 1 to 240.'
}

$alarmNames = @(
  'vcs-staging-inference-all-capacity-busy-1m',
  'vcs-staging-inference-occupancy-70pct-1m',
  'vcs-staging-inference-baseline-occupancy-70pct-1m',
  'vcs-staging-inference-no-traffic-15m'
)

function Invoke-AwsJson {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Args)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $raw = & aws @Args --output json 2>&1
    $awsExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($awsExitCode -ne 0) {
    throw "aws $($Args -join ' ') failed: $($raw -join [Environment]::NewLine)"
  }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

$targetGroups = Invoke-AwsJson elbv2 describe-target-groups --region $cfg.region `
  --names ([string]$cfg.targetGroupName)
$targetGroupArn = [string]$targetGroups.TargetGroups[0].TargetGroupArn
if ([string]::IsNullOrWhiteSpace($targetGroupArn)) {
  throw "Target group $($cfg.targetGroupName) returned no ARN."
}

if ($OutFile) {
  $outDir = Split-Path -Parent $OutFile
  if ($outDir -and -not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force $outDir | Out-Null
  }
  if (Test-Path $OutFile) { Clear-Content $OutFile }
}

$startedAt = [DateTimeOffset]::UtcNow
$deadline = $startedAt.AddMinutes($DurationMinutes)
$samples = New-Object System.Collections.Generic.List[object]
Write-Host ("Polling {0} every {1}s until {2:o} ..." -f `
  $cfg.autoScalingGroupName, $IntervalSeconds, $deadline)

do {
  $sampledAt = [DateTimeOffset]::UtcNow
  $group = Invoke-AwsJson autoscaling describe-auto-scaling-groups --region $cfg.region `
    --auto-scaling-group-names ([string]$cfg.autoScalingGroupName)
  $asg = $group.AutoScalingGroups[0]
  $inService = @(
    $asg.Instances | Where-Object { $_.LifecycleState -eq 'InService' }
  ).Count
  $pending = @(
    $asg.Instances | Where-Object { $_.LifecycleState -like 'Pending*' }
  ).Count
  $terminating = @(
    $asg.Instances | Where-Object { $_.LifecycleState -like 'Terminating*' }
  ).Count

  $targetHealth = Invoke-AwsJson elbv2 describe-target-health --region $cfg.region `
    --target-group-arn $targetGroupArn
  $healthyTargets = @(
    $targetHealth.TargetHealthDescriptions |
      Where-Object { $_.TargetHealth.State -eq 'healthy' }
  ).Count

  $alarms = Invoke-AwsJson cloudwatch describe-alarms --region $cfg.region `
    --alarm-names @alarmNames
  $alarmStates = [ordered]@{}
  foreach ($alarm in $alarms.MetricAlarms) {
    $alarmStates[[string]$alarm.AlarmName] = [string]$alarm.StateValue
  }

  $sample = [ordered]@{
    at = $sampledAt.ToString('o')
    elapsedSec = [int]($sampledAt - $startedAt).TotalSeconds
    desiredCapacity = [int]$asg.DesiredCapacity
    minSize = [int]$asg.MinSize
    maxSize = [int]$asg.MaxSize
    inService = $inService
    pending = $pending
    terminating = $terminating
    healthyTargets = $healthyTargets
    alarms = $alarmStates
  }
  $samples.Add($sample)
  $line = $sample | ConvertTo-Json -Depth 4 -Compress
  if ($OutFile) { Add-Content -Path $OutFile -Value $line -Encoding utf8 }
  Write-Host ("[{0,5}s] desired={1} inService={2} pending={3} terminating={4} healthy={5} {6}" -f `
    $sample.elapsedSec, $sample.desiredCapacity, $inService, $pending, $terminating, `
    $healthyTargets, (($alarmStates.GetEnumerator() |
      Where-Object { $_.Value -ne 'OK' } |
      ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '))

  if ([DateTimeOffset]::UtcNow -ge $deadline) { break }
  Start-Sleep -Seconds $IntervalSeconds
} while ($true)

$desiredValues = @($samples | ForEach-Object { $_.desiredCapacity })
$inServiceValues = @($samples | ForEach-Object { $_.inService })
$firstScaleOut = $samples | Where-Object {
  $_.desiredCapacity -gt $samples[0].desiredCapacity
} | Select-Object -First 1
$firstNewInService = $samples | Where-Object {
  $_.inService -gt $samples[0].inService
} | Select-Object -First 1
$firstScaleIn = $samples | Where-Object {
  $_.desiredCapacity -lt ($desiredValues | Measure-Object -Maximum).Maximum
} | Select-Object -First 1

$summary = [ordered]@{
  startedAt = $startedAt.ToString('o')
  finishedAt = [DateTimeOffset]::UtcNow.ToString('o')
  samples = $samples.Count
  desiredCapacity = [ordered]@{
    first = $samples[0].desiredCapacity
    max = ($desiredValues | Measure-Object -Maximum).Maximum
    last = $samples[-1].desiredCapacity
  }
  inService = [ordered]@{
    first = $samples[0].inService
    max = ($inServiceValues | Measure-Object -Maximum).Maximum
    last = $samples[-1].inService
  }
  firstScaleOutAtSec = if ($firstScaleOut) { $firstScaleOut.elapsedSec } else { $null }
  firstNewInServiceAtSec = if ($firstNewInService) { $firstNewInService.elapsedSec } else { $null }
  firstScaleInAtSec = if ($firstScaleIn) { $firstScaleIn.elapsedSec } else { $null }
}
$summaryJson = $summary | ConvertTo-Json -Depth 4
Write-Host $summaryJson
if ($OutFile) {
  $summaryFile = [IO.Path]::ChangeExtension($OutFile, '.summary.json')
  [IO.File]::WriteAllText($summaryFile, $summaryJson, (New-Object Text.UTF8Encoding($false)))
  Write-Host "Timeline: $OutFile"
  Write-Host "Summary:  $summaryFile"
}
