// ABOUTME: Creates repository-scoped GitHub App installation tokens for Evaluator Git operations.
import { createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface GitHubAppTokenRequest {
  appId: string;
  installationId: string;
  privateKeyFile: string;
  repositoryUrl: string;
  contentsPermission: "read" | "write";
  fetchFn?: typeof fetch;
  now?: () => number;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function githubRepository(repositoryUrl: string): { owner: string; name: string } {
  const match = repositoryUrl.replace(/\.git$/i, "").match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error("GitHub App access requires an HTTPS GitHub repository URL.");
  return { owner: match[1], name: match[2] };
}

function appJwt(appId: string, privateKey: string, now: number): string {
  const issuedAt = Math.floor(now / 1000) - 60;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iss: appId, iat: issuedAt, exp: issuedAt + 540 }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(privateKey));
  return `${unsigned}.${base64Url(signature)}`;
}

/** Mint a short-lived token scoped to one repository and the requested Contents permission. */
export async function createGitHubAppInstallationToken(request: GitHubAppTokenRequest): Promise<string> {
  if (!request.appId || !request.installationId || !request.privateKeyFile) {
    throw new Error("Evaluator GitHub App ID, installation ID, and private-key file are required.");
  }
  const { name } = githubRepository(request.repositoryUrl);
  const privateKey = await readFile(request.privateKeyFile, "utf8");
  const jwt = appJwt(request.appId, privateKey, (request.now ?? Date.now)());
  const fetchFn = request.fetchFn ?? fetch;
  const response = await fetchFn(`https://api.github.com/app/installations/${encodeURIComponent(request.installationId)}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      "User-Agent": "agentic-sdlc-evaluator",
      "X-GitHub-Api-Version": "2022-11-28",
    },
      body: JSON.stringify({ repositories: [name], permissions: { contents: request.contentsPermission } }),
  });
  if (!response.ok) throw new Error(`GitHub App could not mint an installation token (HTTP ${response.status}).`);
  const body = await response.json() as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) throw new Error("GitHub App token response did not contain an installation token.");
  return body.token;
}
