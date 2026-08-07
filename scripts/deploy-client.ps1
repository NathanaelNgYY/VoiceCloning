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
$hasEnvOverride = Test-Path -LiteralPath $envSrc
$envBackup = $null
# Distinct from $envBackup on purpose. "I made a backup" and "I overwrote the
# destination" are different questions, and they diverge precisely when the
# backup fails: the override was then never copied in, so $envDst still holds
# the developer's untouched file and cleanup must leave it alone. Keying the
# cleanup off $envBackup alone deletes the very file this block exists to
# protect.
$envDstOverwritten = $false
$clientLocationPushed = $false
try {
  if ($hasEnvOverride) {
    # .env.<mode>.local may hold a developer's private local-server settings.
    # Preserve it while the deployment-specific override owns that filename.
    if (Test-Path -LiteralPath $envDst) {
      # Beside the file rather than in $env:TEMP with a random name: if this
      # process is killed mid-build (a 40s vite build is an easy Ctrl-C target)
      # the finally block never runs, and a backup the developer cannot find is
      # the same as no backup. This path is covered by .gitignore's `.env.*`.
      $backupPath = "$envDst.deploy-backup"
      # Assign only after Copy-Item succeeds. A failed backup must never make
      # cleanup mistake an empty/partial file for a restorable copy.
      $envBackup = (Copy-Item -LiteralPath $envDst -Destination $backupPath -Force -PassThru).FullName
    }
    Copy-Item -LiteralPath $envSrc -Destination $envDst -Force
    $envDstOverwritten = $true
  }
  Push-Location "$repo\client"
  $clientLocationPushed = $true
  npm run "build:$buildMode"
  if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
} finally {
  if ($clientLocationPushed) {
    Pop-Location
  }
  if ($envDstOverwritten) {
    if ($envBackup) {
      # A throw in finally would replace the real build error with a confusing
      # one AND leave the deployment override sitting in the developer's local
      # file. Warn with the path instead, so the copy is recoverable by hand.
      try {
        Copy-Item -LiteralPath $envBackup -Destination $envDst -Force -ErrorAction Stop
        Remove-Item -LiteralPath $envBackup -Force -ErrorAction SilentlyContinue
      } catch {
        Write-Warning "Could not restore $envDst from backup. Your original file is at $envBackup - restore it by hand. ($($_.Exception.Message))"
      }
    } else {
      Remove-Item -LiteralPath $envDst -Force -ErrorAction SilentlyContinue
    }
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
