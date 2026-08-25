param(
  [string]$Region = 'ap-northeast-2',
  [string]$FunctionName = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging-coordinator',
  [string]$AutoScalingGroupName = 'vcs-staging-gpu-inference'
)

$ErrorActionPreference = 'Stop'

function Invoke-AwsJson {
  $raw = & aws @args --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS command failed: aws $($args[0]) $($args[1])" }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Write-PrivateJson([string]$Path, $Value) {
  [IO.File]::WriteAllText(
    $Path,
    ($Value | ConvertTo-Json -Depth 12 -Compress),
    (New-Object Text.UTF8Encoding($false))
  )
}

function Wait-SsmCommand([string]$CommandId, [string]$InstanceId) {
  for ($attempt = 0; $attempt -lt 180; $attempt += 1) {
    $invocation = Invoke-AwsJson ssm get-command-invocation --region $Region `
      --command-id $CommandId --instance-id $InstanceId
    if ($invocation.Status -eq 'Success') { return }
    if ($invocation.Status -in @('Cancelled', 'Cancelling', 'Failed', 'TimedOut')) {
      throw "SSM command $CommandId ended in $($invocation.Status) on $InstanceId."
    }
    Start-Sleep -Seconds 5
  }
  throw "SSM command $CommandId did not finish within 15 minutes on $InstanceId."
}

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$group = Invoke-AwsJson autoscaling describe-auto-scaling-groups --region $Region `
  --auto-scaling-group-names $AutoScalingGroupName
if ($group.AutoScalingGroups.Count -ne 1) { throw 'The staging inference ASG was not found.' }
$asg = $group.AutoScalingGroups[0]
$launchTemplateId = [string]$asg.LaunchTemplate.LaunchTemplateId
if ([string]::IsNullOrWhiteSpace($launchTemplateId)) { throw 'The ASG has no launch template.' }

$current = Invoke-AwsJson ec2 describe-launch-template-versions --region $Region `
  --launch-template-id $launchTemplateId --versions '$Default'
$currentVersion = $current.LaunchTemplateVersions[0]
$userData = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($currentVersion.LaunchTemplateData.UserData)
)
$tokenPattern = '(?m)^\s*Environment=MODEL_COORDINATOR_AUTH_TOKEN=.*$'
if ($userData -notmatch $tokenPattern) { throw 'Coordinator token was not found in launch-template user data.' }
$userData = [Regex]::Replace(
  $userData,
  $tokenPattern,
  "      Environment=MODEL_COORDINATOR_AUTH_TOKEN=$secret"
)
$launchPath = Join-Path $env:TEMP ('vcs-coordinator-auth-lt-' + [guid]::NewGuid().ToString('N') + '.json')
Write-PrivateJson $launchPath @{
  UserData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($userData))
}
try {
  $version = Invoke-AwsJson ec2 create-launch-template-version --region $Region `
    --launch-template-id $launchTemplateId --source-version '$Default' `
    --version-description 'rotate-staging-coordinator-auth' `
    --launch-template-data "file://$launchPath"
} finally {
  Remove-Item -LiteralPath $launchPath -Force -ErrorAction SilentlyContinue
}
$newVersion = [string]$version.LaunchTemplateVersion.VersionNumber
Invoke-AwsJson ec2 modify-launch-template --region $Region --launch-template-id $launchTemplateId `
  --default-version $newVersion | Out-Null
& aws autoscaling update-auto-scaling-group --region $Region `
  --auto-scaling-group-name $AutoScalingGroupName `
  --launch-template "LaunchTemplateId=$launchTemplateId,Version=`$Default"
if ($LASTEXITCODE -ne 0) { throw 'Could not apply the rotated launch template to the ASG.' }

$instanceIds = @($asg.Instances | Where-Object LifecycleState -eq 'InService' | ForEach-Object InstanceId)
if ($instanceIds.Count -gt 0) {
  # The generated base64url value contains no shell quoting characters.
  $escapedSecret = $secret
  $remoteCommands = @(
    'set -e',
    "sudo sed -i 's|^[[:space:]]*Environment=MODEL_COORDINATOR_AUTH_TOKEN=.*$|Environment=MODEL_COORDINATOR_AUTH_TOKEN=$escapedSecret|' /etc/systemd/system/gpu-inference-worker.service.d/staging-warm.conf",
    'sudo systemctl daemon-reload'
  )
  $parametersPath = Join-Path $env:TEMP ('vcs-coordinator-auth-ssm-' + [guid]::NewGuid().ToString('N') + '.json')
  Write-PrivateJson $parametersPath @{ commands = $remoteCommands }
  try {
    $staged = Invoke-AwsJson ssm send-command --region $Region --instance-ids @instanceIds `
      --document-name AWS-RunShellScript --parameters "file://$parametersPath"
  } finally {
    Remove-Item -LiteralPath $parametersPath -Force -ErrorAction SilentlyContinue
  }
  $stageCommandId = [string]$staged.Command.CommandId
  foreach ($instanceId in $instanceIds) {
    Wait-SsmCommand $stageCommandId $instanceId
  }
}

$config = Invoke-AwsJson lambda get-function-configuration --region $Region --function-name $FunctionName
$variables = @{}
foreach ($property in $config.Environment.Variables.PSObject.Properties) {
  $variables[$property.Name] = [string]$property.Value
}
$variables.MODEL_COORDINATOR_AUTH_TOKEN = $secret
$environmentPath = Join-Path $env:TEMP ('vcs-coordinator-auth-env-' + [guid]::NewGuid().ToString('N') + '.json')
Write-PrivateJson $environmentPath @{ Variables = $variables }
try {
  & aws lambda update-function-configuration --region $Region --function-name $FunctionName `
    --environment "file://$environmentPath" --query FunctionName --output text | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not rotate coordinator Lambda auth.' }
} finally {
  Remove-Item -LiteralPath $environmentPath -Force -ErrorAction SilentlyContinue
}
& aws lambda wait function-updated-v2 --region $Region --function-name $FunctionName
if ($LASTEXITCODE -ne 0) { throw 'Coordinator Lambda auth update did not settle.' }

if ($instanceIds.Count -gt 0) {
  $restartPath = Join-Path $env:TEMP ('vcs-coordinator-restart-' + [guid]::NewGuid().ToString('N') + '.json')
  Write-PrivateJson $restartPath @{ commands = @(
    'set -e',
    'sudo systemctl restart gpu-inference-worker.service',
    'for attempt in $(seq 1 60); do curl -sf http://127.0.0.1:3003/health >/dev/null && exit 0; sleep 5; done',
    'exit 1'
  ) }
  try {
    $restarted = Invoke-AwsJson ssm send-command --region $Region --instance-ids @instanceIds `
      --document-name AWS-RunShellScript --parameters "file://$restartPath"
  } finally {
    Remove-Item -LiteralPath $restartPath -Force -ErrorAction SilentlyContinue
  }
  $restartCommandId = [string]$restarted.Command.CommandId
  foreach ($instanceId in $instanceIds) {
    Wait-SsmCommand $restartCommandId $instanceId
  }
}

[pscustomobject]@{
  FunctionName = $FunctionName
  LaunchTemplateId = $launchTemplateId
  DefaultVersion = $newVersion
  WorkersRotated = $instanceIds.Count
  SecretPrinted = $false
} | ConvertTo-Json
