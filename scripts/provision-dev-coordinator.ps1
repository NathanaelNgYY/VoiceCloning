param(
  [string]$Region = 'ap-northeast-2',
  [string]$AccountId = '329599637774',
  [string]$RoleName = 'Liu_Teng_Yu_Intern2026'
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$devFunction = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev-coordinator'
$stagingFunction = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging-coordinator'
$coordinatorTable = 'vcs-staging-model-workers'
$zipPath = Join-Path $repo 'lambda\.dist\model-coordinator.zip'

foreach ($name in @('ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'SESSION_TOKEN')) {
  $value = [Environment]::GetEnvironmentVariable("VCS_AWS_$name", 'User')
  if (-not $value) { throw "User-level VCS_AWS_$name is missing" }
  Set-Item -Path "Env:AWS_$name" -Value $value
}

$assumed = aws sts assume-role `
  --role-arn "arn:aws:iam::$AccountId`:role/$RoleName" `
  --role-session-name 'codex-dev-coordinator-provision' `
  --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $assumed.Credentials) { throw 'AssumeRole failed' }
$env:AWS_ACCESS_KEY_ID = $assumed.Credentials.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $assumed.Credentials.SecretAccessKey
$env:AWS_SESSION_TOKEN = $assumed.Credentials.SessionToken

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne $AccountId) {
  throw "Refusing to provision outside AWS account $AccountId"
}
Write-Host "Using $($identity.Arn)"

$staging = aws lambda get-function-configuration `
  --region $Region --function-name $stagingFunction --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Staging coordinator configuration' }
$authToken = [string]$staging.Environment.Variables.MODEL_COORDINATOR_AUTH_TOKEN
if (-not $authToken) { throw 'The Staging coordinator auth token is missing' }

$variables = @{
  MODEL_COORDINATOR_MODE = 'routing-only'
  MODEL_COORDINATOR_TABLE = $coordinatorTable
  MODEL_COORDINATOR_INSTANCE_IDS = 'i-03f258d470a2fa73f,i-0048470294e4ec518'
  MODEL_REASSIGN_IDLE_MS = '0'
  MODEL_BOOT_ESTIMATE_SECONDS = '60'
  MODEL_COORDINATOR_AUTH_TOKEN = $authToken
}
$environmentPath = Join-Path $env:TEMP 'vcs-dev-coordinator-environment.json'
[IO.File]::WriteAllText(
  $environmentPath,
  (@{ Variables = $variables } | ConvertTo-Json -Depth 4 -Compress),
  (New-Object Text.UTF8Encoding($false))
)

try {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  aws lambda get-function --region $Region --function-name $devFunction --output json 2>$null | Out-Null
  $exists = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $previousErrorAction
  $vpc = "SubnetIds=$($staging.VpcConfig.SubnetIds -join ','),SecurityGroupIds=$($staging.VpcConfig.SecurityGroupIds -join ',')"
  if ($exists) {
    aws lambda update-function-configuration `
      --region $Region --function-name $devFunction `
      --timeout $staging.Timeout --memory-size $staging.MemorySize `
      --vpc-config $vpc --environment "file://$environmentPath" `
      --query '{FunctionName:FunctionName,State:State,LastUpdateStatus:LastUpdateStatus}' --output json
    if ($LASTEXITCODE -ne 0) { throw 'Failed to update the Dev coordinator configuration' }
    aws lambda wait function-updated-v2 --region $Region --function-name $devFunction
    aws lambda update-function-code `
      --region $Region --function-name $devFunction --zip-file "fileb://$zipPath" `
      --query '{FunctionName:FunctionName,LastUpdateStatus:LastUpdateStatus,CodeSha256:CodeSha256}' --output json
    if ($LASTEXITCODE -ne 0) { throw 'Failed to update the Dev coordinator code' }
  } else {
    aws lambda create-function `
      --region $Region --function-name $devFunction `
      --runtime $staging.Runtime --role $staging.Role --handler index.handler `
      --timeout $staging.Timeout --memory-size $staging.MemorySize `
      --architectures $staging.Architectures[0] `
      --ephemeral-storage "Size=$($staging.EphemeralStorage.Size)" `
      --vpc-config $vpc --environment "file://$environmentPath" `
      --zip-file "fileb://$zipPath" `
      --query '{FunctionName:FunctionName,State:State,LastUpdateStatus:LastUpdateStatus}' --output json
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the Dev coordinator function' }
  }
  aws lambda wait function-active-v2 --region $Region --function-name $devFunction
} finally {
  Remove-Item -LiteralPath $environmentPath -Force -ErrorAction SilentlyContinue
}

aws lambda get-function-configuration `
  --region $Region --function-name $devFunction `
  --query '{FunctionName:FunctionName,State:State,LastUpdateStatus:LastUpdateStatus,Mode:Environment.Variables.MODEL_COORDINATOR_MODE,Table:Environment.Variables.MODEL_COORDINATOR_TABLE,Instances:Environment.Variables.MODEL_COORDINATOR_INSTANCE_IDS,VpcId:VpcConfig.VpcId}' `
  --output json
