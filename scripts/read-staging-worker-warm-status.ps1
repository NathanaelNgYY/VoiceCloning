param(
  [Parameter(Mandatory)][ValidatePattern('^i-[0-9a-f]+$')][string]$InstanceId,
  [string]$Region = 'ap-northeast-2'
)

$ErrorActionPreference = 'Stop'
$parametersPath = Join-Path $env:TEMP ('vcs-worker-warm-log-' + [guid]::NewGuid().ToString('N') + '.json')
$command = "sudo journalctl -u gpu-inference-worker.service --no-pager -n 120 | grep -E 'warm_timing|coordinator|registration|failed|error|Ready|completed' || true"
[IO.File]::WriteAllText(
  $parametersPath,
  (@{ commands = @($command) } | ConvertTo-Json -Compress),
  (New-Object Text.UTF8Encoding($false))
)
try {
  $commandId = aws ssm send-command --region $Region --instance-ids $InstanceId `
    --document-name AWS-RunShellScript --parameters "file://$parametersPath" `
    --query Command.CommandId --output text
  if ($LASTEXITCODE -ne 0 -or -not $commandId) { throw 'Could not request the worker warm log.' }
} finally {
  Remove-Item -LiteralPath $parametersPath -Force -ErrorAction SilentlyContinue
}
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Seconds 3
  $invocation = aws ssm get-command-invocation --region $Region `
    --command-id $commandId --instance-id $InstanceId --output json | ConvertFrom-Json
  if ($invocation.Status -eq 'Success') {
    $invocation.StandardOutputContent
    exit 0
  }
  if ($invocation.Status -in @('Cancelled', 'Failed', 'TimedOut')) {
    throw "Warm-log read ended in $($invocation.Status)."
  }
}
throw 'Warm-log read did not finish.'
