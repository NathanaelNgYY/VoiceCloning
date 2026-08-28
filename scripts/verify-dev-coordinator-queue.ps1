param(
  [string]$Region = 'ap-northeast-2',
  [string]$AccountId = '329599637774'
)

$ErrorActionPreference = 'Stop'
foreach ($name in @('ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'SESSION_TOKEN')) {
  $value = [Environment]::GetEnvironmentVariable("VCS_AWS_$name", 'User')
  if (-not $value) { throw "User-level VCS_AWS_$name is missing" }
  Set-Item -Path "Env:AWS_$name" -Value $value
}
$assumed = aws sts assume-role `
  --role-arn "arn:aws:iam::$AccountId`:role/Liu_Teng_Yu_Intern2026" `
  --role-session-name 'codex-dev-coordinator-queue' --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $assumed.Credentials) { throw 'AssumeRole failed' }
if ($assumed.AssumedRoleUser.Arn -notmatch "^arn:aws:sts::$AccountId`:") {
  throw "Refusing to verify outside AWS account $AccountId"
}

$workerScript = {
  param($Index, $Region, $AccessKey, $SecretKey, $SessionToken)
  $env:AWS_ACCESS_KEY_ID = $AccessKey
  $env:AWS_SECRET_ACCESS_KEY = $SecretKey
  $env:AWS_SESSION_TOKEN = $SessionToken
  $text = "Coordinator queue verification request $Index deliberately contains enough words to keep the same Dean voice GPU occupied while another request waits for the next bounded priority slot."
  $event = @{
    version = '2.0'
    rawPath = '/api/live/tts-sentence'
    headers = @{}
    requestContext = @{ http = @{ method = 'POST' } }
    body = (@{
      voiceProfileId = 'deanvoice-v1'
      text = $text
      text_lang = 'en'
      prompt_lang = 'en'
      skip_verify = $false
    } | ConvertTo-Json -Compress)
  } | ConvertTo-Json -Depth 6 -Compress
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($event))
  $outputPath = Join-Path $env:TEMP "vcs-dev-queue-$Index.json"
  try {
    aws lambda invoke `
      --region $Region --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project `
      --payload $payload $outputPath --output json | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Invocation $Index failed" }
    $reply = Get-Content $outputPath -Raw | ConvertFrom-Json
    $audio = if ([int]$reply.statusCode -eq 200) {
      [Convert]::FromBase64String([string]$reply.body)
    } else { [byte[]]::new(0) }
    [pscustomobject]@{
      Index = $Index
      HttpStatus = $reply.statusCode
      Bytes = $audio.Length
      Riff = $audio.Length -ge 12 -and [Text.Encoding]::ASCII.GetString($audio, 0, 4) -eq 'RIFF'
      QueueWaitMs = [int]$(if ($reply.headers.'X-VCS-GPU-Queue-Wait-Ms') {
        $reply.headers.'X-VCS-GPU-Queue-Wait-Ms'
      } else { 0 })
      Error = if ([int]$reply.statusCode -ne 200) { ($reply.body | ConvertFrom-Json).error } else { '' }
    }
  } finally {
    Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
  }
}

$credentialArgs = @(
  $Region,
  $assumed.Credentials.AccessKeyId,
  $assumed.Credentials.SecretAccessKey,
  $assumed.Credentials.SessionToken
)
$jobs = @()
$jobs += Start-Job -ScriptBlock $workerScript -ArgumentList (@(1) + $credentialArgs)
$jobs += Start-Job -ScriptBlock $workerScript -ArgumentList (@(2) + $credentialArgs)
Start-Sleep -Seconds 3
$jobs += Start-Job -ScriptBlock $workerScript -ArgumentList (@(3) + $credentialArgs)
$results = $jobs | Wait-Job | Receive-Job
$jobs | Remove-Job -Force
$results | Sort-Object Index | ConvertTo-Json

if (($results | Where-Object { -not $_.Riff }).Count -gt 0) {
  throw 'At least one queued synthesis did not return RIFF audio'
}
if (($results | Measure-Object QueueWaitMs -Maximum).Maximum -le 0) {
  throw 'No request reported a worker queue wait'
}
