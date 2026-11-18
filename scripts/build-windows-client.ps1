# Builds Freeway.exe: the whole app as a Node SEA blob inside node.exe.
#
# This is the only file in the Windows ZIP, so both the per-push CI job and the
# release-asset workflow run exactly this script. A broken build then shows up on
# the next push instead of on a tag. Needs Windows and Node on PATH; run from the
# repository root.
#
# The tools are pinned on purpose. postject is fetched by npx, so an unpinned name
# would inject whatever is newest that day into a binary we hand people, and the
# SEA blob only fits the node.exe it was built from: a floating Node could pair a
# stale fuse with a new binary. build-info.txt records all of it inside the ZIP.
$ErrorActionPreference = "Stop"

$postjectVersion = "1.0.0-alpha.6"

node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { throw "the SEA blob was not written" }

$exe = "Freeway.exe"
Copy-Item (Get-Command node).Source $exe -Force
npx --yes "postject@$postjectVersion" $exe NODE_SEA_BLOB sea-prep.blob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw "postject did not inject the blob" }

# Appending the blob invalidates the Authenticode signature node.exe ships with,
# and Windows refuses to start a binary whose signature no longer matches.
$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if ($signtool) {
  & $signtool.Source remove /s $exe
} else {
  Write-Host "signtool not found; leaving the signature untouched"
}

if (-not (Test-Path $exe)) { throw "Freeway.exe was not produced" }

# Provenance for the archive: which commit, built by which toolchain. No timestamp,
# so rebuilding one commit with the same pins produces the same file.
$version = (Get-Content package.json | ConvertFrom-Json).version
$commit = $env:GITHUB_SHA
if (-not $commit -and (Get-Command git -ErrorAction SilentlyContinue)) {
  $commit = (git rev-parse HEAD 2>$null)
}
if (-not $commit) { $commit = "unknown" }
$node = (node --version).Trim()

@(
  "version: $version",
  "commit: $commit",
  "node: $node",
  "postject: $postjectVersion"
) | Set-Content -Path build-info.txt -Encoding utf8

Write-Host "Built $exe ($((Get-Item $exe).Length) bytes)"
Get-Content build-info.txt | ForEach-Object { Write-Host $_ }
