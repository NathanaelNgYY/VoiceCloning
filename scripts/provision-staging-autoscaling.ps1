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
  [int]$ScaleOutRejectsPerMinute = $(if ($env:VCS_STAGING_SCALE_OUT_REJECTS_PER_MINUTE) {
    [int]$env:VCS_STAGING_SCALE_OUT_REJECTS_PER_MINUTE
  } else { -1 }),
  [int]$ScaleOutAddCapacity = $(if ($env:VCS_STAGING_SCALE_OUT_ADD_CAPACITY) {
    [int]$env:VCS_STAGING_SCALE_OUT_ADD_CAPACITY
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
if ($ScaleOutRejectsPerMinute -lt 0) {
  $ScaleOutRejectsPerMinute = [int]$cfg.scaleOutRejectsPerMinute
}
if ($ScaleOutAddCapacity -lt 0) {
  $ScaleOutAddCapacity = [int]$cfg.scaleOutAddCapacity
}

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
if ($ScaleOutRejectsPerMinute -lt 1) {
  throw 'ScaleOutRejectsPerMinute must be at least 1.'
}
if ($ScaleOutAddCapacity -lt 1 -or $ScaleOutAddCapacity -gt $MaxCapacity) {
  throw "ScaleOutAddCapacity must be from 1 to MaxCapacity $MaxCapacity."
}
if ([string]::IsNullOrWhiteSpace([string]$cfg.publicPrimeUrl) -or
  [string]$cfg.publicPrimeUrl -notmatch '^https://') {
  throw 'publicPrimeUrl must be an HTTPS URL.'
}
if ([int]$cfg.publicPrimeDelaySeconds -lt 0 -or
  [int]$cfg.publicPrimeDelaySeconds -gt 600) {
  throw 'publicPrimeDelaySeconds must be from 0 to 600.'
}
if ([int]$cfg.publicPrimeRequestsPerInstance -lt 1 -or
  [int]$cfg.publicPrimeRequestsPerInstance -gt 10) {
  throw 'publicPrimeRequestsPerInstance must be from 1 to 10.'
}
if ([int]$cfg.publicPrimeSettleSeconds -lt 0 -or
  [int]$cfg.publicPrimeSettleSeconds -gt 300) {
  throw 'publicPrimeSettleSeconds must be from 0 to 300.'
}
if ([string]::IsNullOrWhiteSpace([string]$cfg.publicPrimeText)) {
  throw 'publicPrimeText must not be empty.'
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

$publicPrimeBody = @{
  voiceProfileId = 'deanvoice-v1'
  text = [string]$cfg.publicPrimeText
  skip_verify = $true
} | ConvertTo-Json -Compress
$publicPrimeBodyB64 = [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes($publicPrimeBody)
)

$userData = @'
#cloud-config
write_files:
  - path: /etc/systemd/system/gpu-inference-worker.service.d/staging-warm.conf
    owner: root:root
    permissions: '0644'
    content: |
      [Service]
      ExecStartPost=/home/ubuntu/VoiceCloning/scripts/warm-staging-deanvoice.sh
      TimeoutStartSec=900
  - path: /usr/local/sbin/vcs-prime-public-route.sh
    owner: root:root
    permissions: '0755'
    content: |
      #!/usr/bin/env bash
      set -u

      prime_url='__PUBLIC_PRIME_URL__'
      prime_body_b64='__PUBLIC_PRIME_BODY_B64__'
      delay_seconds=__PUBLIC_PRIME_DELAY_SECONDS__
      request_count=__PUBLIC_PRIME_REQUESTS__
      settle_seconds=__PUBLIC_PRIME_SETTLE_SECONDS__

      sleep "${delay_seconds}"
      prime_body="$(printf '%s' "${prime_body_b64}" | base64 --decode)"
      pids=()
      for request_index in $(seq 1 "${request_count}"); do
        (
          status="$(
            curl --silent --show-error \
              --max-time 60 \
              --output "/tmp/vcs-public-prime-${request_index}.response" \
              --write-out '%{http_code}' \
              --header 'Content-Type: application/json' \
              --header 'Cache-Control: no-cache' \
              --data-binary "${prime_body}" \
              "${prime_url}?instancePrime=$(date +%s)-${request_index}" \
              || true
          )"
          echo "public_prime request=${request_index} status=${status:-000}"
          rm -f "/tmp/vcs-public-prime-${request_index}.response"
        ) &
        pids+=("$!")
      done
      for pid in "${pids[@]}"; do
        wait "${pid}" || true
      done

      # CloudFront can return 504 before Lambda/the GPU stops working. Let those
      # accepted syntheses finish so the public route is hot before cloud-init ends.
      sleep "${settle_seconds}"
      echo 'public_prime completed'
bootcmd:
  - [systemctl, disable, gpu-worker.service]
  - [systemctl, disable, target-optimizer-inference.service]
  - [systemctl, mask, --now, apt-daily.service, apt-daily-upgrade.service, apt-daily.timer, apt-daily-upgrade.timer, unattended-upgrades.service, packagekit.service]
runcmd:
  - [systemctl, disable, --now, gpu-worker.service]
  - [systemctl, disable, --now, target-optimizer-inference.service]
  - [systemctl, daemon-reload]
  - [systemctl, enable, gpu-inference-worker.service]
  - [systemctl, restart, gpu-inference-worker.service]
  - [systemctl, enable, --now, target-optimizer-inference.service]
  - [/usr/local/sbin/vcs-prime-public-route.sh]
'@
$userData = $userData.Replace('__PUBLIC_PRIME_URL__', [string]$cfg.publicPrimeUrl)
$userData = $userData.Replace('__PUBLIC_PRIME_BODY_B64__', $publicPrimeBodyB64)
$userData = $userData.Replace(
  '__PUBLIC_PRIME_DELAY_SECONDS__',
  [string][int]$cfg.publicPrimeDelaySeconds
)
$userData = $userData.Replace(
  '__PUBLIC_PRIME_REQUESTS__',
  [string][int]$cfg.publicPrimeRequestsPerInstance
)
$userData = $userData.Replace(
  '__PUBLIC_PRIME_SETTLE_SECONDS__',
  [string][int]$cfg.publicPrimeSettleSeconds
)
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
    --adjustment-type ChangeInCapacity `
    --estimated-instance-warmup $cfg.healthCheckGracePeriodSeconds `
    --metric-aggregation-type Maximum `
    --step-adjustments "MetricIntervalLowerBound=0,ScalingAdjustment=$ScaleOutAddCapacity"

  $scaleInPolicy = Invoke-AwsJson autoscaling put-scaling-policy --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --policy-name vcs-staging-inference-idle-scale-in `
    --policy-type StepScaling `
    --adjustment-type ChangeInCapacity `
    --estimated-instance-warmup $cfg.healthCheckGracePeriodSeconds `
    --metric-aggregation-type Maximum `
    --step-adjustments 'MetricIntervalUpperBound=0,ScalingAdjustment=-1'

  Invoke-AwsJson cloudwatch put-metric-alarm --region $cfg.region `
    --alarm-name vcs-staging-inference-all-capacity-busy-1m `
    --alarm-description "Add $ScaleOutAddCapacity GPUs when Target Optimizer rejects at least $ScaleOutRejectsPerMinute requests in a one-minute CloudWatch period." `
    --namespace AWS/ApplicationELB `
    --metric-name TargetControlRequestRejectCount `
    --dimensions "Name=LoadBalancer,Value=$albResource" `
    --statistic Sum --period 60 `
    --evaluation-periods 1 --datapoints-to-alarm 1 `
    --threshold $ScaleOutRejectsPerMinute --comparison-operator GreaterThanOrEqualToThreshold `
    --treat-missing-data notBreaching `
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

Write-Host "Staging ASG provisioning complete. Apply=$Apply Event=$eventEnabled ListenerSwitched=$SwitchListener Desired=$DesiredCapacity PreWarm=$PreWarmCapacity Max=$MaxCapacity RejectsPerMinute=$ScaleOutRejectsPerMinute ScaleOutAdd=$ScaleOutAddCapacity PreWarmAt=$PreWarmAt"
