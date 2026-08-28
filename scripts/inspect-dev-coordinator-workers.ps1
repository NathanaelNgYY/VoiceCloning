param(
  [string]$Region = 'ap-northeast-2',
  [string]$AccountId = '329599637774'
)

$ErrorActionPreference = 'Stop'
$instanceIds = @('i-03f258d470a2fa73f', 'i-0048470294e4ec518')
foreach ($name in @('ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'SESSION_TOKEN')) {
  $value = [Environment]::GetEnvironmentVariable("VCS_AWS_$name", 'User')
  if (-not $value) { throw "User-level VCS_AWS_$name is missing" }
  Set-Item -Path "Env:AWS_$name" -Value $value
}
$assumed = aws sts assume-role `
  --role-arn "arn:aws:iam::$AccountId`:role/Liu_Teng_Yu_Intern2026" `
  --role-session-name 'codex-dev-worker-inspection' --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $assumed.Credentials) { throw 'AssumeRole failed' }
$env:AWS_ACCESS_KEY_ID = $assumed.Credentials.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $assumed.Credentials.SecretAccessKey
$env:AWS_SESSION_TOKEN = $assumed.Credentials.SessionToken
if ((aws sts get-caller-identity --query Account --output text) -ne $AccountId) {
  throw "Refusing to inspect outside AWS account $AccountId"
}

$commands = @(
  'set -eu',
  'echo "inferenceService=$(systemctl is-active gpu-inference-worker.service || true)"',
  'environment="$(systemctl show gpu-inference-worker.service -p Environment --value || true)"',
  'token="$(printf "%s" "$environment" | tr " " "\n" | sed -n "s/^MODEL_COORDINATOR_AUTH_TOKEN=//p" | tail -1)"',
  'if [ -n "$token" ]; then echo tokenConfigured=yes; else echo tokenConfigured=no; fi',
  'code="$(curl -sS -o /tmp/vcs-coordinator-status.json -w "%{http_code}" -H "X-VCS-Coordinator-Token: ${token}" http://127.0.0.1:3003/coordinator/status || true)"',
  'echo "coordinatorHttp=${code}"',
  'if [ "$code" = "200" ]; then jq -c "{ready,active,queued,maxSlots,modelKey,voiceProfileId,draining}" /tmp/vcs-coordinator-status.json; fi'
)
$parametersPath = Join-Path $env:TEMP 'vcs-dev-worker-inspection-parameters.json'
[IO.File]::WriteAllText(
  $parametersPath,
  (@{ commands = $commands } | ConvertTo-Json -Depth 4 -Compress),
  (New-Object Text.UTF8Encoding($false))
)
try {
  $sent = aws ssm send-command `
    --region $Region --instance-ids $instanceIds `
    --document-name AWS-RunShellScript `
    --parameters "file://$parametersPath" `
    --query 'Command.CommandId' --output text
  if ($LASTEXITCODE -ne 0 -or -not $sent) { throw 'Failed to send worker inspection command' }
  foreach ($instanceId in $instanceIds) {
    aws ssm wait command-executed `
      --region $Region --command-id $sent --instance-id $instanceId
    aws ssm get-command-invocation `
      --region $Region --command-id $sent --instance-id $instanceId `
      --query '{InstanceId:InstanceId,Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}' `
      --output json
  }
} finally {
  Remove-Item -LiteralPath $parametersPath -Force -ErrorAction SilentlyContinue
}
