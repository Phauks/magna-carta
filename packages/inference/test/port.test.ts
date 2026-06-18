import { describe, expectTypeOf, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Dispatch } from "@magna-carta/integrations/dispatch";
import type {
  EmbedInput,
  EmbeddingResult,
  GenerateInput,
  GenerateResult,
  InferencePort,
  StreamResult,
} from "../src/port.ts";

describe("InferencePort contract", () => {
  it("generate returns a buffered Dispatch carrying text + token usage + snapshot", () => {
    expectTypeOf<InferencePort["generate"]>().parameter(0).toEqualTypeOf<GenerateInput>();
    expectTypeOf<Awaited<ReturnType<InferencePort["generate"]>>>().toEqualTypeOf<
      Dispatch<GenerateResult>
    >();
    expectTypeOf<GenerateResult["usage"]>().toMatchTypeOf<{
      inputTokens: number;
      outputTokens: number;
    }>();
  });

  it("generateStream returns a token stream plus a deferred usage promise (no buffering)", () => {
    expectTypeOf<Awaited<ReturnType<InferencePort["generateStream"]>>>().toEqualTypeOf<
      Dispatch<StreamResult>
    >();
    expectTypeOf<StreamResult["stream"]>().toMatchTypeOf<AsyncIterable<string>>();
    expectTypeOf<StreamResult["usage"]>().toMatchTypeOf<Promise<unknown>>();
  });

  it("the embedding operation exposes NO firm-selectable model argument (the type-level invariant)", () => {
    expectTypeOf<EmbedInput>().toMatchTypeOf<{ text: string; firmId: FirmId }>();
    // @ts-expect-error embedding takes no caller-supplied model — it is platform-fixed.
    const _bad: EmbedInput = { text: "x", firmId: "firm_1" as FirmId, modelId: "anything" };
    expectTypeOf<Awaited<ReturnType<InferencePort["embed"]>>>().toEqualTypeOf<
      Dispatch<EmbeddingResult>
    >();
  });
});
