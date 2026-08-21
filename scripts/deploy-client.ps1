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
# Cache headers are load-bearing, and the two files types need opposite ones.
#
# Everything under assets/ is content-hashed by Vite, so a given URL's bytes can
# never change: cache it forever. index.html is the one unhashed file and it is
# the map to those hashes, so it must be revalidated on every load.
#
# Uploading with no Cache-Control at all (which this script did until 2026-08-21)
# leaves the browser to invent its own heuristic freshness for index.html. A
# returning visitor then runs a stale index.html pointing at the previous build's
# hashed bundle, which --delete has already removed from the bucket -> 403 -> a
# blank page that only a hard refresh clears. The CloudFront invalidation below
# does not help: the stale copy is in the browser, past every edge.
#
# --delete stays: assets/ is not a shared namespace, and the deleted files are
# exactly the ones no current index.html references. `videos/` is excluded from
# it on gi because those are uploaded out of band and are not part of the build.
$deleteArgs = if ($buildMode -eq 'gi') { @('--delete', '--exclude', 'videos/*') } else { @('--delete') }
aws s3 sync $dist $target $deleteArgs --exclude "index.html" --cache-control "public,max-age=31536000,immutable" --region $cfg.s3Region
if ($LASTEXITCODE -ne 0) { throw "s3 sync failed" }
# cp, not sync: sync compares size and mtime, so an unchanged index.html would be
# skipped and would keep whatever headers it already has.
aws s3 cp "$dist\index.html" "$target/index.html" --cache-control "no-cache" --content-type "text/html" --region $cfg.s3Region
if ($LASTEXITCODE -ne 0) { throw "index.html upload failed" }
aws cloudfront create-invalidation --distribution-id $distro --paths "/*"
if ($LASTEXITCODE -ne 0) { throw "invalidation failed" }
Write-Host "Deployed $Mode client to $Env"
