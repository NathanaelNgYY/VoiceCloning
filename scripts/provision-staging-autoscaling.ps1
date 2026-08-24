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
  [int]$SynthesisSlotsPerInstance = $(if ($env:VCS_STAGING_SYNTHESIS_SLOTS_PER_INSTANCE) {
    [int]$env:VCS_STAGING_SYNTHESIS_SLOTS_PER_INSTANCE
  } else { -1 }),
  [string]$ModelCoordinatorFunctionName = $env:VCS_STAGING_MODEL_COORDINATOR_FUNCTION_NAME,
  [string]$ModelCoordinatorAuthToken = $env:VCS_STAGING_MODEL_COORDINATOR_AUTH_TOKEN,
  [string]$PrimeAuthSecret = $env:VCS_STAGING_PRIME_SECRET,
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
if ($SynthesisSlotsPerInstance -lt 0) {
  $SynthesisSlotsPerInstance = [int]$cfg.synthesisSlotsPerInstance
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
if ([int]$cfg.scaleOutOccupancyPercent -lt 1 -or
  [int]$cfg.scaleOutOccupancyPercent -gt 99) {
  throw 'scaleOutOccupancyPercent must be from 1 to 99.'
}
if ([int]$cfg.scaleOutEvaluationPeriods -lt 1 -or
  [int]$cfg.scaleOutEvaluationPeriods -gt 5) {
  throw 'scaleOutEvaluationPeriods must be from 1 to 5.'
}
if ([int]$cfg.baselineScaleCapacity -lt 2 -or
  [int]$cfg.baselineScaleCapacity -gt $MaxCapacity) {
  throw "baselineScaleCapacity must be from 2 to MaxCapacity $MaxCapacity."
}
if ($SynthesisSlotsPerInstance -lt 1 -or
  $SynthesisSlotsPerInstance -gt 10) {
  throw 'SynthesisSlotsPerInstance must be from 1 to 10.'
}
if ([bool]$ModelCoordinatorFunctionName -xor [bool]$ModelCoordinatorAuthToken) {
  throw 'ModelCoordinatorFunctionName and ModelCoordinatorAuthToken must be provided together.'
}
if ($ModelCoordinatorFunctionName -and
  $ModelCoordinatorFunctionName -notmatch '^Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging-') {
  throw 'The model coordinator must use the approved staging Lambda prefix.'
}
if ($ModelCoordinatorAuthToken -and $ModelCoordinatorAuthToken -notmatch '^[0-9a-f]{64}$') {
  throw 'ModelCoordinatorAuthToken must be a 64-character lowercase hexadecimal token.'
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
if ([int]$cfg.publicPrimeMaxAttempts -lt 1 -or
  [int]$cfg.publicPrimeMaxAttempts -gt 30) {
  throw 'publicPrimeMaxAttempts must be from 1 to 30.'
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
  # Omit voiceProfileId deliberately: the public prime must exercise whichever
  # profile is active when this instance scales out, not a baked Dean constant.
  text = [string]$cfg.publicPrimeText
} | ConvertTo-Json -Compress
$publicPrimeBodyB64 = [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes($publicPrimeBody)
)
$publicPrimeAuthB64 = if ($PrimeAuthSecret) {
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PrimeAuthSecret))
} else { '' }

$userData = @'
#cloud-config
write_files:
  - path: /etc/systemd/system/gpu-inference-worker.service.d/staging-warm.conf
    owner: root:root
    permissions: '0644'
    content: |
      [Service]
      ExecStartPost=/home/ubuntu/VoiceCloning/scripts/warm-staging-deanvoice.sh
      Environment=MODEL_COORDINATOR_FUNCTION_NAME=__MODEL_COORDINATOR_FUNCTION_NAME__
      Environment=MODEL_COORDINATOR_REGION=__MODEL_COORDINATOR_REGION__
      Environment=MODEL_COORDINATOR_AUTH_TOKEN=__MODEL_COORDINATOR_AUTH_TOKEN__
      TimeoutStartSec=900
  - path: /usr/local/sbin/vcs-prime-public-route.sh
    owner: root:root
    permissions: '0755'
    content: |
      #!/usr/bin/env bash
      set -u

      prime_url='__PUBLIC_PRIME_URL__'
      prime_body_b64='__PUBLIC_PRIME_BODY_B64__'
      prime_auth_b64='__PUBLIC_PRIME_AUTH_B64__'
      delay_seconds=__PUBLIC_PRIME_DELAY_SECONDS__
      request_count=__PUBLIC_PRIME_REQUESTS__
      max_attempts=__PUBLIC_PRIME_MAX_ATTEMPTS__
      settle_seconds=__PUBLIC_PRIME_SETTLE_SECONDS__

      sleep "${delay_seconds}"
      prime_body="$(printf '%s' "${prime_body_b64}" | base64 --decode)"
      prime_auth="$(printf '%s' "${prime_auth_b64}" | base64 --decode)"
      pids=()
      for request_index in $(seq 1 "${request_count}"); do
        (
          response_path="/tmp/vcs-public-prime-${request_index}.response"
          for attempt in $(seq 1 "${max_attempts}"); do
            status="$(
              curl --silent --show-error \
                --max-time 60 \
                --output "${response_path}" \
                --write-out '%{http_code}' \
                --header 'Content-Type: application/json' \
                --header 'Cache-Control: no-cache' \
                ${prime_auth:+--header "Authorization: Bearer ${prime_auth}"} \
                --data-binary "${prime_body}" \
                "${prime_url}?instancePrime=$(date +%s)-${request_index}-${attempt}" \
                || true
            )"
            riff="$(head -c 4 "${response_path}" 2>/dev/null || true)"
            echo "public_prime request=${request_index} attempt=${attempt} status=${status:-000} riff=${riff}"
            if [[ "${status}" == '200' && "${riff}" == 'RIFF' ]]; then
              rm -f "${response_path}"
              exit 0
            fi
            rm -f "${response_path}"
            sleep $((attempt < 5 ? attempt : 5))
          done
          echo "public_prime request=${request_index} exhausted ${max_attempts} attempts" >&2
          exit 1
        ) &
        pids+=("$!")
      done
      failed=0
      for pid in "${pids[@]}"; do
        if ! wait "${pid}"; then
          failed=1
        fi
      done
      if [[ "${failed}" -ne 0 ]]; then
        echo 'public_prime failed; target is not event-ready' >&2
        exit 1
      fi

      sleep "${settle_seconds}"
      echo 'public_prime completed with verified public RIFF responses'
bootcmd:
  - [systemctl, disable, gpu-worker.service]
  - [systemctl, disable, --now, gpu-inference-worker.service]
  - [systemctl, disable, target-optimizer-inference.service]
  - [systemctl, mask, --now, apt-daily.service, apt-daily-upgrade.service, apt-daily.timer, apt-daily-upgrade.timer, unattended-upgrades.service, packagekit.service]
runcmd:
  - [systemctl, disable, --now, gpu-worker.service]
  - [systemctl, disable, --now, target-optimizer-inference.service]
  - [/home/ubuntu/VoiceCloning/scripts/install-resemblyzer.sh]
  - [systemctl, daemon-reload]
  - [systemctl, enable, gpu-inference-worker.service]
  - [systemctl, restart, gpu-inference-worker.service]
  - [systemctl, enable, --now, target-optimizer-inference.service]
  - [/usr/local/sbin/vcs-prime-public-route.sh]
'@
$userData = $userData.Replace('__PUBLIC_PRIME_URL__', [string]$cfg.publicPrimeUrl)
$userData = $userData.Replace('__PUBLIC_PRIME_BODY_B64__', $publicPrimeBodyB64)
$userData = $userData.Replace('__PUBLIC_PRIME_AUTH_B64__', $publicPrimeAuthB64)
$userData = $userData.Replace(
  '__MODEL_COORDINATOR_FUNCTION_NAME__',
  [string]$ModelCoordinatorFunctionName
)
$userData = $userData.Replace('__MODEL_COORDINATOR_REGION__', [string]$cfg.region)
$userData = $userData.Replace(
  '__MODEL_COORDINATOR_AUTH_TOKEN__',
  [string]$ModelCoordinatorAuthToken
)
$userData = $userData.Replace(
  '__PUBLIC_PRIME_DELAY_SECONDS__',
  [string][int]$cfg.publicPrimeDelaySeconds
)
$userData = $userData.Replace(
  '__PUBLIC_PRIME_REQUESTS__',
  [string][int]$cfg.publicPrimeRequestsPerInstance
)
$userData = $userData.Replace(
  '__PUBLIC_PRIME_MAX_ATTEMPTS__',
  [string][int]$cfg.publicPrimeMaxAttempts
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
    --tags "Key=CreatorId,Value=INTERNS2026" "Key=Project,Value=Interns2026" `
      "Key=Environment,Value=staging" "Key=ManagedBy,Value=VoiceCloningRepo"
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
      @{ Key = 'CreatorId'; Value = 'INTERNS2026' },
      @{ Key = 'Project'; Value = 'Interns2026' },
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
    --tag-specifications "ResourceType=launch-template,Tags=[{Key=CreatorId,Value=INTERNS2026},{Key=Project,Value=Interns2026},{Key=Environment,Value=staging},{Key=ManagedBy,Value=VoiceCloningRepo}]"
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
  $baselineScalePolicy = Invoke-AwsJson autoscaling put-scaling-policy --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --policy-name vcs-staging-inference-baseline-to-two `
    --policy-type StepScaling `
    --adjustment-type ExactCapacity `
    --estimated-instance-warmup $cfg.healthCheckGracePeriodSeconds `
    --metric-aggregation-type Maximum `
    --step-adjustments "MetricIntervalLowerBound=0,ScalingAdjustment=$($cfg.baselineScaleCapacity)"

  $scaleOutPolicy = Invoke-AwsJson autoscaling put-scaling-policy --region $cfg.region `
    --auto-scaling-group-name $cfg.autoScalingGroupName `
    --policy-name vcs-staging-inference-occupancy-step-out `
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

  # Keep the old rejection alarm as telemetry, but remove its action. A single
  # transient rejection previously scaled the quiet baseline from 1 to 11.
  Invoke-AwsJson cloudwatch put-metric-alarm --region $cfg.region `
    --alarm-name vcs-staging-inference-all-capacity-busy-1m `
    --alarm-description 'Telemetry only: Target Optimizer rejected at least one request in a one-minute CloudWatch period.' `
    --namespace AWS/ApplicationELB `
    --metric-name TargetControlRequestRejectCount `
    --dimensions "Name=LoadBalancer,Value=$albResource" `
    --statistic Sum --period 60 `
    --evaluation-periods 1 --datapoints-to-alarm 1 `
    --threshold $ScaleOutRejectsPerMinute --comparison-operator GreaterThanOrEqualToThreshold `
    --treat-missing-data notBreaching --no-actions-enabled

  $occupancyExpression = 'IF(FILL(free,0)<healthy*{0},100*(1-FILL(free,0)/(healthy*{0})),0)' -f $SynthesisSlotsPerInstance
  $occupancyQueries = @(
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
      Id = 'healthy'
      MetricStat = @{
        Metric = @{
          Namespace = 'AWS/ApplicationELB'
          MetricName = 'HealthyHostCount'
          Dimensions = @(
            @{ Name = 'LoadBalancer'; Value = $albResource },
            @{ Name = 'TargetGroup'; Value = $targetGroupResource }
          )
        }
        Period = 60
        Stat = 'Average'
      }
      ReturnData = $false
    },
    @{
      Id = 'rawoccupancy'
      Expression = $occupancyExpression
      Label = 'Raw occupied synthesis slots percent'
      ReturnData = $false
    },
    @{
      Id = 'fleetoccupancy'
      Expression = "IF(healthy>=$($cfg.baselineScaleCapacity),rawoccupancy,0)"
      Label = 'Fleet occupied synthesis slots percent'
      ReturnData = $true
    }
  ) | ConvertTo-Json -Depth 8 -Compress
  $occupancyQueriesPath = Join-Path $env:TEMP 'vcs-staging-occupancy-queries.json'
  [IO.File]::WriteAllText(
    $occupancyQueriesPath,
    $occupancyQueries,
    (New-Object Text.UTF8Encoding($false))
  )
  Invoke-AwsJson cloudwatch put-metric-alarm --region $cfg.region `
    --alarm-name vcs-staging-inference-occupancy-70pct-1m `
    --alarm-description "Add $ScaleOutAddCapacity GPUs at or above $($cfg.baselineScaleCapacity) healthy GPUs while occupied synthesis slots are at least $($cfg.scaleOutOccupancyPercent)%." `
    --metrics "file://$occupancyQueriesPath" `
    --evaluation-periods $cfg.scaleOutEvaluationPeriods `
    --datapoints-to-alarm $cfg.scaleOutEvaluationPeriods `
    --threshold $cfg.scaleOutOccupancyPercent `
    --comparison-operator GreaterThanOrEqualToThreshold `
    --treat-missing-data notBreaching `
    --alarm-actions $scaleOutPolicy.PolicyARN

  $baselineOccupancyQueries = @(
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
      Id = 'healthy'
      MetricStat = @{
        Metric = @{
          Namespace = 'AWS/ApplicationELB'
          MetricName = 'HealthyHostCount'
          Dimensions = @(
            @{ Name = 'LoadBalancer'; Value = $albResource },
            @{ Name = 'TargetGroup'; Value = $targetGroupResource }
          )
        }
        Period = 60
        Stat = 'Average'
      }
      ReturnData = $false
    },
    @{
      Id = 'rawoccupancy'
      Expression = $occupancyExpression
      Label = 'Raw occupied synthesis slots percent'
      ReturnData = $false
    },
    @{
      Id = 'baselineoccupancy'
      Expression = "IF(healthy<$($cfg.baselineScaleCapacity),rawoccupancy,0)"
      Label = 'Baseline occupied synthesis slots percent'
      ReturnData = $true
    }
  ) | ConvertTo-Json -Depth 8 -Compress
  $baselineOccupancyQueriesPath = Join-Path $env:TEMP 'vcs-staging-baseline-occupancy-queries.json'
  [IO.File]::WriteAllText(
    $baselineOccupancyQueriesPath,
    $baselineOccupancyQueries,
    (New-Object Text.UTF8Encoding($false))
  )
  Invoke-AwsJson cloudwatch put-metric-alarm --region $cfg.region `
    --alarm-name vcs-staging-inference-baseline-occupancy-70pct-1m `
    --alarm-description "Set capacity to $($cfg.baselineScaleCapacity) below that healthy count when occupied synthesis slots reach $($cfg.scaleOutOccupancyPercent)%." `
    --metrics "file://$baselineOccupancyQueriesPath" `
    --evaluation-periods $cfg.scaleOutEvaluationPeriods `
    --datapoints-to-alarm $cfg.scaleOutEvaluationPeriods `
    --threshold $cfg.scaleOutOccupancyPercent `
    --comparison-operator GreaterThanOrEqualToThreshold `
    --treat-missing-data notBreaching `
    --alarm-actions $baselineScalePolicy.PolicyARN

  # Target Optimizer emits no request-count datapoint during a completely quiet
  # minute. Treating missing data as breaching changes the alarm state, but gives
  # Step Scaling no numeric breach value and therefore performs no adjustment.
  # Fill missing minutes with an explicit zero so the -1 policy can execute.
  $idleRequestQueries = @(
    @{
      Id = 'requests'
      MetricStat = @{
        Metric = @{
          Namespace = 'AWS/ApplicationELB'
          MetricName = 'TargetControlRequestCount'
          Dimensions = @(@{ Name = 'LoadBalancer'; Value = $albResource })
        }
        Period = 60
        Stat = 'Sum'
      }
      ReturnData = $false
    },
    @{
      Id = 'filledrequests'
      Expression = 'FILL(requests,0)'
      Label = 'Target Optimizer requests (missing=0)'
      ReturnData = $true
    }
  ) | ConvertTo-Json -Depth 8 -Compress
  $idleRequestQueriesPath = Join-Path $env:TEMP 'vcs-staging-idle-request-queries.json'
  [IO.File]::WriteAllText(
    $idleRequestQueriesPath,
    $idleRequestQueries,
    (New-Object Text.UTF8Encoding($false))
  )
  Invoke-AwsJson cloudwatch put-metric-alarm --region $cfg.region `
    --alarm-name vcs-staging-inference-no-traffic-15m `
    --alarm-description 'Scale in one instance after fifteen consecutive minutes with no Target Optimizer requests.' `
    --metrics "file://$idleRequestQueriesPath" `
    --evaluation-periods $cfg.scaleInIdleMinutes `
    --datapoints-to-alarm $cfg.scaleInIdleMinutes `
    --threshold 1 --comparison-operator LessThanThreshold `
    --treat-missing-data missing `
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

Write-Host "Staging ASG provisioning complete. Apply=$Apply Event=$eventEnabled ListenerSwitched=$SwitchListener Desired=$DesiredCapacity PreWarm=$PreWarmCapacity Max=$MaxCapacity Occupancy=$($cfg.scaleOutOccupancyPercent)% Slots=$SynthesisSlotsPerInstance BaselineTarget=$($cfg.baselineScaleCapacity) ScaleOutAdd=$ScaleOutAddCapacity PreWarmAt=$PreWarmAt"
