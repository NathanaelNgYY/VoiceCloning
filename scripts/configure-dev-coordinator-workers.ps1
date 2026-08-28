param(
  [string]$Region = 'ap-northeast-2',
  [string]$AccountId = '329599637774'
)

$ErrorActionPreference = 'Stop'
$instanceIds = @('i-03f258d470a2fa73f', 'i-0048470294e4ec518')
$coordinatorFunction = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev-coordinator'
foreach ($name in @('ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'SESSION_TOKEN')) {
  $value = [Environment]::GetEnvironmentVariable("VCS_AWS_$name", 'User')
  if (-not $value) { throw "User-level VCS_AWS_$name is missing" }
  Set-Item -Path "Env:AWS_$name" -Value $value
}
$assumed = aws sts assume-role `
  --role-arn "arn:aws:iam::$AccountId`:role/Liu_Teng_Yu_Intern2026" `
  --role-session-name 'codex-dev-worker-coordinator-config' --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $assumed.Credentials) { throw 'AssumeRole failed' }
$env:AWS_ACCESS_KEY_ID = $assumed.Credentials.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $assumed.Credentials.SecretAccessKey
$env:AWS_SESSION_TOKEN = $assumed.Credentials.SessionToken
if ((aws sts get-caller-identity --query Account --output text) -ne $AccountId) {
  throw "Refusing to configure outside AWS account $AccountId"
}

$config = aws lambda get-function-configuration `
  --region $Region --function-name $coordinatorFunction --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Dev coordinator configuration' }
$authToken = [string]$config.Environment.Variables.MODEL_COORDINATOR_AUTH_TOKEN
if (-not $authToken) { throw 'The Dev coordinator auth token is missing' }
$encodedToken = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($authToken))

$commands = @(
  'set -eu',
  "token=`$(printf '%s' '$encodedToken' | base64 -d)",
  'sudo install -d -m 755 /etc/systemd/system/gpu-inference-worker.service.d',
  'printf "%s\n" "[Service]" "Environment=MODEL_COORDINATOR_AUTH_TOKEN=${token}" | sudo tee /etc/systemd/system/gpu-inference-worker.service.d/dev-coordinator.conf >/dev/null',
  'sudo chmod 600 /etc/systemd/system/gpu-inference-worker.service.d/dev-coordinator.conf',
  'sudo systemctl daemon-reload',
  'sudo systemctl restart gpu-inference-worker.service',
  'for attempt in $(seq 1 60); do if systemctl is-active --quiet gpu-inference-worker.service && curl -sf -H "X-VCS-Coordinator-Token: ${token}" http://127.0.0.1:3003/coordinator/status >/tmp/vcs-coordinator-status.json; then break; fi; sleep 2; done',
  'echo "inferenceService=$(systemctl is-active gpu-inference-worker.service || true)"',
  'code="$(curl -sS -o /tmp/vcs-coordinator-status.json -w "%{http_code}" -H "X-VCS-Coordinator-Token: ${token}" http://127.0.0.1:3003/coordinator/status || true)"',
  'echo "coordinatorHttp=${code}"',
  'if [ "$code" = "200" ]; then jq -c "{ready,active,queued,maxSlots,modelKey,voiceProfileId,draining}" /tmp/vcs-coordinator-status.json; fi'
)
$parametersPath = Join-Path $env:TEMP 'vcs-dev-worker-coordinator-config-parameters.json'
[IO.File]::WriteAllText(
  $parametersPath,
  (@{ commands = $commands } | ConvertTo-Json -Depth 4 -Compress),
  (New-Object Text.UTF8Encoding($false))
)
try {
  $commandId = aws ssm send-command `
    --region $Region --instance-ids $instanceIds `
    --document-name AWS-RunShellScript --parameters "file://$parametersPath" `
    --query 'Command.CommandId' --output text
  if ($LASTEXITCODE -ne 0 -or -not $commandId) { throw 'Failed to configure Dev workers' }
  foreach ($instanceId in $instanceIds) {
    aws ssm wait command-executed --region $Region --command-id $commandId --instance-id $instanceId
    aws ssm get-command-invocation `
      --region $Region --command-id $commandId --instance-id $instanceId `
      --query '{InstanceId:InstanceId,Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}' `
      --output json
  }
} finally {
  Remove-Item -LiteralPath $parametersPath -Force -ErrorAction SilentlyContinue
}
