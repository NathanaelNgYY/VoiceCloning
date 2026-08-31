param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [string]$SupervisorOid,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$repo = Resolve-Path "$PSScriptRoot\.."

if ($DryRun) { Write-Host "[dry-run] package lambda; ensure $($cfg.lambdaMemoryMb) MB; update-function-code $($cfg.lambdaFunction) ($Env)"; exit 0 }
Push-Location "$repo\lambda"
npm run package:function-url
$rc = $LASTEXITCODE
if ($rc -eq 0 -and $cfg.coordinatorFunction) {
  npm run package:model-coordinator
  $rc = $LASTEXITCODE
}
Pop-Location
if ($rc -ne 0) { throw "package failed" }
# Merge an env file over the function's LIVE configuration instead of replacing
# it. update-function-configuration overwrites the whole variable map, and the
# console-set secrets (API keys) exist only there — the .env.deployment files are
# git-tracked, so keys are deliberately absent from them.
function Sync-LambdaEnvironment {
  param(
    [Parameter(Mandatory)][string]$FunctionName,
    [Parameter(Mandatory)][string]$EnvFile,
    [Parameter(Mandatory)][string]$Region,
    [string]$SupervisorOid
  )

  $currentConfig = aws lambda get-function-configuration `
    --region $Region `
    --function-name $FunctionName `
    --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "get-function-configuration failed for $FunctionName" }

  $variables = @{}
  foreach ($property in $currentConfig.Environment.Variables.PSObject.Properties) {
    $variables[$property.Name] = [string]$property.Value
  }
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*(?:#|$)') { continue }
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      throw "Invalid deployment environment line in $EnvFile"
    }
    $variables[$Matches[1]] = $Matches[2]
  }
  if ($SupervisorOid) {
    if ($SupervisorOid -notmatch '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
      throw 'SupervisorOid must be a raw Entra object ID UUID.'
    }
    $supervisorOids = @(
      [string]$variables['SUPERVISOR_OIDS'] -split ',' |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
    )
    if ($supervisorOids -notcontains $SupervisorOid) {
      $supervisorOids += $SupervisorOid
    }
    $variables['SUPERVISOR_OIDS'] = $supervisorOids -join ','
  }

  $safeName = $FunctionName -replace '[^A-Za-z0-9]', '-'
  $environmentPath = Join-Path $env:TEMP "voice-cloning-lambda-$safeName-environment.json"
  $environmentJson = @{ Variables = $variables } | ConvertTo-Json -Depth 4 -Compress
  [IO.File]::WriteAllText(
    $environmentPath,
    $environmentJson,
    (New-Object Text.UTF8Encoding($false))
  )
  try {
    aws lambda update-function-configuration `
      --region $Region `
      --function-name $FunctionName `
      --environment "file://$environmentPath" `
      --query '{FunctionName:FunctionName,LastModified:LastModified}' `
      --output json
    if ($LASTEXITCODE -ne 0) { throw "update-function-configuration failed for $FunctionName" }
    aws lambda wait function-updated-v2 `
      --region $Region `
      --function-name $FunctionName
    if ($LASTEXITCODE -ne 0) { throw "waiting for function configuration failed for $FunctionName" }
  } finally {
    Remove-Item -LiteralPath $environmentPath -Force -ErrorAction SilentlyContinue
  }
}

$deploymentEnvName = if ($Env -eq 'dev') { '.env.deployment' } else { ".env.deployment.$Env" }
$deploymentEnv = Join-Path $repo "lambda\$deploymentEnvName"
if (Test-Path $deploymentEnv) {
  Sync-LambdaEnvironment -FunctionName $cfg.lambdaFunction -EnvFile $deploymentEnv `
    -Region $cfg.region -SupervisorOid $SupervisorOid
}

# The model coordinator is a SEPARATE function with its own settings. Nothing
# here configured it before, so anything set on it lived only in the console and
# reverted to the code default on a fresh provision — silently, since the default
# is a plausible-looking number rather than an error.
$coordinatorEnv = Join-Path $repo "lambda\.env.deployment.coordinator.$Env"
if ($cfg.coordinatorFunction -and (Test-Path $coordinatorEnv)) {
  Sync-LambdaEnvironment -FunctionName $cfg.coordinatorFunction -EnvFile $coordinatorEnv `
    -Region $cfg.region

  aws lambda update-function-code --region $cfg.region `
    --function-name $cfg.coordinatorFunction `
    --zip-file "fileb://$repo/lambda/.dist/model-coordinator.zip" `
    --query '{FunctionName:FunctionName,LastModified:LastModified,CodeSha256:CodeSha256}' `
    --output json
  if ($LASTEXITCODE -ne 0) { throw "coordinator update-function-code failed" }
  aws lambda wait function-updated-v2 --region $cfg.region `
    --function-name $cfg.coordinatorFunction
  if ($LASTEXITCODE -ne 0) { throw "waiting for coordinator code update failed" }
}

if ($cfg.lambdaMemoryMb) {
  $currentMemory = aws lambda get-function-configuration `
    --region $cfg.region `
    --function-name $cfg.lambdaFunction `
    --query MemorySize `
    --output text
  if ($LASTEXITCODE -ne 0) { throw "get-function-configuration failed" }
  if ([int]$currentMemory -ne [int]$cfg.lambdaMemoryMb) {
    aws lambda update-function-configuration `
      --region $cfg.region `
      --function-name $cfg.lambdaFunction `
      --memory-size $cfg.lambdaMemoryMb
    if ($LASTEXITCODE -ne 0) { throw "update-function-configuration failed" }
    aws lambda wait function-updated-v2 `
      --region $cfg.region `
      --function-name $cfg.lambdaFunction
    if ($LASTEXITCODE -ne 0) { throw "waiting for function configuration failed" }
  }
}
aws lambda update-function-code --region $cfg.region --function-name $cfg.lambdaFunction `
  --zip-file "fileb://$repo/lambda/.dist/voice-cloning-function-url.zip" `
  --query '{FunctionName:FunctionName,LastModified:LastModified,CodeSha256:CodeSha256}' `
  --output json
if ($LASTEXITCODE -ne 0) { throw "update-function-code failed" }
Write-Host "Deployed lambda to $Env ($($cfg.lambdaFunction))"
