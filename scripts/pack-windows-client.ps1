# Assembles Freeway-<version>-windows.zip exactly as the release ships it: the
# executable plus the files a person needs after unzipping.
#
# The per-push CI job and the release workflow both run this, so the ZIP that gets
# launched in CI is assembled the same way as the ZIP that gets published.
$ErrorActionPreference = "Stop"

$version = (Get-Content package.json | ConvertFrom-Json).version
$zip = "Freeway-$version-windows.zip"
$files = @("Freeway.exe", "build-info.txt", "README.md", "VERSIONS.md", "start.cmd")
foreach ($file in $files) {
  if (-not (Test-Path $file)) { throw "$file is missing; build the client first" }
}

# The archive has to identify its own commit, so a downloaded ZIP can be traced
# without guessing which Actions run it came from.
$info = Get-Content build-info.txt
foreach ($key in @("version: ", "commit: ", "node: ", "postject: ")) {
  if (-not ($info | Where-Object { $_ -like "$key*" })) { throw "build-info.txt has no $key line" }
}
if (-not ($info -contains "version: $version")) {
  throw "build-info.txt does not describe $version; rebuild the client"
}

Compress-Archive -Path $files -DestinationPath $zip -Force
if (-not (Test-Path $zip)) { throw "the ZIP was not written" }

# The release job uploads this path, so publish it the way Actions expects.
if ($env:GITHUB_ENV) { "ZIP=$zip" | Out-File -FilePath $env:GITHUB_ENV -Append }
Write-Host "Packaged $zip ($((Get-Item $zip).Length) bytes)"
