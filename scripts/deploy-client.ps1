param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [Parameter(Mandatory)][ValidateSet('training','live-fast','chatbot')] [string]$Mode,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$repo = Resolve-Path "$PSScriptRoot\.."
$buildMode = if ($Mode -eq 'chatbot' -and $cfg.chatbotBuildMode) {
  [string]$cfg.chatbotBuildMode
} else {
  $Mode
}
$envSrc = "$repo\client\env\$Env\$buildMode.env"
$envDst = "$repo\client\.env.$buildMode.local"
$dist = "$repo\client\dist-$buildMode"
$target = $cfg.clientTargets.$Mode
$distro = $cfg.distributions.$Mode

# chatbot mode must be built from the chatbot branch's client tree
if ($Mode -eq 'chatbot') {
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
