[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$NasHost,
  [Parameter(Mandatory)][string]$SshKeyPath,
  [string]$Ref = "HEAD",
  [string]$RemoteUser = "DockerDeploy",
  [string]$RemotePath = "~/evaluator-agent",
  [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$archive = Join-Path ([System.IO.Path]::GetTempPath()) ("evaluator-agent-" + [guid]::NewGuid().ToString() + ".tar.gz")
$target = "$RemoteUser@$NasHost"
try {
  git -C $repo archive --format=tar.gz --output=$archive $Ref
  scp -i $SshKeyPath $archive "${target}:/tmp/evaluator-agent-deploy.tar.gz"
  $remote = "set -eu; test -f ~/.config/agentic-sdlc/runtime.env; target=$RemotePath; staging=`"`$target.staging`"; rm -rf `"`$staging`"; mkdir -p `"`$staging/jobs/input`" `"`$staging/jobs/output`"; tar xzf /tmp/evaluator-agent-deploy.tar.gz -C `"`$staging`"; rm /tmp/evaluator-agent-deploy.tar.gz; if [ -d `"`$target`" ]; then rm -rf `"`$target`"; fi; mv `"`$staging`" `"`$target`"; cd `"`$target`"; sudo /usr/local/bin/docker-compose up -d --build; curl --fail http://localhost:$Port/health"
  ssh -i $SshKeyPath $target $remote
} finally {
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
}
