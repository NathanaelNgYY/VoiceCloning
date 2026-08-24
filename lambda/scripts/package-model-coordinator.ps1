$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$OutDir = Join-Path $Root '.dist'
$StageDir = Join-Path $OutDir 'model-coordinator'
$ZipPath = Join-Path $OutDir 'model-coordinator.zip'

Push-Location $Root
try {
  if (-not (Test-Path 'model-coordinator\node_modules')) {
    Push-Location 'model-coordinator'
    try { npm ci --omit=dev } finally { Pop-Location }
  }
  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
  if (Test-Path $StageDir) { Remove-Item -LiteralPath $StageDir -Recurse -Force }
  if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
  New-Item -ItemType Directory -Path $StageDir | Out-Null

  Copy-Item -LiteralPath 'model-coordinator\index.js' -Destination (Join-Path $StageDir 'index.js')
  Copy-Item -LiteralPath 'model-coordinator\decision.js' -Destination (Join-Path $StageDir 'decision.js')
  Copy-Item -LiteralPath 'model-coordinator\package.json' -Destination $StageDir
  Copy-Item -LiteralPath 'model-coordinator\package-lock.json' -Destination $StageDir
  Copy-Item -LiteralPath 'model-coordinator\node_modules' -Destination $StageDir -Recurse

  Push-Location $StageDir
  try {
    $items = @('index.js', 'decision.js', 'package.json', 'package-lock.json', 'node_modules')
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if ($tar) {
      & $tar.Source -a -cf $ZipPath @items
      if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
    } else {
      Compress-Archive -Path $items -DestinationPath $ZipPath -Force
    }
  } finally {
    Pop-Location
  }
  Write-Host "Created $ZipPath"
} finally {
  Pop-Location
}
