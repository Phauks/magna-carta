/// <reference types="@cloudflare/vitest-plugin/types" />

// Ambient binding types for the test harness's `cloudflare:test` `env`.
// `@cloudflare/vitest-plugin` types `env` as `Cloudflare.Env`; declare it here so the Miniflare D1 `SELECT 1` is typed.
// The runtime `Bindings` shape lives in `src/app.ts`; this mirrors it for the ambient `Cloudflare` namespace the harness expects.
import type { Bindings } from "./src/app.ts";

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
