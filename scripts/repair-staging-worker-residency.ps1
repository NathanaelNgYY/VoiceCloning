param(
  [Parameter(Mandatory)][ValidatePattern('^i-[0-9a-f]+$')][string]$InstanceId,
  [string]$Region = 'ap-northeast-2'
)

$ErrorActionPreference = 'Stop'

$remote = @'
set -e
instance_id='__INSTANCE_ID__'
dropin='/etc/systemd/system/gpu-inference-worker.service.d/staging-warm.conf'
function_name="$(sed -n 's/^Environment=MODEL_COORDINATOR_FUNCTION_NAME=//p' "${dropin}")"
region="$(sed -n 's/^Environment=MODEL_COORDINATOR_REGION=//p' "${dropin}")"
token="$(sed -n 's/^Environment=MODEL_COORDINATOR_AUTH_TOKEN=//p' "${dropin}")"
aws lambda invoke \
  --function-name "${function_name}" \
  --region "${region}" \
  --cli-binary-format raw-in-base64-out \
  --payload "$(jq -nc --arg instance_id "${instance_id}" '{action:"claim",instanceId:$instance_id}')" \
  /tmp/vcs-repair-claim.json >/dev/null
warm_body="$(jq -c '.assignment.synthesisBody // empty' /tmp/vcs-repair-claim.json)"
test -n "${warm_body}"
registration_body="$(jq -nc --argjson synthesis_body "${warm_body}" \
  '{synthesisBody:$synthesis_body,requiredIdleMs:0}')"
curl --fail --silent --show-error \
  --max-time 300 \
  --header 'Content-Type: application/json' \
  --header "X-VCS-Coordinator-Token: ${token}" \
  --data-binary "${registration_body}" \
  http://127.0.0.1:3003/coordinator/register \
  | jq -e '.registered == true' >/dev/null
rm -f /tmp/vcs-repair-claim.json
echo 'coordinator residency registered'
'@.Replace('__INSTANCE_ID__', $InstanceId)

$parametersPath = Join-Path $env:TEMP ('vcs-repair-residency-' + [guid]::NewGuid().ToString('N') + '.json')
[IO.File]::WriteAllText(
  $parametersPath,
  (@{ commands = @($remote) } | ConvertTo-Json -Compress),
  (New-Object Text.UTF8Encoding($false))
)
try {
  $commandId = aws ssm send-command --region $Region --instance-ids $InstanceId `
    --document-name AWS-RunShellScript --parameters "file://$parametersPath" `
    --query Command.CommandId --output text
  if ($LASTEXITCODE -ne 0 -or -not $commandId) { throw 'Could not create the residency repair command.' }
} finally {
  Remove-Item -LiteralPath $parametersPath -Force -ErrorAction SilentlyContinue
}

for ($attempt = 0; $attempt -lt 90; $attempt += 1) {
  Start-Sleep -Seconds 5
  $invocation = aws ssm get-command-invocation --region $Region `
    --command-id $commandId --instance-id $InstanceId --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the residency repair command.' }
  if ($invocation.Status -eq 'Success') {
    [pscustomobject]@{
      InstanceId = $InstanceId
      Status = $invocation.Status
      Output = $invocation.StandardOutputContent.Trim()
    } | ConvertTo-Json
    exit 0
  }
  if ($invocation.Status -in @('Cancelled', 'Cancelling', 'Failed', 'TimedOut')) {
    throw "Residency repair ended in $($invocation.Status): $($invocation.StandardErrorContent)"
  }
}
throw 'Residency repair did not finish within 7.5 minutes.'
