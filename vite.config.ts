import { defineConfig } from "vite-plus";

export default defineConfig({
  // vp reads test/lint/format defaults from here; run.tasks declares the monorepo graph.
  // @ts-expect-error vp augments the Vite config with `run`; type may not be published yet
  run: {
    tasks: {
      // apps/worker build/dev/deploy depend on the SPA being built first
      "apps/worker#build": { dependsOn: ["apps/web#build"] },
      "apps/worker#dev": { dependsOn: ["apps/web#build"] },
    },
  },
});
