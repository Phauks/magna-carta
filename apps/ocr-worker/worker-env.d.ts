/// <reference types="@cloudflare/vitest-plugin/types" />

// Ambient binding types for the test harness's `cloudflare:test` `env`.
// `@cloudflare/vitest-plugin` types `env` as `Cloudflare.Env`; declare it here so the pool
// can resolve binding types. The runtime `Bindings` shape lives in `src/index.ts`.
import type { Bindings } from "./src/index.ts";

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}

export {};
