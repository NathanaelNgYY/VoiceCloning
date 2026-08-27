$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$OutDir = Join-Path $Root '.dist'
$ZipPath = Join-Path $OutDir 'model-coordinator.zip'

Push-Location $Root
try {
  if (-not (Test-Path 'model-coordinator\node_modules')) {
    Push-Location 'model-coordinator'
    try { npm ci --omit=dev } finally { Pop-Location }
  }
  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
  if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }

  # Archive from the package directory directly. Copying node_modules into a
  # staging tree first is redundant and can leave a partially copied AWS SDK
  # tree that Windows cannot reliably remove on the next package attempt.
  Push-Location 'model-coordinator'
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
