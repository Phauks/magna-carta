/*
 * The developer-console module registry. Adding a tool = one self-contained module component
 * (modules/<name>/<name>-module.svelte) + one entry here; the console shell renders every
 * registered module as one tab segment. See developer-console-module.ts for the contract and
 * the deliberate ceiling on this mechanism's complexity.
 */
import type { DeveloperConsoleModule } from "./developer-console-module.ts";
import MotionModule from "./modules/motion/motion-module.svelte";
import AppearanceModule from "./modules/appearance/appearance-module.svelte";
import PerformanceModule from "./modules/performance/performance-module.svelte";
import SitemapModule from "./modules/sitemap/sitemap-module.svelte";
import ResourcesModule from "./modules/resources/resources-module.svelte";

export const DEVELOPER_CONSOLE_MODULES: readonly DeveloperConsoleModule[] = [
  { id: "motion", title: "Motion", component: MotionModule },
  { id: "appearance", title: "Appearance", component: AppearanceModule },
  { id: "performance", title: "Performance", component: PerformanceModule },
  { id: "sitemap", title: "Sitemap", component: SitemapModule },
  { id: "resources", title: "Resources", component: ResourcesModule },
];
