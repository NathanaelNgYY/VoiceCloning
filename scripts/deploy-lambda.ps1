param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$repo = Resolve-Path "$PSScriptRoot\.."

if ($DryRun) { Write-Host "[dry-run] package lambda; update-function-code $($cfg.lambdaFunction) ($Env)"; exit 0 }
Push-Location "$repo\lambda"
npm run package:function-url
$rc = $LASTEXITCODE
Pop-Location
if ($rc -ne 0) { throw "package failed" }
aws lambda update-function-code --region $cfg.region --function-name $cfg.lambdaFunction --zip-file "fileb://$repo/lambda/.dist/voice-cloning-function-url.zip"
if ($LASTEXITCODE -ne 0) { throw "update-function-code failed" }
Write-Host "Deployed lambda to $Env ($($cfg.lambdaFunction))"
