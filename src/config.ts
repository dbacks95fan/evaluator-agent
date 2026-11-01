// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Reads runtime configuration from the environment; secrets are never logged or passed to children.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubAppSettings } from "./githubApp.js";

export interface EvaluatorLimits {
  maxTurns: number;
  maxRuntimeMs: number;
  requestTimeoutMs: number;
  checkTimeoutMs: number;
  setupTimeoutMs: number;
  maxToolOutputChars: number;
}

export interface RuntimeConfig {
  openaiApiKey?: string;
  model: string;
  /** OpenAI reasoning effort; the API default applies when unset. */
  reasoningEffort?: string;
  limits: EvaluatorLimits;
  /** Absent when no remote needs credentials, as with local test repositories. */
  githubApp?: GitHubAppSettings;
  gitIdentity: { name: string; email: string };
  apiToken?: string;
  manifestPath: string;
  workRoot: string;
  shell: string;
  port: number;
  /** Extra variables passed to setup and check commands, e.g. shared cache locations. */
  commandEnv: Record<string, string>;
}

/** The model OpenAI's Codex documentation configured as of 2026-10-31; override with EVALUATOR_MODEL. */
export const DEFAULT_MODEL = "gpt-6.1-sol";

function number(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

/** Variables with this prefix are forwarded to commands with the prefix removed. */
const COMMAND_ENV_PREFIX = "EVALUATOR_COMMAND_ENV_";

const GITHUB_APP_SETTINGS = [
  "EVALUATOR_GITHUB_APP_ID",
  "EVALUATOR_GITHUB_APP_INSTALLATION_ID",
  "EVALUATOR_GITHUB_APP_PRIVATE_KEY_FILE",
] as const;

/** Settings an earlier build read; refused so a stale deployment file is noticed rather than silently ignored. */
const RETIRED: Record<string, string> = {
  EVALUATOR_ALLOWED_REPOSITORY_URLS: "the trusted repositories now come from the manifest at EVALUATOR_MANIFEST",
  EVALUATOR_ALLOWED_REPOSITORY_URL: "the trusted repositories now come from the manifest at EVALUATOR_MANIFEST",
  CODEX_HOME: "the Codex CLI is no longer used; the evaluator calls the OpenAI API directly",
};

/** All three settings or none; error messages name the file and settings, never the key. */
function githubAppSettings(env: NodeJS.ProcessEnv): GitHubAppSettings | undefined {
  const missing = GITHUB_APP_SETTINGS.filter((name) => !env[name]);
  if (missing.length === GITHUB_APP_SETTINGS.length) return undefined;
  if (missing.length) throw new Error(`GitHub App settings are incomplete; also set ${missing.join(", ")}.`);

  const appId = env.EVALUATOR_GITHUB_APP_ID as string;
  const installationId = env.EVALUATOR_GITHUB_APP_INSTALLATION_ID as string;
  const keyFile = env.EVALUATOR_GITHUB_APP_PRIVATE_KEY_FILE as string;
  if (!/^\d+$/.test(appId)) throw new Error("EVALUATOR_GITHUB_APP_ID must be the app's numeric App ID.");
  if (!/^\d+$/.test(installationId)) {
    throw new Error("EVALUATOR_GITHUB_APP_INSTALLATION_ID must be the numeric installation ID.");
  }

  let privateKey: string;
  try {
    privateKey = readFileSync(keyFile, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read the GitHub App private key file ${keyFile} (${(err as NodeJS.ErrnoException).code}).`,
      {
        cause: err,
      },
    );
  }
  try {
    createPrivateKey(privateKey);
  } catch {
    throw new Error(`The GitHub App private key file ${keyFile} does not hold a usable private key.`);
  }
  return { appId, installationId, privateKey, apiUrl: env.EVALUATOR_GITHUB_API_URL || "https://api.github.com" };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  for (const [name, why] of Object.entries(RETIRED)) {
    if (env[name]) throw new Error(`${name} is no longer used; remove it (${why}).`);
  }

  const commandEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith(COMMAND_ENV_PREFIX) && value !== undefined) {
      commandEnv[name.slice(COMMAND_ENV_PREFIX.length)] = value;
    }
  }

  return {
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    model: env.EVALUATOR_MODEL || DEFAULT_MODEL,
    reasoningEffort: env.EVALUATOR_REASONING_EFFORT || undefined,
    limits: {
      maxTurns: number(env, "EVALUATOR_MAX_TURNS", 40),
      maxRuntimeMs: number(env, "EVALUATOR_MAX_RUNTIME_MIN", 30) * 60_000,
      requestTimeoutMs: number(env, "EVALUATOR_REQUEST_TIMEOUT_SEC", 300) * 1000,
      checkTimeoutMs: number(env, "EVALUATOR_CHECK_TIMEOUT_MIN", 15) * 60_000,
      setupTimeoutMs: number(env, "EVALUATOR_SETUP_TIMEOUT_MIN", 20) * 60_000,
      maxToolOutputChars: number(env, "EVALUATOR_MAX_TOOL_OUTPUT_CHARS", 30_000),
    },
    githubApp: githubAppSettings(env),
    gitIdentity: {
      name: env.EVALUATOR_GIT_NAME ?? "evaluator-agent",
      email: env.EVALUATOR_GIT_EMAIL ?? "evaluator-agent@users.noreply.github.com",
    },
    apiToken: env.EVALUATOR_API_TOKEN || undefined,
    manifestPath: env.EVALUATOR_MANIFEST ?? "/config/manifest.json",
    workRoot: env.EVALUATOR_WORK_ROOT ?? join(tmpdir(), "evaluator-agent"),
    shell: env.EVALUATOR_SHELL ?? "bash",
    port: number(env, "PORT", 8080),
    commandEnv,
  };
}

/** Values that must be scrubbed from any text this process emits. */
export function secretValues(config: RuntimeConfig): string[] {
  return [config.openaiApiKey, config.githubApp?.privateKey, config.apiToken].filter((v): v is string => Boolean(v));
}
