param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [Parameter(Mandatory)][ValidateSet('training','live-fast','chatbot','chatbot-text')] [string]$Mode,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$repo = Resolve-Path "$PSScriptRoot\.."
# 'chatbot' is the original kiosk target and its build mode is configurable per
# environment (both environments currently ship the gi build there).
# 'chatbot-text' is the second kiosk distribution and always ships the chatbot
# build: the Live Voice Chat UI with the typed-question composer.
$buildMode = if ($Mode -eq 'chatbot-text') {
  'chatbot'
} elseif ($Mode -eq 'chatbot' -and $cfg.chatbotBuildMode) {
  [string]$cfg.chatbotBuildMode
} else {
  $Mode
}
# chatbot-text shares its build mode with chatbot but needs different origins
# baked in, so its env override is named after the target, not the build mode.
$envName = if ($Mode -eq 'chatbot-text') { 'chatbot-text' } else { $buildMode }
$envSrc = "$repo\client\env\$Env\$envName.env"
$envDst = "$repo\client\.env.$buildMode.local"
$dist = "$repo\client\dist-$buildMode"
$target = $cfg.clientTargets.$Mode
$distro = $cfg.distributions.$Mode

# kiosk modes must be built from the chatbot branch's client tree
if ($Mode -eq 'chatbot' -or $Mode -eq 'chatbot-text') {
  Push-Location $repo
  $current = (git branch --show-current).Trim()
  Pop-Location
  if ($current -ne $cfg.chatbotBranch) {
    throw "chatbot builds must run from branch '$($cfg.chatbotBranch)' (current: '$current')"
  }
}

if ($DryRun) {
  Write-Host "[dry-run] build client --mode $buildMode with $envSrc; sync $dist -> $target; invalidate $distro ($Env)"
  exit 0
}
$hasEnvOverride = Test-Path $envSrc
if ($hasEnvOverride) {
  Copy-Item $envSrc $envDst -Force
}
try {
  Push-Location "$repo\client"
  npm run "build:$buildMode"
  if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
} finally {
  Pop-Location
  if ($hasEnvOverride) {
    Remove-Item $envDst -Force -ErrorAction SilentlyContinue
  }
}
if ($buildMode -eq 'gi') {
  aws s3 sync $dist $target --delete --exclude "videos/*" --region $cfg.s3Region
} else {
  aws s3 sync $dist $target --delete --region $cfg.s3Region
}
if ($LASTEXITCODE -ne 0) { throw "s3 sync failed" }
aws cloudfront create-invalidation --distribution-id $distro --paths "/*"
if ($LASTEXITCODE -ne 0) { throw "invalidation failed" }
Write-Host "Deployed $Mode client to $Env"
