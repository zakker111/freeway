# Assembles Freeway-<version>-windows.zip exactly as the release ships it: the
# executable plus the files a person needs after unzipping.
#
# The per-push CI job and the release workflow both run this, so the ZIP that gets
# launched in CI is assembled the same way as the ZIP that gets published.
$ErrorActionPreference = "Stop"

$version = (Get-Content package.json | ConvertFrom-Json).version
$zip = "Freeway-$version-windows.zip"
$files = @("Freeway.exe", "README.md", "VERSIONS.md", "start.cmd")
foreach ($file in $files) {
  if (-not (Test-Path $file)) { throw "$file is missing; build the client first" }
}

Compress-Archive -Path $files -DestinationPath $zip -Force
if (-not (Test-Path $zip)) { throw "the ZIP was not written" }

# The release job uploads this path, so publish it the way Actions expects.
if ($env:GITHUB_ENV) { "ZIP=$zip" | Out-File -FilePath $env:GITHUB_ENV -Append }
Write-Host "Packaged $zip ($((Get-Item $zip).Length) bytes)"
