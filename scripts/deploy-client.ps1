param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [Parameter(Mandatory)][ValidateSet('training','live-fast','chatbot')] [string]$Mode,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$repo = Resolve-Path "$PSScriptRoot\.."
$envSrc = "$repo\client\env\$Env\$Mode.env"
$envDst = "$repo\client\.env.$Mode.local"
$dist = "$repo\client\dist-$Mode"
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
  Write-Host "[dry-run] build client --mode $Mode with $envSrc; sync $dist -> $target; invalidate $distro ($Env)"
  exit 0
}
Copy-Item $envSrc $envDst -Force
try {
  Push-Location "$repo\client"
  npm run "build:$Mode"
  if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
} finally {
  Pop-Location
  Remove-Item $envDst -Force -ErrorAction SilentlyContinue
}
aws s3 sync $dist $target --delete --region $cfg.s3Region
if ($LASTEXITCODE -ne 0) { throw "s3 sync failed" }
aws cloudfront create-invalidation --distribution-id $distro --paths "/*"
if ($LASTEXITCODE -ne 0) { throw "invalidation failed" }
Write-Host "Deployed $Mode client to $Env"
