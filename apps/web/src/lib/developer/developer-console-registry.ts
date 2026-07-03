/*
 * The developer-console module registry. Adding a tool = one self-contained module component
 * (modules/<name>/<name>-module.svelte) + one entry here; the console shell renders whatever is
 * registered (one module: plain; two or more: tabs). See developer-console-module.ts for the
 * contract and the deliberate ceiling on this mechanism's complexity.
 */
import type { DeveloperConsoleModule } from "./developer-console-module.ts";
import MotionModule from "./modules/motion/motion-module.svelte";

export const DEVELOPER_CONSOLE_MODULES: readonly DeveloperConsoleModule[] = [
  { id: "motion", title: "Motion", component: MotionModule },
];
