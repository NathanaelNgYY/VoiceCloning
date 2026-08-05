param(
  [Parameter(Mandatory)][string]$BundleUri,
  [Parameter(Mandatory)][string]$Commit,
  [string[]]$InstanceIds
)
$ErrorActionPreference = 'Stop'
$hosts = @(
  @{ Id='i-03f258d470a2fa73f'; Branch='separate-containers-new'; Kind='dev' },
  @{ Id='i-0f0da8be59367f7a8'; Branch='codex/staging-multi-user-scaling'; Kind='relay' },
  @{ Id='i-07452bccef87e5ae7'; Branch='codex/staging-multi-user-scaling'; Kind='asg' },
  @{ Id='i-07b146468386bcd0f'; Branch='codex/staging-multi-user-scaling'; Kind='asg' },
  @{ Id='i-0c2c78cb960afe784'; Branch='codex/staging-multi-user-scaling'; Kind='asg' },
  @{ Id='i-0f9568c3fa7be99de'; Branch='codex/staging-multi-user-scaling'; Kind='asg' },
  @{ Id='i-09edbf1092b034096'; Branch='codex/staging-multi-user-scaling'; Kind='asg' }
)
foreach ($hostInfo in $hosts) {
  if ($InstanceIds -and $hostInfo.Id -notin $InstanceIds) { continue }
  $setup = switch ($hostInfo.Kind) {
    'dev' { 'node scripts/merge-env-file.mjs live-gateway/.env.livegateway.deployment.dev live-gateway/.env CORS_ORIGIN LIVE_AUTH_ENABLED ENTRA_TENANT_ID ENTRA_AUDIENCE ENTRA_ALLOWED_EMAIL_DOMAINS LIVE_AUTH_LOADTEST_SECRET TRANSCRIPT_TABLE_NAME TRANSCRIPT_TABLE_REGION TRANSCRIPT_TTL_DAYS TRANSCRIPT_STORE_SYNTHETIC TRANSCRIPT_STORE_ASSISTANT; sudo rm -f /etc/systemd/system/gpu-inference-worker.service.d/relay-health.conf; sudo systemctl daemon-reload' }
    'relay' { 'node scripts/merge-env-file.mjs live-gateway/.env.livegateway.deployment.staging live-gateway/.env CORS_ORIGIN LIVE_AUTH_ENABLED ENTRA_TENANT_ID ENTRA_AUDIENCE ENTRA_ALLOWED_EMAIL_DOMAINS LIVE_AUTH_LOADTEST_SECRET TRANSCRIPT_TABLE_NAME TRANSCRIPT_TABLE_REGION TRANSCRIPT_TTL_DAYS TRANSCRIPT_STORE_SYNTHETIC TRANSCRIPT_STORE_ASSISTANT; sudo install -d -m 0755 /etc/systemd/system/gpu-inference-worker.service.d; sudo install -m 0644 systemd/gpu-inference-worker-relay-health.conf /etc/systemd/system/gpu-inference-worker.service.d/relay-health.conf; sudo systemctl daemon-reload' }
    default { 'bash scripts/install-resemblyzer.sh' }
  }
  $command = "set -e; cd /home/ubuntu/VoiceCloning; aws s3 cp $BundleUri /tmp/vcs.bundle --region ap-southeast-1 --only-show-errors; sudo -u ubuntu git fetch /tmp/vcs.bundle HEAD; rm -f gpu-inference-worker/scripts/verify_speaker_similarity.mjs; sudo -u ubuntu git checkout -B $($hostInfo.Branch) FETCH_HEAD; npm --prefix gpu-worker ci --omit=dev; npm --prefix gpu-inference-worker ci --omit=dev; npm --prefix live-gateway ci --omit=dev; $setup; systemctl restart gpu-worker gpu-inference-worker voice-live-gateway; sleep 12; test `$(sudo -u ubuntu git rev-parse HEAD) = $Commit"
  $parametersPath = Join-Path $env:TEMP "vcs-deploy-$($hostInfo.Id).json"
  [IO.File]::WriteAllText($parametersPath, (@{commands=@($command)} | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  try {
    $commandId = aws ssm send-command --region ap-northeast-2 --instance-ids $hostInfo.Id --document-name AWS-RunShellScript --parameters "file://$parametersPath" --query Command.CommandId --output text
  } finally { Remove-Item $parametersPath -Force -ErrorAction SilentlyContinue }
  if ($LASTEXITCODE -ne 0) { throw "Failed to deploy to $($hostInfo.Id)" }
  Write-Host "$($hostInfo.Id) $commandId"
}
