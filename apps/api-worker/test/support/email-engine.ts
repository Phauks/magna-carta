import { EmailError, ensureReady, extractPart, parseMessage } from "@magna-carta/email";
import emailWasmModule from "@magna-carta/email/src/pkg/email_core_bg.wasm";
import { MessageRefusedError, type EmailEnginePort } from "../../src/emails/email-engine-port.ts";
import type { ParsedMessage } from "@magna-carta/email-filing/message";

// The email parse engine, running in this test's own isolate rather than over a service binding.
//
// In production the engine lives in apps/email-worker and this Worker reaches it over
// EMAIL_SERVICE. That worker does not run under the local pool, so a suite about CAPTURE — dedup,
// threading, auto-file rules, attachment filing — would otherwise be testing the no-engine port
// instead of the pipeline it is about. This runs the same email-core build the email worker runs,
// behind the same port, and maps the same stable codes.
//
// It is deliberately not a fake: a stub that invented a parse would make every capture assertion a
// statement about the stub. What it does NOT cover is the wire — the status mapping, the framing,
// and the three engine states — and that is held by test/email-engine-adapter.test.ts, which drives
// the adapter with fake responses. Neither test can stand in for the other.
//
// The dependency this file needs is a devDependency of apps/api-worker for exactly this reason:
// nothing under src/ names @magna-carta/email, so the engine is not in the deployed bundle.
const emailWasm = emailWasmModule as unknown as WebAssembly.Module;

function asRefusal(thrown: unknown): unknown {
  return thrown instanceof EmailError ? new MessageRefusedError(thrown.code) : thrown;
}

export function inProcessEmailEnginePort(): EmailEnginePort {
  return {
    async parseMessage(bytes: Uint8Array): Promise<ParsedMessage> {
      await ensureReady(emailWasm);
      try {
        return await parseMessage(bytes);
      } catch (thrown) {
        throw asRefusal(thrown);
      }
    },
    async extractPart(bytes: Uint8Array, partIndex: number): Promise<Uint8Array> {
      await ensureReady(emailWasm);
      try {
        return await extractPart(bytes, partIndex);
      } catch (thrown) {
        throw asRefusal(thrown);
      }
    },
  };
}

/** Resolver form, for the `resolveEngine` parameter `handleCaptureMessage` takes. */
export function resolveInProcessEmailEngine(): EmailEnginePort {
  return inProcessEmailEnginePort();
}
