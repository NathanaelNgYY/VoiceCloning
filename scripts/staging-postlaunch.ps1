# One-time post-launch step for staging. PowerShell 5 compatible.
# Run in a window that has FRESH identity-account creds in $Env:AWS_ACCESS_KEY_ID etc.
$ErrorActionPreference = 'Continue'
$Id = 'i-0f0da8be59367f7a8'
$Region = 'ap-northeast-2'
$Fn = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging'

# Hop into the project account
$json = cmd /c "aws sts assume-role --role-arn arn:aws:iam::329599637774:role/Liu_Teng_Yu_Intern2026 --role-session-name postlaunch --output json 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host "ASSUME-ROLE FAILED - credentials expired? Paste fresh `$Env:AWS_... lines and rerun." -ForegroundColor Red
  Write-Host ($json -join "`n")
  exit 1
}
$c = (($json -join "`n") | ConvertFrom-Json).Credentials
$Env:AWS_ACCESS_KEY_ID = $c.AccessKeyId
$Env:AWS_SECRET_ACCESS_KEY = $c.SecretAccessKey
$Env:AWS_SESSION_TOKEN = $c.SessionToken
Write-Host "assumed project role OK"

# 0) ALB egress to staging GPU SG (health checks time out without this)
foreach ($port in 3001,3002,3003) {
  $out = cmd /c "aws ec2 authorize-security-group-egress --region $Region --group-id sg-0027def934fd4cb8d --protocol tcp --port $port --source-group sg-03a2f3dddf4eff21c 2>&1"
  if ($LASTEXITCODE -eq 0 -or ($out -join '') -match 'Duplicate') { Write-Host "egress $port OK" } else { Write-Host "egress $port FAILED: $out" -ForegroundColor Red; exit 1 }
}

# 1) Register in all 3 target groups (idempotent)
$tgs = @(
  "arn:aws:elasticloadbalancing:ap-northeast-2:329599637774:targetgroup/vcs-staging-tg-3001/782635b79a09031d",
  "arn:aws:elasticloadbalancing:ap-northeast-2:329599637774:targetgroup/vcs-staging-tg-3002/77d07064082cbead",
  "arn:aws:elasticloadbalancing:ap-northeast-2:329599637774:targetgroup/vcs-staging-tg-3003/3449adfcba215f65"
)
foreach ($tg in $tgs) {
  $out = cmd /c "aws elbv2 register-targets --region $Region --target-group-arn $tg --targets Id=$Id 2>&1"
  if ($LASTEXITCODE -ne 0) { Write-Host "register FAILED: $out" -ForegroundColor Red; exit 1 }
  Write-Host "registered $($tg.Split('/')[1])"
}

# 2) Set GPU_INSTANCE_ID in the Lambda env (change only that key)
$out = cmd /c "aws lambda get-function-configuration --region $Region --function-name $Fn --query Environment.Variables --output json 2>&1"
if ($LASTEXITCODE -ne 0) { Write-Host "lambda read FAILED: $out" -ForegroundColor Red; exit 1 }
$envobj = ($out -join "`n") | ConvertFrom-Json
$envmap = @{}
foreach ($p in $envobj.PSObject.Properties) { $envmap[$p.Name] = $p.Value }
Write-Host "old GPU_INSTANCE_ID: $($envmap['GPU_INSTANCE_ID'])"
$envmap['GPU_INSTANCE_ID'] = $Id
$tmp = Join-Path $env:TEMP 'staging-lambda-env.json'
@{ Variables = $envmap } | ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii $tmp
$out = cmd /c "aws lambda update-function-configuration --region $Region --function-name $Fn --environment file://$tmp --query Environment.Variables.GPU_INSTANCE_ID --output text 2>&1"
if ($LASTEXITCODE -ne 0) { Write-Host "lambda update FAILED: $out" -ForegroundColor Red; exit 1 }
Remove-Item $tmp
Write-Host "new GPU_INSTANCE_ID: $out"
Write-Host "DONE - tell Claude to continue" -ForegroundColor Green
