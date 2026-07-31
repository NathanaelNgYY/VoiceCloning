param(
  [switch]$Apply,
  [int]$WaitSeconds = -1
)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content "$PSScriptRoot\staging-autoscaling.config.json" -Raw | ConvertFrom-Json
if ($cfg.environment -ne 'staging') { throw 'This script is staging-only.' }
if ([string]$cfg.liveGatewayInstanceId -notmatch '^i-[0-9a-f]+$') {
  throw 'liveGatewayInstanceId must be an EC2 instance id.'
}
if ([string]::IsNullOrWhiteSpace([string]$cfg.liveGatewayTargetGroupName)) {
  throw 'liveGatewayTargetGroupName must not be empty.'
}
if ($WaitSeconds -lt 0) {
  $WaitSeconds = [int]$cfg.liveGatewayReadyTimeoutSeconds
}
$pollSeconds = [int]$cfg.liveGatewayPollSeconds
if ($WaitSeconds -lt 30 -or $WaitSeconds -gt 1800) {
  throw 'WaitSeconds must be from 30 to 1800.'
}
if ($pollSeconds -lt 5 -or $pollSeconds -gt 60) {
  throw 'liveGatewayPollSeconds must be from 5 to 60.'
}

function Invoke-AwsJson {
  param(
    [Parameter(ValueFromRemainingArguments)][string[]]$Args
  )

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

if (-not $Apply) {
  $dryRunMessage = '[dry-run] ensure live gateway instance {0} is running and target {0} in {1} is healthy; timeout={2}s poll={3}s' -f @(
    [string]$cfg.liveGatewayInstanceId,
    [string]$cfg.liveGatewayTargetGroupName,
    $WaitSeconds,
    $pollSeconds
  )
  Write-Host $dryRunMessage
  return
}

$instanceId = [string]$cfg.liveGatewayInstanceId
$instance = Invoke-AwsJson ec2 describe-instances --region $cfg.region `
  --instance-ids $instanceId
$state = [string]$instance.Reservations[0].Instances[0].State.Name

if ($state -eq 'stopping') {
  Write-Host "Live gateway $instanceId is stopping; waiting before restart."
  Invoke-AwsJson ec2 wait instance-stopped --region $cfg.region --instance-ids $instanceId
  $state = 'stopped'
}
if ($state -eq 'stopped') {
  Write-Host "Starting live gateway instance $instanceId."
  Invoke-AwsJson ec2 start-instances --region $cfg.region --instance-ids $instanceId
} elseif ($state -notin @('pending', 'running')) {
  throw "Live gateway instance $instanceId cannot be started from state '$state'."
}

Invoke-AwsJson ec2 wait instance-running --region $cfg.region --instance-ids $instanceId

$targetGroups = Invoke-AwsJson elbv2 describe-target-groups --region $cfg.region `
  --names ([string]$cfg.liveGatewayTargetGroupName)
$targetGroupArn = [string]$targetGroups.TargetGroups[0].TargetGroupArn
if ([string]::IsNullOrWhiteSpace($targetGroupArn)) {
  throw "Target group $($cfg.liveGatewayTargetGroupName) returned no ARN."
}

$deadline = [DateTimeOffset]::UtcNow.AddSeconds($WaitSeconds)
$lastState = ''
do {
  $health = Invoke-AwsJson elbv2 describe-target-health --region $cfg.region `
    --target-group-arn $targetGroupArn
  $target = $health.TargetHealthDescriptions |
    Where-Object { $_.Target.Id -eq $instanceId } |
    Select-Object -First 1
  $currentState = if ($target) {
    [string]$target.TargetHealth.State
  } else {
    'not-registered'
  }
  if ($currentState -eq 'healthy') {
    Write-Host "Live gateway ready. Instance=$instanceId TargetGroup=$($cfg.liveGatewayTargetGroupName) State=healthy"
    return
  }
  if ($currentState -ne $lastState) {
    Write-Host "Waiting for live gateway target health. State=$currentState"
    $lastState = $currentState
  }
  Start-Sleep -Seconds $pollSeconds
} while ([DateTimeOffset]::UtcNow -lt $deadline)

throw "Live gateway instance $instanceId did not become healthy in $($cfg.liveGatewayTargetGroupName) within $WaitSeconds seconds. LastState=$lastState"
