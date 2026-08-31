import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { resolveCommitIdentity } from "../../packages/build-identity/scripts/commit-identity.mjs";

// Each build is named by its commit, so SvelteKit's version poll can tell a running tab that a
// newer deployment is live ($app/state `updated` — the version chip renders the notice). The
// commit rather than the default timestamp: two builds of the same commit are the same bytes and
// must not raise an update; a build that cannot name its commit falls back to the timestamp, which
// errs toward announcing a deploy rather than staying silent about one.
const { commit } = resolveCommitIdentity();

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ fallback: "index.html", pages: "build", assets: "build" }),
    version: {
      name: commit ?? new Date().toISOString(),
      // How often a running tab compares itself against the deployment (milliseconds). One minute
      // matches the API's own version-aggregate cache: fast enough that a member sees the notice
      // within the deploy's settling time, slow enough to cost nothing.
      pollInterval: 60_000,
    },
  },
};
