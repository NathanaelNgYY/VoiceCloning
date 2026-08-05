param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$repo = Resolve-Path "$PSScriptRoot\.."

if ($DryRun) { Write-Host "[dry-run] package lambda; ensure $($cfg.lambdaMemoryMb) MB; update-function-code $($cfg.lambdaFunction) ($Env)"; exit 0 }
Push-Location "$repo\lambda"
npm run package:function-url
$rc = $LASTEXITCODE
Pop-Location
if ($rc -ne 0) { throw "package failed" }
$deploymentEnv = Join-Path $repo "lambda\.env.deployment.$Env"
if (Test-Path $deploymentEnv) {
  $currentConfig = aws lambda get-function-configuration `
    --region $cfg.region `
    --function-name $cfg.lambdaFunction `
    --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "get-function-configuration failed" }

  $variables = @{}
  foreach ($property in $currentConfig.Environment.Variables.PSObject.Properties) {
    $variables[$property.Name] = [string]$property.Value
  }
  foreach ($line in Get-Content $deploymentEnv) {
    if ($line -match '^\s*(?:#|$)') { continue }
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      throw "Invalid deployment environment line in $deploymentEnv"
    }
    $variables[$Matches[1]] = $Matches[2]
  }

  $environmentPath = Join-Path $env:TEMP "voice-cloning-lambda-$Env-environment.json"
  $environmentJson = @{ Variables = $variables } | ConvertTo-Json -Depth 4 -Compress
  [IO.File]::WriteAllText(
    $environmentPath,
    $environmentJson,
    (New-Object Text.UTF8Encoding($false))
  )
  try {
    aws lambda update-function-configuration `
      --region $cfg.region `
      --function-name $cfg.lambdaFunction `
      --environment "file://$environmentPath" `
      --query '{FunctionName:FunctionName,LastModified:LastModified}' `
      --output json
    if ($LASTEXITCODE -ne 0) { throw "update-function-configuration failed" }
    aws lambda wait function-updated-v2 `
      --region $cfg.region `
      --function-name $cfg.lambdaFunction
    if ($LASTEXITCODE -ne 0) { throw "waiting for function configuration failed" }
  } finally {
    Remove-Item -LiteralPath $environmentPath -Force -ErrorAction SilentlyContinue
  }
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
