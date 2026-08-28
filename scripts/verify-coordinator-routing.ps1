param(
  [string]$Region = 'ap-northeast-2',
  [string]$AccountId = '329599637774',
  [string]$VoiceProfileId = 'deanvoice-v1'
)

$ErrorActionPreference = 'Stop'
foreach ($name in @('ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'SESSION_TOKEN')) {
  $value = [Environment]::GetEnvironmentVariable("VCS_AWS_$name", 'User')
  if (-not $value) { throw "User-level VCS_AWS_$name is missing" }
  Set-Item -Path "Env:AWS_$name" -Value $value
}
$assumed = aws sts assume-role `
  --role-arn "arn:aws:iam::$AccountId`:role/Liu_Teng_Yu_Intern2026" `
  --role-session-name 'codex-routing-readback' --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $assumed.Credentials) { throw 'AssumeRole failed' }
$env:AWS_ACCESS_KEY_ID = $assumed.Credentials.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $assumed.Credentials.SecretAccessKey
$env:AWS_SESSION_TOKEN = $assumed.Credentials.SessionToken
if ((aws sts get-caller-identity --query Account --output text) -ne $AccountId) {
  throw "Refusing to verify outside AWS account $AccountId"
}

$event = @{
  version = '2.0'
  rawPath = '/api/models/select'
  headers = @{}
  requestContext = @{ http = @{ method = 'POST' } }
  body = (@{ voiceProfileId = $VoiceProfileId } | ConvertTo-Json -Compress)
} | ConvertTo-Json -Depth 6 -Compress
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($event))
$targets = @(
  @{ Name = 'dev'; Function = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project' },
  @{ Name = 'staging'; Function = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging' }
)

foreach ($target in $targets) {
  $outputPath = Join-Path $env:TEMP "vcs-$($target.Name)-coordinator-readback.json"
  try {
    aws lambda invoke `
      --region $Region --function-name $target.Function `
      --payload $payload $outputPath `
      --query '{StatusCode:StatusCode,FunctionError:FunctionError}' --output json
    if ($LASTEXITCODE -ne 0) { throw "Invocation failed for $($target.Name)" }
    $reply = Get-Content $outputPath -Raw | ConvertFrom-Json
    $body = $reply.body | ConvertFrom-Json
    [pscustomobject]@{
      Environment = $target.Name
      HttpStatus = $reply.statusCode
      CoordinatorState = $body.coordinatorCapacity.state
      CanStart = $body.coordinatorCapacity.canStartConversation
      Simulated = $body.coordinatorCapacity.simulated
      Action = $body.coordinatorCapacity.capacityAction
      AvailableSlots = $body.coordinatorCapacity.availableSlots
      CapacityTight = $body.coordinatorCapacity.capacityTight
      Message = $body.coordinatorCapacity.message
      Error = $body.error
    } | ConvertTo-Json -Compress
  } finally {
    Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
  }
}

aws autoscaling describe-auto-scaling-groups `
  --region $Region --auto-scaling-group-names vcs-staging-gpu-inference `
  --query 'AutoScalingGroups[0].{Min:MinSize,Desired:DesiredCapacity,Max:MaxSize,Instances:Instances[].{Id:InstanceId,State:LifecycleState,Health:HealthStatus}}' `
  --output json

foreach ($functionName in $targets.Function) {
  aws lambda get-function-configuration `
    --region $Region --function-name $functionName `
    --query '{FunctionName:FunctionName,CodeSha256:CodeSha256,Coordinator:Environment.Variables.MODEL_COORDINATOR_FUNCTION_NAME}' `
    --output json
}
