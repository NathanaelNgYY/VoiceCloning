param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [string]$SshKey = "$env:USERPROFILE\Downloads\PC_SYNC\VoiClo-Gpu-Seoul.pem",
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$remote = "cd /home/ubuntu/VoiceCloning; git fetch origin; git checkout $($cfg.branch); git pull; sudo systemctl restart gpu-worker gpu-inference-worker voice-live-gateway; sleep 5; curl -sf localhost:3001/healthz; curl -sf localhost:3003/healthz; curl -sf localhost:3002/healthz"

if ($DryRun) { Write-Host "[dry-run] $($cfg.workerAccess) to $($cfg.instanceId): $remote"; exit 0 }

if ($cfg.workerAccess -eq 'ssm') {
  $cmdId = aws ssm send-command --region $cfg.region --instance-ids $cfg.instanceId --document-name AWS-RunShellScript --parameters "commands=['$remote']" --query "Command.CommandId" --output text
  if ($LASTEXITCODE -ne 0) { throw "ssm send-command failed" }
  Write-Host "SSM command $cmdId sent; waiting..."
  aws ssm wait command-executed --region $cfg.region --command-id $cmdId --instance-id $cfg.instanceId
  aws ssm get-command-invocation --region $cfg.region --command-id $cmdId --instance-id $cfg.instanceId --query "{Status:Status,Out:StandardOutputContent,Err:StandardErrorContent}" --output json
} else {
  # staging: public IP rotates on stop/start — always look it up
  $ip = aws ec2 describe-instances --region $cfg.region --instance-ids $cfg.instanceId --query "Reservations[0].Instances[0].PublicIpAddress" --output text
  if ($ip -eq 'None' -or [string]::IsNullOrWhiteSpace($ip)) { throw "instance $($cfg.instanceId) has no public IP (stopped?)" }
  ssh -o StrictHostKeyChecking=no -i $SshKey "ubuntu@$ip" $remote
  if ($LASTEXITCODE -ne 0) { throw "remote deploy failed" }
}
Write-Host "Deployed workers to $Env ($($cfg.instanceId), branch $($cfg.branch))"
