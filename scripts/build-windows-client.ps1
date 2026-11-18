# Builds Freeway.exe: the whole app as a Node SEA blob inside node.exe.
#
# This is the only file in the Windows ZIP, so both the per-push CI job and the
# release-asset workflow run exactly this script. A broken build then shows up on
# the next push instead of on a tag. Needs Windows and Node on PATH; run from the
# repository root.
$ErrorActionPreference = "Stop"

node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { throw "the SEA blob was not written" }

$exe = "Freeway.exe"
Copy-Item (Get-Command node).Source $exe -Force
npx --yes postject $exe NODE_SEA_BLOB sea-prep.blob `
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
Write-Host "Built $exe ($((Get-Item $exe).Length) bytes)"
