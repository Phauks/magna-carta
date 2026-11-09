/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Ambient binding types for the test harness's `cloudflare:test` `env`.
// `@cloudflare/vitest-pool-workers` types `env` as `Cloudflare.Env`; declare it here so the Miniflare D1 `SELECT 1` is typed.
// The runtime `Bindings` shape lives in `src/bindings.ts`; this mirrors it for the ambient `Cloudflare` namespace the harness expects.
import type { Bindings } from "./src/bindings.ts";

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
