param(
  [Parameter(Mandatory)][string]$AmiId,
  [int]$DesiredCapacity = -1,
  [string]$PreWarmAt = $env:VCS_STAGING_PREWARM_AT,
  [string]$ScaleDownAt = $env:VCS_STAGING_SCALE_DOWN_AT,
  [int]$PreWarmCapacity = $(if ($env:VCS_STAGING_PREWARM_CAPACITY) {
    [int]$env:VCS_STAGING_PREWARM_CAPACITY
  } else { -1 }),
  [switch]$Apply,
  [switch]$SwitchListener
)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content "$PSScriptRoot\staging-autoscaling.config.json" -Raw | ConvertFrom-Json
if ($cfg.environment -ne 'staging') { throw 'This script is staging-only.' }
if ($AmiId -notmatch '^ami-[0-9a-f]+$') { throw 'AmiId must be an AMI id.' }
if ($DesiredCapacity -lt 0) { $DesiredCapacity = [int]$cfg.desiredCapacity }
if ($PreWarmCapacity -lt 0) { $PreWarmCapacity = [int]$cfg.defaultPreWarmCapacity }

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
  $raw = & aws @Args --output json 2>&1
  if ($LASTEXITCODE -ne 0) {
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
runcmd:
  - [systemctl, disable, --now, gpu-worker.service]
  - [systemctl, daemon-reload]
  - [systemctl, enable, --now, gpu-inference-worker.service]
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
    --min-size $cfg.minSize --max-size $cfg.maxSize --desired-capacity $DesiredCapacity `
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
    --min-size $cfg.minSize --max-size $cfg.maxSize --desired-capacity $DesiredCapacity `
    --vpc-zone-identifier ($cfg.subnetIds -join ',') `
    --health-check-type ELB `
    --health-check-grace-period $cfg.healthCheckGracePeriodSeconds `
    --default-instance-warmup $cfg.healthCheckGracePeriodSeconds
}

$albResource = ($cfg.albArn -split ':loadbalancer/')[1]
$targetGroupResource = ($targetGroupArn -split ':')[5]
if ($albResource -and $targetGroupResource) {
  Invoke-AwsJson autoscaling put-scaling-policy --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --policy-name vcs-staging-inference-request-rate `
    --policy-type TargetTrackingScaling `
    --estimated-instance-warmup $cfg.healthCheckGracePeriodSeconds `
    --target-tracking-configuration (
      @{
        PredefinedMetricSpecification = @{
          PredefinedMetricType = 'ALBRequestCountPerTarget'
          ResourceLabel = "$albResource/$targetGroupResource"
        }
        TargetValue = 6
        DisableScaleIn = $false
      } | ConvertTo-Json -Depth 4 -Compress
    )
}

Invoke-AwsJson -AllowDuplicate ec2 authorize-security-group-ingress --region $cfg.region `
  --group-id $cfg.securityGroupId --protocol tcp `
  --port $cfg.targetDataPort --source-group $cfg.albSecurityGroupId
Invoke-AwsJson -AllowDuplicate ec2 authorize-security-group-ingress --region $cfg.region `
  --group-id $cfg.securityGroupId --protocol tcp `
  --port $cfg.targetControlPort --source-group $cfg.albSecurityGroupId

if ($SwitchListener -and $targetGroupArn) {
  Invoke-AwsJson elbv2 modify-rule --region $cfg.region --rule-arn (
    (Invoke-AwsJson elbv2 describe-rules --region $cfg.region --listener-arn $cfg.listenerArn).Rules |
      Where-Object Priority -eq ([string]$cfg.inferenceRulePriority) |
      Select-Object -ExpandProperty RuleArn
  ) --actions "Type=forward,TargetGroupArn=$targetGroupArn"
}

if ($PreWarmAt) {
  $startUtc = ([DateTimeOffset]::Parse($PreWarmAt)).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ')
  Invoke-AwsJson autoscaling put-scheduled-update-group-action --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --scheduled-action-name vcs-staging-prewarm `
    --start-time $startUtc `
    --min-size $PreWarmCapacity --max-size $cfg.maxSize --desired-capacity $PreWarmCapacity
}
if ($ScaleDownAt) {
  $endUtc = ([DateTimeOffset]::Parse($ScaleDownAt)).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ')
  Invoke-AwsJson autoscaling put-scheduled-update-group-action --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --scheduled-action-name vcs-staging-scale-down `
    --start-time $endUtc `
    --min-size $cfg.minSize --max-size $cfg.maxSize --desired-capacity $cfg.desiredCapacity
}

Write-Host "Staging ASG provisioning complete. Apply=$Apply ListenerSwitched=$SwitchListener Desired=$DesiredCapacity PreWarmAt=$PreWarmAt"
