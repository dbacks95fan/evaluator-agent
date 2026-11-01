// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Unit tests for the Responses API review loop and the HTTP client, with scripted model responses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAIResponsesClient, runReview, type ReviewParams } from "./review.js";
import {
  functionCall,
  passingReview,
  removeDir,
  responseOf,
  ScriptedResponses,
  tempDir,
  verdictMessage,
  writeBytes,
} from "./testSupport.js";

function params(client: ScriptedResponses, workspace: string, overrides: Partial<ReviewParams> = {}): ReviewParams {
  return {
    client,
    model: "gpt-6.1-sol",
    instructions: "Evaluate.",
    firstMessage: "Candidate abc.",
    tools: { workspace, diff: async () => "diff --git a/x b/x", maxOutputChars: 10_000 },
    maxTurns: 5,
    maxRuntimeMs: 60_000,
    ...overrides,
  };
}

test("a tool round trip replays the call and its output, statelessly, then returns the verdict", async () => {
  const workspace = tempDir("review-");
  try {
    writeBytes(workspace, "src/a.txt", "alpha\n");
    const reasoning = { type: "reasoning", id: "rs_1", encrypted_content: "opaque", summary: [] };
    const call = functionCall("c1", "read_file", { path: "src/a.txt", offset: null });
    const client = new ScriptedResponses([
      responseOf([reasoning, call], { input_tokens: 100, output_tokens: 10 }),
      {
        ...responseOf([verdictMessage(passingReview)]),
        usage: { input_tokens: 200, input_tokens_details: { cached_tokens: 90 }, output_tokens: 20 },
      },
    ]);
    const outcome = await runReview(params(client, workspace, { reasoningEffort: "high" }));
    assert.deepEqual(outcome.review, passingReview);
    assert.equal(outcome.turns, 2);
    assert.deepEqual(outcome.usage, { inputTokens: 300, cachedTokens: 90, outputTokens: 30 });
    const [first, second] = client.requests as Record<string, unknown>[];
    assert.equal(first.store, false);
    assert.deepEqual(first.include, ["reasoning.encrypted_content"]);
    assert.deepEqual(first.reasoning, { effort: "high" });
    assert.equal((first.text as { format: { name: string; strict: boolean } }).format.name, "evaluation_review");
    assert.deepEqual(
      (first.tools as { name: string }[]).map((t) => t.name),
      ["list_directory", "read_file", "search_files", "show_diff"],
    );
    assert.deepEqual((second.input as unknown[]).slice(1), [
      reasoning,
      call,
      { type: "function_call_output", call_id: "c1", output: "alpha\n" },
    ]);
  } finally {
    removeDir(workspace);
  }
});

test("an invalid verdict gets one nudge, then is reported as a problem", async () => {
  const client = new ScriptedResponses([
    responseOf([verdictMessage({ status: "maybe" })]),
    responseOf([verdictMessage({ status: "still wrong" })]),
  ]);
  const outcome = await runReview(params(client, "."));
  assert.equal(outcome.review, null);
  assert.match(outcome.problem!, /verdict was invalid/);
  assert.match(
    String((client.requests[1].input as { content?: string }[]).at(-1)!.content),
    /evaluation_review schema/,
  );
});

test("a refusal, an incomplete response, and the turn limit each end the review without a verdict", async () => {
  const refusal = await runReview(
    params(
      new ScriptedResponses([responseOf([{ type: "message", content: [{ type: "refusal", refusal: "no" }] }])]),
      ".",
    ),
  );
  assert.equal(refusal.refused, true);

  const incomplete = await runReview(
    params(new ScriptedResponses([{ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }]), "."),
  );
  assert.match(incomplete.problem!, /incomplete.*max_output_tokens/);

  const call = () => responseOf([functionCall("c", "list_directory", { path: "." })]);
  const limited = await runReview(params(new ScriptedResponses([call(), call()]), ".", { maxTurns: 2 }));
  assert.equal(limited.limitHit, "max_turns");
});

test("the runtime limit aborts an in-flight request", async () => {
  const client = new ScriptedResponses([
    (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
  ]);
  const outcome = await runReview(params(client, ".", { maxRuntimeMs: 50 }));
  assert.equal(outcome.limitHit, "max_runtime");
});

test("the HTTP client sends the bearer key, retries server errors, and reports a rejected key without echoing it", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const replies = [
    new Response("{}", { status: 503 }),
    new Response(JSON.stringify({ status: "completed", output: [] }), { status: 200 }),
  ];
  const waits: number[] = [];
  const client = new OpenAIResponsesClient(
    "sk-proj-test-key-0123456789",
    5_000,
    async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return replies.shift()!;
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.deepEqual(await client.send({ model: "m" }, new AbortController().signal), {
    status: "completed",
    output: [],
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer sk-proj-test-key-0123456789");
  assert.deepEqual(waits, [2000]);

  const rejecting = new OpenAIResponsesClient(
    "sk-proj-test-key-0123456789",
    5_000,
    async () => new Response(JSON.stringify({ error: { message: "Incorrect API key provided." } }), { status: 401 }),
  );
  await assert.rejects(rejecting.send({}, new AbortController().signal), (err: Error) => {
    assert.equal(err.message, "OpenAI API returned HTTP 401: Incorrect API key provided.");
    return !err.message.includes("sk-proj");
  });
});
