#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target=${EVALUATOR_DEPLOY_ROOT:-"$HOME/evaluator-agent"}
secrets=${EVALUATOR_SECRETS_FILE:-"$HOME/.config/agentic-sdlc/runtime.env"}

test -f "$package_dir/SHA256SUMS"
(cd "$package_dir" && sha256sum -c SHA256SUMS)
test -f "$secrets" || { echo "Missing evaluator secrets file: $secrets" >&2; exit 1; }

mkdir -p "$target/jobs/input" "$target/jobs/output"
cp "$package_dir/compose.yaml" "$target/docker-compose.yaml"
ln -sfn "$secrets" "$target/.runtime.env"
sudo /usr/local/bin/docker load -i "$package_dir/evaluator-agent-image.tar"
cd "$target"
sudo /usr/local/bin/docker-compose up -d --no-build
echo "Evaluator image installed. Verify with: curl http://localhost:8080/health"
