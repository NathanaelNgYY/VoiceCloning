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
aws lambda update-function-code --region $cfg.region --function-name $cfg.lambdaFunction --zip-file "fileb://$repo/lambda/.dist/voice-cloning-function-url.zip"
if ($LASTEXITCODE -ne 0) { throw "update-function-code failed" }
Write-Host "Deployed lambda to $Env ($($cfg.lambdaFunction))"
