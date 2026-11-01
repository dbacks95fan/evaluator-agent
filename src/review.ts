// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Drives the OpenAI Responses API review for one candidate: read-only tool calls, then a schema-checked verdict.
// ABOUTME: Stateless (store: false); bounded by turns and wall clock. The verdict is the model's claim, not the result.
import { compileValidator } from "./lifecycle.js";
import { runReadTool, TOOL_DEFINITIONS, type ReadToolContext } from "./readTools.js";

export interface ReviewFinding {
  category: "implementation" | "specification" | "policy" | "evidence";
  severity: "blocking" | "non_blocking";
  summary: string;
  path: string | null;
}

export interface Review {
  status: "pass" | "fail" | "needs_decision";
  summary: string;
  acceptance_criteria: { index: number; verdict: "satisfied" | "not_satisfied" | "not_verified"; evidence: string }[];
  findings: ReviewFinding[];
  decisions_needed: { question: string; options: string[]; recommendation: string }[];
}

const stringArray = { type: "array", items: { type: "string" } } as const;

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "acceptance_criteria", "findings", "decisions_needed"],
  properties: {
    status: { type: "string", enum: ["pass", "fail", "needs_decision"] },
    summary: { type: "string" },
    acceptance_criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "verdict", "evidence"],
        properties: {
          index: { type: "integer" },
          verdict: { type: "string", enum: ["satisfied", "not_satisfied", "not_verified"] },
          evidence: { type: "string" },
        },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "summary", "path"],
        properties: {
          category: { type: "string", enum: ["implementation", "specification", "policy", "evidence"] },
          severity: { type: "string", enum: ["blocking", "non_blocking"] },
          summary: { type: "string" },
          path: { type: ["string", "null"] },
        },
      },
    },
    decisions_needed: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "recommendation"],
        properties: { question: { type: "string" }, options: stringArray, recommendation: { type: "string" } },
      },
    },
  },
};

const validateReview = compileValidator("review", REVIEW_SCHEMA);

/** The model boundary: one Responses API request body in, one response object out. Tests substitute a script. */
export interface ResponsesClient {
  send(body: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>>;
}

export class OpenAIResponsesClient implements ResponsesClient {
  constructor(
    private readonly apiKey: string,
    private readonly requestTimeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly url = "https://api.openai.com/v1/responses",
  ) {}

  async send(body: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(this.requestTimeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, timeout]),
        });
      } catch (err) {
        if (signal.aborted || attempt >= 3)
          throw new Error(`OpenAI API could not be reached: ${(err as Error).message}`);
        await this.sleep(2000 * attempt);
        continue;
      }
      if (response.ok) return (await response.json()) as Record<string, unknown>;
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        await this.sleep(2000 * attempt);
        continue;
      }
      let detail = "";
      try {
        const parsed = (await response.json()) as { error?: { message?: unknown } };
        if (typeof parsed.error?.message === "string") detail = `: ${parsed.error.message.slice(0, 500)}`;
      } catch {
        // No JSON body; the status alone is reported.
      }
      throw new Error(`OpenAI API returned HTTP ${response.status}${detail}`);
    }
  }
}

export interface ReviewUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export interface ReviewOutcome {
  review: Review | null;
  limitHit: "max_turns" | "max_runtime" | null;
  refused: boolean;
  /** Why no review exists when review is null and no limit was hit. */
  problem?: string;
  turns: number;
  usage: ReviewUsage;
  durationMs: number;
}

export interface ReviewParams {
  client: ResponsesClient;
  model: string;
  reasoningEffort?: string;
  instructions: string;
  firstMessage: string;
  tools: ReadToolContext;
  maxTurns: number;
  maxRuntimeMs: number;
  onEvent?: (event: string, data: Record<string, unknown>) => void;
}

function count(source: unknown, ...path: string[]): number {
  let value: unknown = source;
  for (const key of path)
    value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof value === "number" ? value : 0;
}

function outputText(output: unknown[]): { text: string; refusal: string | null } {
  let text = "";
  for (const item of output) {
    const entry = item as { type?: unknown; content?: unknown };
    if (entry.type !== "message" || !Array.isArray(entry.content)) continue;
    for (const part of entry.content as { type?: unknown; text?: unknown; refusal?: unknown }[]) {
      if (part.type === "refusal") return { text: "", refusal: String(part.refusal ?? "") };
      if (part.type === "output_text") text += String(part.text ?? "");
    }
  }
  return { text, refusal: null };
}

export async function runReview(params: ReviewParams): Promise<ReviewOutcome> {
  const emit = params.onEvent ?? (() => undefined);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.maxRuntimeMs);
  const usage: ReviewUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  // Stateless: nothing is stored at OpenAI, so each request carries the whole exchange,
  // including the encrypted reasoning items the model needs between tool calls.
  const conversation: unknown[] = [{ role: "user", content: params.firstMessage }];
  let turns = 0;
  let nudged = false;
  const finish = (partial: Partial<ReviewOutcome>): ReviewOutcome => {
    clearTimeout(timer);
    return { review: null, limitHit: null, refused: false, turns, usage, durationMs: Date.now() - started, ...partial };
  };

  for (;;) {
    if (controller.signal.aborted) return finish({ limitHit: "max_runtime" });
    if (turns >= params.maxTurns) return finish({ limitHit: "max_turns" });
    const body: Record<string, unknown> = {
      model: params.model,
      instructions: params.instructions,
      input: conversation,
      tools: TOOL_DEFINITIONS,
      store: false,
      include: ["reasoning.encrypted_content"],
      text: { format: { type: "json_schema", name: "evaluation_review", schema: REVIEW_SCHEMA, strict: true } },
      ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
    };
    let response: Record<string, unknown>;
    try {
      response = await params.client.send(body, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return finish({ limitHit: "max_runtime" });
      throw err;
    }
    turns += 1;
    usage.inputTokens += count(response.usage, "input_tokens");
    usage.cachedTokens += count(response.usage, "input_tokens_details", "cached_tokens");
    usage.outputTokens += count(response.usage, "output_tokens");
    emit("model_turn", { turn: turns, status: response.status });

    if (response.status !== "completed") {
      const detail = JSON.stringify(response.incomplete_details ?? response.error ?? "no detail");
      return finish({ problem: `The OpenAI response was ${String(response.status)}: ${detail}` });
    }
    const output = Array.isArray(response.output) ? response.output : [];
    conversation.push(...output);
    const calls = output.filter((item) => (item as { type?: unknown }).type === "function_call") as {
      call_id?: unknown;
      name?: unknown;
      arguments?: unknown;
    }[];

    if (calls.length === 0) {
      const { text, refusal } = outputText(output);
      if (refusal !== null) return finish({ refused: true, problem: `The model declined: ${refusal.slice(0, 500)}` });
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const check = validateReview(parsed);
      if (check.valid) return finish({ review: parsed as Review });
      if (nudged)
        return finish({ problem: `The model's verdict was invalid: ${check.errors.join("; ") || "not JSON"}` });
      nudged = true;
      conversation.push({
        role: "user",
        content: "Your final answer must be one JSON object matching the evaluation_review schema. Send it now.",
      });
      continue;
    }

    for (const call of calls) {
      const result = await runReadTool(params.tools, String(call.name), String(call.arguments ?? ""));
      emit("tool_call", { tool: String(call.name), isError: result.startsWith("error: ") });
      conversation.push({ type: "function_call_output", call_id: call.call_id, output: result });
    }
  }
}
