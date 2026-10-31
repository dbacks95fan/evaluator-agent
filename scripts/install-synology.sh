#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target=${EVALUATOR_DEPLOY_ROOT:-"$HOME/evaluator-agent"}
config_dir=${EVALUATOR_CONFIG_DIR:-"$HOME/.config/evaluator-agent"}
secrets=${EVALUATOR_SECRETS_FILE:-"$config_dir/runtime.env"}
app_key=${EVALUATOR_GITHUB_APP_PRIVATE_KEY_HOST_PATH:-"$config_dir/github-app.pem"}

test -f "$package_dir/SHA256SUMS"
(cd "$package_dir" && sha256sum -c SHA256SUMS)
test -f "$secrets" || { echo "Missing evaluator secrets file: $secrets" >&2; exit 1; }
for required_setting in EVALUATOR_API_TOKEN OPENAI_API_KEY EVALUATOR_ALLOWED_REPOSITORY_URLS EVALUATOR_GITHUB_APP_ID EVALUATOR_GITHUB_APP_INSTALLATION_ID EVALUATOR_GITHUB_APP_PRIVATE_KEY_FILE; do
  grep -q "^${required_setting}=" "$secrets" || { echo "Missing required runtime setting: ${required_setting}" >&2; exit 1; }
done
test -f "$app_key" || { echo "Missing Evaluator GitHub App private key: $app_key" >&2; exit 1; }
image=$(sed -n 's/.*"image": "\([^"]*\)".*/\1/p' "$package_dir/manifest.json")
test -n "$image" || { echo "Missing image name in deployment manifest" >&2; exit 1; }

mkdir -p "$target"
cp "$package_dir/compose.yaml" "$target/docker-compose.yaml"
ln -sfn "$secrets" "$target/.runtime.env"
printf 'EVALUATOR_IMAGE=%s\nEVALUATOR_GITHUB_APP_PRIVATE_KEY_HOST_PATH=%s\n' "$image" "$app_key" > "$target/.env"
sudo /usr/local/bin/docker load -i "$package_dir/evaluator-agent-image.tar"
cd "$target"
sudo /usr/local/bin/docker-compose up -d --no-build
EVALUATOR_SECRETS_FILE="$secrets" sh "$package_dir/verify-deployment.sh"
