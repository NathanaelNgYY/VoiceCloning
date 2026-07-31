param(
  [int]$ExpectedCapacity = 50,
  [int]$WaitSeconds = 1200,
  [int]$PollSeconds = 20
)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content "$PSScriptRoot\staging-autoscaling.config.json" -Raw | ConvertFrom-Json
if ($cfg.environment -ne 'staging') { throw 'This script is staging-only.' }
if ($ExpectedCapacity -lt 1 -or $ExpectedCapacity -gt [int]$cfg.maxSize) {
  throw "ExpectedCapacity must be from 1 to $($cfg.maxSize)."
}
if ($WaitSeconds -lt 60 -or $WaitSeconds -gt 3600) {
  throw 'WaitSeconds must be from 60 to 3600.'
}
if ($PollSeconds -lt 5 -or $PollSeconds -gt 60) {
  throw 'PollSeconds must be from 5 to 60.'
}

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

$probeParameters = @{
  commands = @(
    "worker_started=`$(systemctl show gpu-inference-worker.service --property=ActiveEnterTimestamp --value); worker_started_epoch=`$(date -d `"`$worker_started`" +%s 2>/dev/null || echo 0); prime_log_epoch=`$(stat -c %Y /var/log/cloud-init-output.log 2>/dev/null || echo 0); if grep -Fq 'public_prime completed with verified public RIFF responses' /var/log/cloud-init-output.log && [ `"`$prime_log_epoch`" -ge `"`$worker_started_epoch`" ] && cloud-init status --wait | grep -Fq 'status: done' && systemctl is-active --quiet gpu-inference-worker.service && systemctl is-active --quiet target-optimizer-inference.service; then echo VCS_EVENT_READY=1; else echo VCS_EVENT_READY=0; fi"
  )
} | ConvertTo-Json -Depth 3 -Compress
$probePath = Join-Path $env:TEMP 'vcs-staging-event-ready-probe.json'
[IO.File]::WriteAllText(
  $probePath,
  $probeParameters,
  (New-Object Text.UTF8Encoding($false))
)

$deadline = [DateTimeOffset]::UtcNow.AddSeconds($WaitSeconds)
$lastSummary = ''
do {
  $group = Invoke-AwsJson autoscaling describe-auto-scaling-groups --region $cfg.region `
    --auto-scaling-group-names ([string]$cfg.autoScalingGroupName)
  $asg = $group.AutoScalingGroups[0]
  $instanceIds = @(
    $asg.Instances |
      Where-Object { $_.LifecycleState -eq 'InService' -and $_.HealthStatus -eq 'Healthy' } |
      ForEach-Object { [string]$_.InstanceId }
  )
  $targetHealth = Invoke-AwsJson elbv2 describe-target-health --region $cfg.region `
    --target-group-arn $targetGroupArn
  $healthyTargetIds = @(
    $targetHealth.TargetHealthDescriptions |
      Where-Object { $_.TargetHealth.State -eq 'healthy' } |
      ForEach-Object { [string]$_.Target.Id }
  )
  $coveredIds = @($instanceIds | Where-Object { $healthyTargetIds -contains $_ })
  $summary = 'desired={0} inServiceHealthy={1} targetHealthy={2} covered={3}/{4}' -f @(
    [int]$asg.DesiredCapacity,
    $instanceIds.Count,
    $healthyTargetIds.Count,
    $coveredIds.Count,
    $ExpectedCapacity
  )
  if ($summary -ne $lastSummary) {
    Write-Host "Waiting for event fleet: $summary"
    $lastSummary = $summary
  }

  if ([int]$asg.DesiredCapacity -eq $ExpectedCapacity -and
    $coveredIds.Count -eq $ExpectedCapacity) {
    $ready = 0
    for ($offset = 0; $offset -lt $coveredIds.Count; $offset += 50) {
      $lastIndex = [Math]::Min($offset + 49, $coveredIds.Count - 1)
      $batchIds = @($coveredIds[$offset..$lastIndex])
      $sendArgs = @(
        'ssm', 'send-command',
        '--region', [string]$cfg.region,
        '--document-name', 'AWS-RunShellScript',
        '--instance-ids'
      ) + $batchIds + @(
        '--parameters', "file://$probePath",
        '--comment', 'Verify staging event public-prime readiness'
      )
      $command = Invoke-AwsJson @sendArgs
      $commandId = [string]$command.Command.CommandId
      Start-Sleep -Seconds 5
      foreach ($instanceId in $batchIds) {
        try {
          $invocation = Invoke-AwsJson ssm get-command-invocation --region $cfg.region `
            --command-id $commandId --instance-id $instanceId
          if ($invocation.Status -eq 'Success' -and
            [string]$invocation.StandardOutputContent -match 'VCS_EVENT_READY=1') {
            $ready += 1
          }
        } catch {
          # SSM can briefly return InvocationDoesNotExist while distributing a command.
        }
      }
    }
    Write-Host "Per-target deep/public warm proof: $ready/$ExpectedCapacity"
    if ($ready -eq $ExpectedCapacity) {
      Write-Host "Event fleet ready. Capacity=$ExpectedCapacity TargetGroup=$($cfg.targetGroupName) VerifiedPublicPrime=$ready"
      return
    }
  }
  Start-Sleep -Seconds $PollSeconds
} while ([DateTimeOffset]::UtcNow -lt $deadline)

throw "Event fleet did not pass readiness within $WaitSeconds seconds. Last=$lastSummary"
