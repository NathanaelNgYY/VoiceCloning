param(
  [Parameter(Mandatory)][ValidatePattern('^i-[0-9a-f]+$')][string]$InstanceId,
  [string]$Region = 'ap-northeast-2'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$files = @(
  @{
    Local = Join-Path $projectRoot 'gpu-inference-worker/src/routes/coordinator.js'
    Remote = '/home/ubuntu/VoiceCloning/gpu-inference-worker/src/routes/coordinator.js'
    Mode = '0644'
  },
  @{
    Local = Join-Path $projectRoot 'scripts/warm-staging-deanvoice.sh'
    Remote = '/home/ubuntu/VoiceCloning/scripts/warm-staging-deanvoice.sh'
    Mode = '0755'
  }
)

$commands = @('set -e')
foreach ($file in $files) {
  $content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.Local))
  $commands += "printf '%s' '$content' | base64 --decode | sudo tee '$($file.Remote)' >/dev/null"
  $commands += "sudo chown ubuntu:ubuntu '$($file.Remote)'"
  $commands += "sudo chmod $($file.Mode) '$($file.Remote)'"
}
$commands += @(
  'sudo systemctl restart gpu-inference-worker.service',
  'for attempt in $(seq 1 180); do token=$(sed -n ''s/^Environment=MODEL_COORDINATOR_AUTH_TOKEN=//p'' /etc/systemd/system/gpu-inference-worker.service.d/staging-warm.conf); voice=$(curl -sf -H "X-VCS-Coordinator-Token: ${token}" http://127.0.0.1:3003/coordinator/status 2>/dev/null | jq -r ''select(.ready == true) | .voiceProfileId // empty'' || true); if [ -n "${voice}" ]; then exit 0; fi; sleep 5; done',
  'exit 1'
)

$parametersPath = Join-Path $env:TEMP ('vcs-deploy-worker-coordinator-' + [guid]::NewGuid().ToString('N') + '.json')
[IO.File]::WriteAllText(
  $parametersPath,
  (@{ commands = $commands } | ConvertTo-Json -Compress),
  (New-Object Text.UTF8Encoding($false))
)
try {
  $commandId = aws ssm send-command --region $Region --instance-ids $InstanceId `
    --document-name AWS-RunShellScript --parameters "file://$parametersPath" `
    --query Command.CommandId --output text
  if ($LASTEXITCODE -ne 0 -or -not $commandId) { throw 'Could not create the worker deployment command.' }
} finally {
  Remove-Item -LiteralPath $parametersPath -Force -ErrorAction SilentlyContinue
}

for ($attempt = 0; $attempt -lt 190; $attempt += 1) {
  Start-Sleep -Seconds 5
  $invocation = aws ssm get-command-invocation --region $Region `
    --command-id $commandId --instance-id $InstanceId --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the worker deployment command.' }
  if ($invocation.Status -eq 'Success') {
    [pscustomobject]@{ InstanceId = $InstanceId; Status = 'Success' } | ConvertTo-Json
    exit 0
  }
  if ($invocation.Status -in @('Cancelled', 'Cancelling', 'Failed', 'TimedOut')) {
    throw "Worker deployment ended in $($invocation.Status): $($invocation.StandardErrorContent)"
  }
}
throw 'Worker deployment did not finish within 16 minutes.'
