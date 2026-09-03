type LogLevel = "info" | "warn" | "error";

function redact(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_OPENAI_KEY]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
}

export function errorMessage(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

export function log(level: LogLevel, event: string, message: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, message, ...details }));
}
