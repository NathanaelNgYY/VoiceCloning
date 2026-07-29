# Deploy the GI-bleeding kiosk build to S3 + CloudFront so it reaches ALL users immediately.
# Usage: pwsh client/scripts/deploy-gi.ps1 [-SkipBuild]
#
# NOTE: this prefix must match the ORIGIN PATH of the default behaviour's S3
# origin on distribution d2o0cbe2zunqkr (currently /echolect/dist-gi). If the two
# drift apart the sync succeeds and the invalidation succeeds, but CloudFront
# keeps serving the old build from the prefix it actually points at — a silent
# no-op deploy. Check the origin path before changing this.
#
# The Dean kiosk lives at its own prefix (echolect/dist-chatbot) and is no longer
# overwritten by this script.
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'

$Bucket = 'interns2026-small-projects-bucket-shared'
$Prefix = 'echolect/dist-gi'
$Region = 'ap-southeast-1'
$CloudFrontDomain = 'd2o0cbe2zunqkr'

$ClientDir = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $ClientDir 'dist-gi'

if (-not $SkipBuild) {
    Push-Location $ClientDir
    try {
        npm run build:gi
        if ($LASTEXITCODE -ne 0) { throw "build:gi failed" }
    } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $Dist 'index.html'))) { throw "No build found at $Dist" }

# 1. Hashed assets first (filenames change every build -> safe to cache forever).
#    Uploading assets before index.html means the page never references a missing file.
aws s3 sync "$Dist/assets" "s3://$Bucket/$Prefix/assets" --delete `
    --cache-control 'public,max-age=31536000,immutable' --region $Region
if ($LASTEXITCODE -ne 0) { throw "asset sync failed (expired AWS credentials?)" }

# 2. Everything else (index.html etc.) must always be revalidated by browsers/CDN.
aws s3 sync $Dist "s3://$Bucket/$Prefix" --exclude 'assets/*' --delete `
    --cache-control 'no-cache' --region $Region
if ($LASTEXITCODE -ne 0) { throw "root sync failed" }

# 3. Invalidate CloudFront so every edge drops the old index.html right now.
$DistId = aws cloudfront list-distributions `
    --query "DistributionList.Items[?contains(DomainName, '$CloudFrontDomain')].Id" --output text
if ($LASTEXITCODE -ne 0 -or -not $DistId) { throw "could not resolve CloudFront distribution id" }

aws cloudfront create-invalidation --distribution-id $DistId --paths '/*' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "invalidation failed" }

Write-Host "Deployed $Dist -> s3://$Bucket/$Prefix and invalidated CloudFront ($DistId)."
Write-Host "All users get the new build on their next page load (no hard refresh needed)."
Write-Host "The Dean demo kiosk is no longer served here. Roll back with deploy-chatbot.ps1."
