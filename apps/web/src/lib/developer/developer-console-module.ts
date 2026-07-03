/*
 * The developer-console module contract. The console (developer-console.svelte) is a thin shell
 * over a registry of modules: each tool the developer-owner fiddles with — motion today; token
 * inspection, layout outlines, mock data seeding tomorrow — is one self-contained Svelte
 * component plus one registry entry (developer-console-registry.ts). That is the ENTIRE
 * extension mechanism: no lifecycle hooks, no inter-module bus, no per-module lazy loading (the
 * whole console is already one DEV-gated dynamic import in the app shell).
 */
import type { Component } from "svelte";

export interface DeveloperConsoleModule {
  /** Stable identifier; also the module's persistence namespace (developer-console-storage.ts). */
  id: string;
  /** Heading now; tab label once a second module makes the shell grow tabs. */
  title: string;
  /** Self-contained panel; must take no required props. */
  component: Component;
}
