/// <reference types="@cloudflare/vitest-plugin/types" />

// Ambient binding types for the test harness's `cloudflare:test` `env`. The runtime `Bindings`
// shape lives in `src/bindings.ts`; TEST_MIGRATIONS is the control-plane lineage vitest.config.ts
// reads for the setup file.
import type { D1Migration } from "cloudflare:test";
import type { Bindings } from "./src/bindings.ts";

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
