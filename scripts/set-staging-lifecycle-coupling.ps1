param(
  [switch]$Apply,
  [string]$FunctionName = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging',
  [string]$AutoScalingGroupName = 'vcs-staging-gpu-inference',
  [string]$Region = 'ap-northeast-2'
)

$ErrorActionPreference = 'Stop'

function Invoke-AwsJson {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & aws @args 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    $summary = @($output | ForEach-Object { $_.ToString() } | Where-Object { $_ -match 'aws: \[ERROR\]' })[0]
    if (-not $summary) { $summary = 'AWS command failed.' }
    throw $summary
  }
  if (-not $output) { return $null }
  return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

$configuration = Invoke-AwsJson lambda get-function-configuration `
  --region $Region --function-name $FunctionName --output json
$original = @{}
$configuration.Environment.Variables.PSObject.Properties | ForEach-Object {
  $original[$_.Name] = $_.Value
}

if (-not $Apply) {
  Write-Host "[dry-run] configure $FunctionName to couple fixed GPU lifecycle to $AutoScalingGroupName"
  exit 0
}

$updated = $original.Clone()
$updated['GPU_INFERENCE_ASG_NAME'] = $AutoScalingGroupName
$environmentFile = Join-Path ([IO.Path]::GetTempPath()) "vcs-lambda-env-$([guid]::NewGuid().ToString('N')).json"
$responseFile = Join-Path ([IO.Path]::GetTempPath()) "vcs-lambda-response-$([guid]::NewGuid().ToString('N')).json"
$eventFile = Join-Path ([IO.Path]::GetTempPath()) "vcs-lambda-event-$([guid]::NewGuid().ToString('N')).json"

try {
  $json = @{ Variables = $updated } | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText($environmentFile, $json, [Text.UTF8Encoding]::new($false))
  Invoke-AwsJson lambda update-function-configuration --region $Region `
    --function-name $FunctionName --environment "file://$environmentFile" --output json | Out-Null
  & aws lambda wait function-updated-v2 --region $Region --function-name $FunctionName
  if ($LASTEXITCODE -ne 0) { throw 'Waiting for Lambda configuration failed.' }

  $eventPayload = '{"rawPath":"/api/instance/idle-check","requestContext":{"http":{"method":"POST"}}}'
  [IO.File]::WriteAllText($eventFile, $eventPayload, [Text.UTF8Encoding]::new($false))
  $invoke = Invoke-AwsJson lambda invoke --region $Region --function-name $FunctionName `
    --cli-binary-format raw-in-base64-out --payload "fileb://$eventFile" $responseFile --output json
  $response = Get-Content -LiteralPath $responseFile -Raw | ConvertFrom-Json
  $body = $response.body | ConvertFrom-Json
  if ($invoke.FunctionError -or $response.statusCode -ne 200) {
    throw "Lifecycle verification failed: $($body.error)"
  }

  [pscustomobject]@{
    fixedState = $body.state
    reason = $body.reason
    fleetChanged = $body.inferenceFleet.changed
    fleetEnabled = $body.inferenceFleet.enabled
    fleetMin = $body.inferenceFleet.minSize
    fleetDesired = $body.inferenceFleet.desiredCapacity
  } | ConvertTo-Json
} catch {
  $json = @{ Variables = $original } | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText($environmentFile, $json, [Text.UTF8Encoding]::new($false))
  Invoke-AwsJson lambda update-function-configuration --region $Region `
    --function-name $FunctionName --environment "file://$environmentFile" --output json | Out-Null
  & aws lambda wait function-updated-v2 --region $Region --function-name $FunctionName
  throw
} finally {
  Remove-Item -LiteralPath $environmentFile,$responseFile,$eventFile -Force -ErrorAction SilentlyContinue
}
