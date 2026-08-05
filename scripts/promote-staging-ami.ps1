param(
  [Parameter(Mandatory)][string]$InstanceId,
  [Parameter(Mandatory)][string]$Commit,
  [string]$Region = 'ap-northeast-2',
  [string]$LaunchTemplateId = 'lt-07728350a25e691a4',
  [string]$AutoScalingGroupName = 'vcs-staging-gpu-inference'
)
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "vcs-staging-unified-resemblyzer-$stamp"
$ami = aws ec2 create-image --region $Region --instance-id $InstanceId `
  --name $name --description "Unified staging commit $Commit with resemblyzer 0.1.4" `
  --no-reboot --query ImageId --output text
if ($LASTEXITCODE -ne 0) { throw 'AMI creation failed.' }
aws ec2 wait image-available --region $Region --image-ids $ami
if ($LASTEXITCODE -ne 0) { throw 'AMI did not become available.' }

$overridePath = Join-Path $env:TEMP 'vcs-staging-unified-ami.json'
[IO.File]::WriteAllText(
  $overridePath,
  (@{ ImageId = $ami } | ConvertTo-Json -Compress),
  (New-Object Text.UTF8Encoding($false))
)
try {
  $version = aws ec2 create-launch-template-version --region $Region `
    --launch-template-id $LaunchTemplateId --source-version '$Default' `
    --version-description "unified-$Commit-resemblyzer-$ami" `
    --launch-template-data "file://$overridePath" `
    --query LaunchTemplateVersion.VersionNumber --output text
  if ($LASTEXITCODE -ne 0) { throw 'Launch template version creation failed.' }
} finally {
  Remove-Item -LiteralPath $overridePath -Force -ErrorAction SilentlyContinue
}
aws ec2 modify-launch-template --region $Region --launch-template-id $LaunchTemplateId `
  --default-version $version --query LaunchTemplate.DefaultVersionNumber --output text | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Launch template promotion failed.' }
aws autoscaling update-auto-scaling-group --region $Region `
  --auto-scaling-group-name $AutoScalingGroupName `
  --launch-template "LaunchTemplateId=$LaunchTemplateId,Version=`$Default"
if ($LASTEXITCODE -ne 0) { throw 'ASG launch template update failed.' }
Write-Host "Promoted AMI $ami as launch template version $version."
