param(
  [Parameter(Mandatory)][string]$AmiId,
  [int]$DesiredCapacity = -1,
  [string]$Event = $env:VCS_STAGING_EVENT,
  [string]$PreWarmAt = $env:VCS_STAGING_PREWARM_AT,
  [string]$ScaleDownAt = $env:VCS_STAGING_SCALE_DOWN_AT,
  [int]$PreWarmCapacity = $(if ($env:VCS_STAGING_PREWARM_CAPACITY) {
    [int]$env:VCS_STAGING_PREWARM_CAPACITY
  } else { -1 }),
  [int]$MaxCapacity = $(if ($env:VCS_STAGING_MAX_CAPACITY) {
    [int]$env:VCS_STAGING_MAX_CAPACITY
  } else { -1 }),
  [switch]$Apply,
  [switch]$SwitchListener
)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content "$PSScriptRoot\staging-autoscaling.config.json" -Raw | ConvertFrom-Json
if ($cfg.environment -ne 'staging') { throw 'This script is staging-only.' }
if ($AmiId -notmatch '^ami-[0-9a-f]+$') { throw 'AmiId must be an AMI id.' }
if ($DesiredCapacity -lt 0) { $DesiredCapacity = [int]$cfg.desiredCapacity }
if ($MaxCapacity -lt 0) { $MaxCapacity = [int]$cfg.maxSize }

$eventEnabled = [bool]($Event -and $Event.Trim().ToLowerInvariant() -in @('1', 'true', 'yes', 'on'))
if ($PreWarmCapacity -lt 0) {
  $PreWarmCapacity = if ($eventEnabled) {
    [int]$cfg.eventCapacity
  } else {
    [int]$cfg.defaultPreWarmCapacity
  }
}
if ($eventEnabled) {
  if (-not $PreWarmAt) {
    $DesiredCapacity = $PreWarmCapacity
  }
}
if ([bool]$PreWarmAt -xor [bool]$ScaleDownAt) {
  throw 'PreWarmAt and ScaleDownAt must be provided together so event capacity cannot be left running indefinitely.'
}
$preWarmTimestamp = $null
$scaleDownTimestamp = $null
if ($PreWarmAt) {
  $preWarmTimestamp = [DateTimeOffset]::Parse($PreWarmAt)
  $scaleDownTimestamp = [DateTimeOffset]::Parse($ScaleDownAt)
  if ($scaleDownTimestamp -le $preWarmTimestamp) {
    throw 'ScaleDownAt must be later than PreWarmAt.'
  }
}
if ($MaxCapacity -lt [int]$cfg.minSize) {
  throw "MaxCapacity must be at least the baseline minimum of $($cfg.minSize)."
}
if ($PreWarmCapacity -gt $MaxCapacity) {
  throw "PreWarmCapacity $PreWarmCapacity cannot exceed MaxCapacity $MaxCapacity."
}
if ($DesiredCapacity -gt $MaxCapacity) {
  throw "DesiredCapacity $DesiredCapacity cannot exceed MaxCapacity $MaxCapacity."
}
$effectiveMinSize = if ($eventEnabled -and -not $PreWarmAt) {
  $PreWarmCapacity
} else {
  [int]$cfg.minSize
}

function Invoke-AwsJson {
  param(
    [switch]$AllowNotFound,
    [switch]$AllowDuplicate,
    [Parameter(ValueFromRemainingArguments)][string[]]$Args
  )
  if (-not $Apply) {
    Write-Host ('[dry-run] aws ' + ($Args -join ' '))
    return $null
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell turns redirected native stderr into ErrorRecord objects.
    # Keep those records capturable here so the handlers below can classify them.
    $ErrorActionPreference = 'Continue'
    $raw = & aws @Args --output json 2>&1
    $awsExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($awsExitCode -ne 0) {
    $errorText = $raw -join [Environment]::NewLine
    if ($AllowNotFound -and $errorText -match 'NotFound|does not exist') { return $null }
    if ($AllowDuplicate -and $errorText -match 'InvalidPermission\.Duplicate') { return $null }
    throw "aws $($Args -join ' ') failed: $errorText"
  }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

$userData = @'
#cloud-config
bootcmd:
  - [systemctl, disable, gpu-worker.service]
  - [systemctl, disable, target-optimizer-inference.service]
runcmd:
  - [systemctl, disable, --now, gpu-worker.service]
  - [systemctl, disable, --now, target-optimizer-inference.service]
  - [systemctl, daemon-reload]
  - [systemctl, enable, --now, gpu-inference-worker.service]
  - [sudo, -u, ubuntu, /home/ubuntu/VoiceCloning/scripts/warm-staging-deanvoice.sh]
  - [systemctl, enable, --now, target-optimizer-inference.service]
'@
$userDataB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($userData))

$tg = Invoke-AwsJson -AllowNotFound elbv2 describe-target-groups --region $cfg.region --names $cfg.targetGroupName
if (-not $tg) {
  $tg = Invoke-AwsJson elbv2 create-target-group --region $cfg.region `
    --name $cfg.targetGroupName --protocol HTTP --port $cfg.targetDataPort `
    --target-control-port $cfg.targetControlPort --target-type instance `
    --vpc-id $cfg.vpcId --health-check-protocol HTTP `
    --health-check-port ([string]$cfg.targetDataPort) --health-check-path /healthz `
    --health-check-interval-seconds 10 --healthy-threshold-count 2 `
    --unhealthy-threshold-count 2 `
    --tags "Key=Environment,Value=staging" "Key=ManagedBy,Value=VoiceCloningRepo"
}
$targetGroupArn = if ($tg) {
  $tg.TargetGroups[0].TargetGroupArn
} elseif (-not $Apply) {
  "arn:aws:elasticloadbalancing:$($cfg.region):000000000000:targetgroup/$($cfg.targetGroupName)/dryrun"
} else {
  throw 'Target group creation returned no target group ARN.'
}
if ($targetGroupArn) {
  Invoke-AwsJson elbv2 modify-target-group-attributes --region $cfg.region `
    --target-group-arn $targetGroupArn `
    --attributes "Key=deregistration_delay.timeout_seconds,Value=120"
}

$launchData = @{
  ImageId = $AmiId
  InstanceType = $cfg.instanceType
  IamInstanceProfile = @{ Name = $cfg.instanceProfileName }
  KeyName = $cfg.keyName
  SecurityGroupIds = @($cfg.securityGroupId)
  UserData = $userDataB64
  MetadataOptions = @{ HttpTokens = 'required'; HttpEndpoint = 'enabled' }
  Monitoring = @{ Enabled = $true }
  TagSpecifications = @(
    @{ ResourceType = 'instance'; Tags = @(
      @{ Key = 'Name'; Value = 'voice-gpu-staging-asg' },
      @{ Key = 'Environment'; Value = 'staging' },
      @{ Key = 'ManagedBy'; Value = 'VoiceCloningRepo' }
    ) }
  )
} | ConvertTo-Json -Depth 8 -Compress
$launchDataPath = Join-Path $env:TEMP 'vcs-staging-launch-template.json'
[IO.File]::WriteAllText(
  $launchDataPath,
  $launchData,
  (New-Object Text.UTF8Encoding($false))
)

$lt = Invoke-AwsJson -AllowNotFound ec2 describe-launch-templates --region $cfg.region `
  --launch-template-names $cfg.launchTemplateName
if (-not $lt) {
  $lt = Invoke-AwsJson ec2 create-launch-template --region $cfg.region `
    --launch-template-name $cfg.launchTemplateName `
    --version-description $AmiId `
    --launch-template-data "file://$launchDataPath" `
    --tag-specifications "ResourceType=launch-template,Tags=[{Key=Environment,Value=staging},{Key=ManagedBy,Value=VoiceCloningRepo}]"
} elseif ($Apply) {
  $version = Invoke-AwsJson ec2 create-launch-template-version --region $cfg.region `
    --launch-template-name $cfg.launchTemplateName `
    --version-description $AmiId `
    --launch-template-data "file://$launchDataPath"
  Invoke-AwsJson ec2 modify-launch-template --region $cfg.region `
    --launch-template-name $cfg.launchTemplateName `
    --default-version ([string]$version.LaunchTemplateVersion.VersionNumber)
}

$asg = Invoke-AwsJson autoscaling describe-auto-scaling-groups --region $cfg.region `
  --auto-scaling-group-names $cfg.autoScalingGroupName
if (-not $asg -or $asg.AutoScalingGroups.Count -eq 0) {
  Invoke-AwsJson autoscaling create-auto-scaling-group --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --launch-template "LaunchTemplateName=$($cfg.launchTemplateName),Version=`$Default" `
    --min-size $effectiveMinSize --max-size $MaxCapacity --desired-capacity $DesiredCapacity `
    --vpc-zone-identifier ($cfg.subnetIds -join ',') `
    --target-group-arns $targetGroupArn `
    --health-check-type ELB `
    --health-check-grace-period $cfg.healthCheckGracePeriodSeconds `
    --default-instance-warmup $cfg.healthCheckGracePeriodSeconds `
    --tags "Key=Environment,Value=staging,PropagateAtLaunch=true" "Key=ManagedBy,Value=VoiceCloningRepo,PropagateAtLaunch=true"
} else {
  Invoke-AwsJson autoscaling update-auto-scaling-group --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --launch-template "LaunchTemplateName=$($cfg.launchTemplateName),Version=`$Default" `
    --min-size $effectiveMinSize --max-size $MaxCapacity --desired-capacity $DesiredCapacity `
    --vpc-zone-identifier ($cfg.subnetIds -join ',') `
    --health-check-type ELB `
    --health-check-grace-period $cfg.healthCheckGracePeriodSeconds `
    --default-instance-warmup $cfg.healthCheckGracePeriodSeconds
}

$albResource = ($cfg.albArn -split ':loadbalancer/')[1]
$targetGroupResource = ($targetGroupArn -split ':')[5]

Invoke-AwsJson -AllowDuplicate ec2 authorize-security-group-ingress --region $cfg.region `
  --group-id $cfg.securityGroupId --protocol tcp `
  --port $cfg.targetDataPort --source-group $cfg.albSecurityGroupId
Invoke-AwsJson -AllowDuplicate ec2 authorize-security-group-ingress --region $cfg.region `
  --group-id $cfg.securityGroupId --protocol tcp `
  --port $cfg.targetControlPort --source-group $cfg.albSecurityGroupId

foreach ($port in @($cfg.targetDataPort, $cfg.targetControlPort)) {
  $egressPermission = @{
    IpProtocol = 'tcp'
    FromPort = [int]$port
    ToPort = [int]$port
    UserIdGroupPairs = @(@{ GroupId = $cfg.securityGroupId })
  } | ConvertTo-Json -Depth 4 -Compress
  $egressPermissionPath = Join-Path $env:TEMP "vcs-staging-alb-egress-$port.json"
  [IO.File]::WriteAllText(
    $egressPermissionPath,
    "[$egressPermission]",
    (New-Object Text.UTF8Encoding($false))
  )
  Invoke-AwsJson -AllowDuplicate ec2 authorize-security-group-egress --region $cfg.region `
    --group-id $cfg.albSecurityGroupId `
    --ip-permissions "file://$egressPermissionPath"
}

if ($SwitchListener -and $targetGroupArn) {
  Invoke-AwsJson elbv2 modify-rule --region $cfg.region --rule-arn (
    (Invoke-AwsJson elbv2 describe-rules --region $cfg.region --listener-arn $cfg.listenerArn).Rules |
      Where-Object Priority -eq ([string]$cfg.inferenceRulePriority) |
      Select-Object -ExpandProperty RuleArn
  ) --actions "Type=forward,TargetGroupArn=$targetGroupArn"
}

$listenerRoutesToTarget = $false
if ($Apply -and $targetGroupArn) {
  $inferenceRule = (Invoke-AwsJson elbv2 describe-rules --region $cfg.region `
    --listener-arn $cfg.listenerArn).Rules |
    Where-Object Priority -eq ([string]$cfg.inferenceRulePriority)
  $listenerRoutesToTarget = [bool](
    $inferenceRule.Actions |
    Where-Object TargetGroupArn -eq $targetGroupArn
  )
}
if ($albResource -and $targetGroupResource -and $listenerRoutesToTarget) {
  $scaleOutPolicy = Invoke-AwsJson autoscaling put-scaling-policy --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --policy-name vcs-staging-inference-all-capacity-busy `
    --policy-type StepScaling `
    --adjustment-type PercentChangeInCapacity `
    --min-adjustment-magnitude 1 `
    --estimated-instance-warmup $cfg.healthCheckGracePeriodSeconds `
    --metric-aggregation-type Maximum `
    --step-adjustments "MetricIntervalLowerBound=0,ScalingAdjustment=$($cfg.scaleOutPercentWhenFull)"

  $scaleInPolicy = Invoke-AwsJson autoscaling put-scaling-policy --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --policy-name vcs-staging-inference-idle-scale-in `
    --policy-type StepScaling `
    --adjustment-type ChangeInCapacity `
    --estimated-instance-warmup $cfg.healthCheckGracePeriodSeconds `
    --metric-aggregation-type Maximum `
    --step-adjustments 'MetricIntervalUpperBound=0,ScalingAdjustment=-1'

  $capacityAlarmMetrics = @(
    @{
      Id = 'free'
      MetricStat = @{
        Metric = @{
          Namespace = 'AWS/ApplicationELB'
          MetricName = 'TargetControlWorkQueueLength'
          Dimensions = @(@{ Name = 'LoadBalancer'; Value = $albResource })
        }
        Period = 60
        Stat = 'Sum'
      }
      ReturnData = $false
    },
    @{
      Id = 'rejected'
      MetricStat = @{
        Metric = @{
          Namespace = 'AWS/ApplicationELB'
          MetricName = 'TargetControlRequestRejectCount'
          Dimensions = @(@{ Name = 'LoadBalancer'; Value = $albResource })
        }
        Period = 60
        Stat = 'Sum'
      }
      ReturnData = $false
    },
    @{
      Id = 'full'
      Label = 'All Target Optimizer capacity busy with rejected traffic'
      Expression = 'IF((FILL(free,0)<=0)*(FILL(rejected,0)>0),1,0)'
      ReturnData = $true
    }
  ) | ConvertTo-Json -Depth 8 -Compress
  $capacityAlarmMetricsPath = Join-Path $env:TEMP 'vcs-staging-capacity-alarm-metrics.json'
  [IO.File]::WriteAllText(
    $capacityAlarmMetricsPath,
    $capacityAlarmMetrics,
    (New-Object Text.UTF8Encoding($false))
  )
  Invoke-AwsJson cloudwatch put-metric-alarm --region $cfg.region `
    --alarm-name vcs-staging-inference-all-capacity-busy-1m `
    --alarm-description 'Scale out only when no Target Optimizer work capacity is advertised and requests are rejected for one minute.' `
    --evaluation-periods 1 --datapoints-to-alarm 1 `
    --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold `
    --treat-missing-data notBreaching `
    --metrics "file://$capacityAlarmMetricsPath" `
    --alarm-actions $scaleOutPolicy.PolicyARN

  Invoke-AwsJson cloudwatch put-metric-alarm --region $cfg.region `
    --alarm-name vcs-staging-inference-no-traffic-15m `
    --alarm-description 'Scale in one instance after fifteen consecutive minutes with no Target Optimizer requests.' `
    --namespace AWS/ApplicationELB `
    --metric-name TargetControlRequestCount `
    --dimensions "Name=LoadBalancer,Value=$albResource" `
    --statistic Sum --period 60 `
    --evaluation-periods $cfg.scaleInIdleMinutes `
    --datapoints-to-alarm $cfg.scaleInIdleMinutes `
    --threshold 0 --comparison-operator LessThanOrEqualToThreshold `
    --treat-missing-data breaching `
    --alarm-actions $scaleInPolicy.PolicyARN

  $disabledLegacyTracking = @{
    PredefinedMetricSpecification = @{
      PredefinedMetricType = 'ALBRequestCountPerTarget'
      ResourceLabel = "$albResource/$targetGroupResource"
    }
    TargetValue = 1000000000
    DisableScaleIn = $true
  } | ConvertTo-Json -Depth 4 -Compress
  $disabledLegacyTrackingPath = Join-Path $env:TEMP 'vcs-staging-disabled-legacy-tracking.json'
  [IO.File]::WriteAllText(
    $disabledLegacyTrackingPath,
    $disabledLegacyTracking,
    (New-Object Text.UTF8Encoding($false))
  )
  # This role cannot delete scaling policies. Keep the old policy inert so a future
  # provisioner run cannot re-enable request-count scale-out by accident.
  Invoke-AwsJson autoscaling put-scaling-policy --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --policy-name vcs-staging-inference-request-rate `
    --policy-type TargetTrackingScaling `
    --estimated-instance-warmup $cfg.healthCheckGracePeriodSeconds `
    --target-tracking-configuration "file://$disabledLegacyTrackingPath"
} elseif ($Apply) {
  Write-Host 'Scaling policy deferred until the inference listener routes to the optimized target group.'
}

if ($PreWarmAt) {
  $startUtc = $preWarmTimestamp.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ')
  Invoke-AwsJson autoscaling put-scheduled-update-group-action --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --scheduled-action-name vcs-staging-prewarm `
    --start-time $startUtc `
    --min-size $PreWarmCapacity --max-size $MaxCapacity --desired-capacity $PreWarmCapacity
}
if ($ScaleDownAt) {
  $endUtc = $scaleDownTimestamp.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ')
  Invoke-AwsJson autoscaling put-scheduled-update-group-action --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --scheduled-action-name vcs-staging-scale-down `
    --start-time $endUtc `
    --min-size $cfg.minSize --max-size $MaxCapacity --desired-capacity $cfg.desiredCapacity
}

Write-Host "Staging ASG provisioning complete. Apply=$Apply Event=$eventEnabled ListenerSwitched=$SwitchListener Desired=$DesiredCapacity PreWarm=$PreWarmCapacity Max=$MaxCapacity PreWarmAt=$PreWarmAt"
