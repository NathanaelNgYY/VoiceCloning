param(
  [string]$Region = 'ap-northeast-2',
  [string]$AccountId = '329599637774',
  [string]$VoiceProfileId = 'deanvoice-v1'
)

$ErrorActionPreference = 'Stop'
foreach ($name in @('ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'SESSION_TOKEN')) {
  $value = [Environment]::GetEnvironmentVariable("VCS_AWS_$name", 'User')
  if (-not $value) { throw "User-level VCS_AWS_$name is missing" }
  Set-Item -Path "Env:AWS_$name" -Value $value
}
$assumed = aws sts assume-role `
  --role-arn "arn:aws:iam::$AccountId`:role/Liu_Teng_Yu_Intern2026" `
  --role-session-name 'codex-dev-coordinated-synthesis' --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $assumed.Credentials) { throw 'AssumeRole failed' }
$env:AWS_ACCESS_KEY_ID = $assumed.Credentials.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $assumed.Credentials.SecretAccessKey
$env:AWS_SESSION_TOKEN = $assumed.Credentials.SessionToken
if ((aws sts get-caller-identity --query Account --output text) -ne $AccountId) {
  throw "Refusing to verify outside AWS account $AccountId"
}

$event = @{
  version = '2.0'
  rawPath = '/api/live/tts-sentence'
  headers = @{}
  requestContext = @{ http = @{ method = 'POST' } }
  body = (@{
    voiceProfileId = $VoiceProfileId
    text = 'Coordinator routing check.'
    text_lang = 'en'
    prompt_lang = 'en'
    skip_verify = $true
  } | ConvertTo-Json -Compress)
} | ConvertTo-Json -Depth 6 -Compress
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($event))
$outputPath = Join-Path $env:TEMP 'vcs-dev-coordinated-synthesis-result.json'
try {
  aws lambda invoke `
    --region $Region `
    --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project `
    --payload $payload $outputPath `
    --query '{StatusCode:StatusCode,FunctionError:FunctionError}' --output json
  if ($LASTEXITCODE -ne 0) { throw 'Dev synthesis invocation failed' }
  $reply = Get-Content $outputPath -Raw | ConvertFrom-Json
  if ([int]$reply.statusCode -ne 200) {
    $errorBody = $reply.body | ConvertFrom-Json
    throw "Dev synthesis returned HTTP $($reply.statusCode): $($errorBody.error)"
  }
  $audio = [Convert]::FromBase64String([string]$reply.body)
  $riff = $audio.Length -ge 12 -and [Text.Encoding]::ASCII.GetString($audio, 0, 4) -eq 'RIFF'
  [pscustomobject]@{
    HttpStatus = $reply.statusCode
    ContentType = $reply.headers.'Content-Type'
    Bytes = $audio.Length
    Riff = $riff
  } | ConvertTo-Json
  if (-not $riff) { throw 'Dev synthesis response was not a RIFF WAV' }
} finally {
  Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
}
