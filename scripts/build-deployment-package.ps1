[CmdletBinding()]
param(
  [string]$Ref = "HEAD",
  [string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) "deployment-packages")
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$commit = (git -C $repo rev-parse $Ref).Trim()
$shortCommit = $commit.Substring(0, 12)
$image = "evaluator-agent:$shortCommit"
$package = Join-Path $OutputDirectory "evaluator-agent-$shortCommit"

New-Item -ItemType Directory -Force -Path $package | Out-Null
docker build --platform linux/amd64 --tag $image $repo
docker save --output (Join-Path $package "evaluator-agent-image.tar") $image
Copy-Item -LiteralPath (Join-Path $repo "compose.yaml") -Destination $package -Force
Copy-Item -LiteralPath (Join-Path $repo "scripts\install-synology.sh") -Destination $package -Force
Copy-Item -LiteralPath (Join-Path $repo "scripts\verify-deployment.sh") -Destination $package -Force
[System.IO.File]::WriteAllText((Join-Path $package "manifest.json"), "{`n  `"commit`": `"$commit`",`n  `"image`": `"$image`",`n  `"platform`": `"linux/amd64`"`n}`n")
$checksumLines = Get-ChildItem -LiteralPath $package -File | Where-Object { $_.Name -ne "SHA256SUMS" } | Get-FileHash -Algorithm SHA256 | ForEach-Object { "{0}  {1}" -f $_.Hash.ToLower(), $_.Path.Substring($package.Length + 1) }
[System.IO.File]::WriteAllText((Join-Path $package "SHA256SUMS"), (($checksumLines -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Output $package
