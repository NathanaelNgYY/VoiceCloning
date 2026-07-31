param(
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content "$PSScriptRoot\staging-autoscaling.config.json" -Raw | ConvertFrom-Json
if ($cfg.environment -ne 'staging') { throw 'This script is staging-only.' }
$timeoutSeconds = [int]$cfg.albIdleTimeoutSeconds
if ($timeoutSeconds -lt 1 -or $timeoutSeconds -gt 4000) {
  throw 'albIdleTimeoutSeconds must be from 1 to 4000.'
}

function Invoke-AwsJson {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Args)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $raw = & aws @Args --output json 2>&1
    $awsExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($awsExitCode -ne 0) {
    throw "aws $($Args -join ' ') failed: $($raw -join [Environment]::NewLine)"
  }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

if ($Apply) {
  Invoke-AwsJson elbv2 modify-load-balancer-attributes --region $cfg.region `
    --load-balancer-arn $cfg.albArn `
    --attributes "Key=idle_timeout.timeout_seconds,Value=$timeoutSeconds" | Out-Null
}

$attributes = Invoke-AwsJson elbv2 describe-load-balancer-attributes --region $cfg.region `
  --load-balancer-arn $cfg.albArn
$actual = [string](
  $attributes.Attributes |
    Where-Object { $_.Key -eq 'idle_timeout.timeout_seconds' } |
    Select-Object -First 1 -ExpandProperty Value
)
if ([string]::IsNullOrWhiteSpace($actual)) {
  throw 'The ALB returned no idle_timeout.timeout_seconds attribute.'
}
if ($Apply -and $actual -ne [string]$timeoutSeconds) {
  throw "ALB idle timeout read-back was $actual, expected $timeoutSeconds."
}

Write-Host "Staging ALB idle timeout: current=$actual desired=$timeoutSeconds applied=$Apply"
