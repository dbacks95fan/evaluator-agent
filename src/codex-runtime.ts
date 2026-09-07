// ABOUTME: Supplies the process environment for every stateless Codex child process.
// ABOUTME: Preserving the Compose-provided home keeps Codex session helpers out of /tmp without persisting host state.
export function codexExecutionEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...environment };
}
