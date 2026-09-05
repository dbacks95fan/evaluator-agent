#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target=${EVALUATOR_DEPLOY_ROOT:-"$HOME/evaluator-agent"}
secrets=${EVALUATOR_SECRETS_FILE:-"$HOME/.config/agentic-sdlc/runtime.env"}

test -f "$package_dir/SHA256SUMS"
(cd "$package_dir" && sha256sum -c SHA256SUMS)
test -f "$secrets" || { echo "Missing evaluator secrets file: $secrets" >&2; exit 1; }
for required_setting in EVALUATOR_API_TOKEN OPENAI_API_KEY EVALUATOR_ALLOWED_REPOSITORY_URL; do
  grep -q "^${required_setting}=" "$secrets" || { echo "Missing required runtime setting: ${required_setting}" >&2; exit 1; }
done
image=$(sed -n 's/.*"image": "\([^"]*\)".*/\1/p' "$package_dir/manifest.json")
test -n "$image" || { echo "Missing image name in deployment manifest" >&2; exit 1; }

mkdir -p "$target"
cp "$package_dir/compose.yaml" "$target/docker-compose.yaml"
ln -sfn "$secrets" "$target/.runtime.env"
printf 'EVALUATOR_IMAGE=%s\n' "$image" > "$target/.env"
sudo /usr/local/bin/docker load -i "$package_dir/evaluator-agent-image.tar"
cd "$target"
sudo /usr/local/bin/docker-compose up -d --no-build
EVALUATOR_SECRETS_FILE="$secrets" sh "$package_dir/verify-deployment.sh"
