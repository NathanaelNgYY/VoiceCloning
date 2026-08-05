param(
  [string]$Region = 'ap-northeast-2',
  [string]$FunctionName = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging',
  [string]$GatewayInstanceId = 'i-0f0da8be59367f7a8',
  [string]$LaunchTemplateId = 'lt-07728350a25e691a4',
  [string]$AutoScalingGroupName = 'vcs-staging-gpu-inference'
)

$ErrorActionPreference = 'Stop'

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$config = aws lambda get-function-configuration --region $Region `
  --function-name $FunctionName --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read the staging Lambda configuration.' }
$variables = @{}
foreach ($property in $config.Environment.Variables.PSObject.Properties) {
  $variables[$property.Name] = [string]$property.Value
}
$variables.LIVE_AUTH_LOADTEST_SECRET = $secret
$environmentPath = Join-Path $env:TEMP 'vcs-staging-prime-auth-environment.json'
[IO.File]::WriteAllText(
  $environmentPath,
  (@{ Variables = $variables } | ConvertTo-Json -Depth 4 -Compress),
  (New-Object Text.UTF8Encoding($false))
)
try {
  aws lambda update-function-configuration --region $Region `
    --function-name $FunctionName --environment "file://$environmentPath" `
    --query FunctionName --output text | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not update the Lambda prime credential.' }
  aws lambda wait function-updated-v2 --region $Region --function-name $FunctionName
  if ($LASTEXITCODE -ne 0) { throw 'Lambda prime credential update did not settle.' }
} finally {
  Remove-Item -LiteralPath $environmentPath -Force -ErrorAction SilentlyContinue
}

$secretB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secret))
$gatewayUpdate = @'
const fs=require('fs');
const path='live-gateway/.env';
const key='LIVE_AUTH_LOADTEST_SECRET';
const value=Buffer.from('__SECRET_B64__','base64').toString('utf8');
let source=fs.readFileSync(path,'utf8');
const pattern=new RegExp('^'+key+'=.*$','m');
source=pattern.test(source)
  ? source.replace(pattern,key+'='+value)
  : source.replace(/\s*$/, '\n'+key+'='+value+'\n');
fs.writeFileSync(path,source,{mode:0o600});
'@.Replace('__SECRET_B64__', $secretB64) -replace "`r?`n", ''
$commands = @(
  'set -e',
  'cd /home/ubuntu/VoiceCloning',
  "node -e `"$gatewayUpdate`"",
  'sudo systemctl restart voice-live-gateway',
  'sleep 8',
  'curl -sf http://127.0.0.1:3002/readyz >/dev/null'
)
$parameters = @{ commands = $commands } | ConvertTo-Json -Compress
$parametersPath = Join-Path $env:TEMP 'vcs-staging-prime-auth-ssm.json'
[IO.File]::WriteAllText(
  $parametersPath,
  $parameters,
  (New-Object Text.UTF8Encoding($false))
)
try {
  $commandId = aws ssm send-command --region $Region --instance-ids $GatewayInstanceId `
    --document-name AWS-RunShellScript --parameters "file://$parametersPath" `
    --query Command.CommandId --output text
  if ($LASTEXITCODE -ne 0) { throw 'Could not send the gateway credential update.' }
} finally {
  Remove-Item -LiteralPath $parametersPath -Force -ErrorAction SilentlyContinue
}
aws ssm wait command-executed --region $Region --command-id $commandId `
  --instance-id $GatewayInstanceId
if ($LASTEXITCODE -ne 0) { throw 'Gateway credential update did not complete.' }
$invocation = aws ssm get-command-invocation --region $Region --command-id $commandId `
  --instance-id $GatewayInstanceId --output json | ConvertFrom-Json
if ($invocation.Status -ne 'Success') { throw 'Gateway credential update failed.' }

$current = aws ec2 describe-launch-template-versions --region $Region `
  --launch-template-id $LaunchTemplateId --versions '$Default' `
  --query 'LaunchTemplateVersions[0]' --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read the default launch template.' }
$userData = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($current.LaunchTemplateData.UserData)
)
$headerPattern = "(?m)^\s*--header 'Authorization: Bearer .+' \\\r?$"
$authHeader = "                --header 'Authorization: Bearer $secret' \"
if ($userData -match $headerPattern) {
  $userData = [Regex]::Replace($userData, $headerPattern, $authHeader)
} else {
  $needle = "                --header 'Cache-Control: no-cache' \"
  if (-not $userData.Contains($needle)) { throw 'Public-prime header insertion point was not found.' }
  $userData = $userData.Replace($needle, "$needle`n$authHeader")
}
$override = @{
  UserData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($userData))
} | ConvertTo-Json -Compress
$overridePath = Join-Path $env:TEMP 'vcs-staging-prime-auth-launch-template.json'
[IO.File]::WriteAllText(
  $overridePath,
  $override,
  (New-Object Text.UTF8Encoding($false))
)
try {
  $version = aws ec2 create-launch-template-version --region $Region `
    --launch-template-id $LaunchTemplateId --source-version '$Default' `
    --version-description 'authenticated-public-prime' `
    --launch-template-data "file://$overridePath" `
    --query LaunchTemplateVersion.VersionNumber --output text
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the authenticated launch template.' }
} finally {
  Remove-Item -LiteralPath $overridePath -Force -ErrorAction SilentlyContinue
}
aws ec2 modify-launch-template --region $Region --launch-template-id $LaunchTemplateId `
  --default-version $version --query LaunchTemplate.DefaultVersionNumber --output text | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not promote the authenticated launch template.' }
aws autoscaling update-auto-scaling-group --region $Region `
  --auto-scaling-group-name $AutoScalingGroupName `
  --launch-template "LaunchTemplateId=$LaunchTemplateId,Version=`$Default"
if ($LASTEXITCODE -ne 0) { throw 'Could not apply the authenticated launch template to the ASG.' }

Write-Host "Staging prime authentication rotated; launch template version $version is default."
