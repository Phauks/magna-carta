// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import { magnusEnabledDefinition } from "@magna-carta/magnus/settings";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../src/bindings.ts";
import { resolveMagnusInferencePort } from "../src/magnus/inference-port-binding.ts";

// The two guarantees the assistant's deploy switch and settings have to make, asserted by running the code rather
// than by reading it: only an exact switch picks a model port, and both consent gates default closed.
//
// The source-scan half of the assistant's fitness suite — no second model port anywhere in the
// repository — lives in packages/magnus/test/one-model-port.test.ts, because this suite runs inside
// the Workers pool and cannot read the repository's files.

const CONVERSATION_INPUT = {
  modelId: "anthropic/claude-opus-5-5",
  firmId: "firm_fitness" as FirmId,
  systemPrompt: "platform-authored text",
  messages: [{ role: "member" as const, content: "hello" }],
};

// A binding-shaped object with no run method: if the gateway port were selected, a call through it
// would fail rather than answer, which is how these tests tell the two implementations apart without
// reaching a network.
const UNUSABLE_BINDING = {} as unknown as Bindings["AI"];

describe("the deploy switch names the model port, and nothing else does", () => {
  it("an unconfigured environment has no port, so a question is never answered by the stub", () => {
    expect(resolveMagnusInferencePort({ AI: UNUSABLE_BINDING } as unknown as Bindings)).toBeNull();
  });

  it("any value other than the two exact switches selects no port", () => {
    for (const value of ["true", "1", "GATEWAY", "Stub", "on", ""]) {
      const port = resolveMagnusInferencePort({
        AI: UNUSABLE_BINDING,
        MAGNUS_INFERENCE_ADAPTER: value,
      } as unknown as Bindings);
      expect(port, `adapter value ${JSON.stringify(value)}`).toBeNull();
    }
  });

  it("the stub is chosen by name and answers deterministically", async () => {
    const port = resolveMagnusInferencePort({
      AI: UNUSABLE_BINDING,
      MAGNUS_INFERENCE_ADAPTER: "stub",
    } as unknown as Bindings);
    const first = await port?.generateConversation(CONVERSATION_INPUT);
    const second = await port?.generateConversation(CONVERSATION_INPUT);
    expect(first?.ok).toBe(true);
    if (first?.ok === true) expect(first.value.snapshotId).toBe("stub");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("the exact switch selects the real gateway port, which cannot answer without a real binding", async () => {
    const port = resolveMagnusInferencePort({
      AI: UNUSABLE_BINDING,
      MAGNUS_INFERENCE_ADAPTER: "gateway",
    } as unknown as Bindings);
    const result = await port?.generateConversation(CONVERSATION_INPUT);
    // The gateway port was selected — it tried to reach the binding and produced a caller-safe
    // failure instead of a stub answer.
    expect(result?.ok).toBe(false);
  });
});

describe("both consent gates default closed", () => {
  it("the two settings this feature reads both default to false in code", () => {
    expect(magnusEnabledDefinition.defaultValue).toBe(false);
    expect(aiProcessingEligibilityDefinition.defaultValue).toBe(false);
  });
});
