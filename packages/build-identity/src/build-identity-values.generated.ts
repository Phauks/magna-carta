/*
 * GENERATED at deploy build time by scripts/generate-build-identity.mjs — the checked-in state IS
 * the honest development placeholder. A Worker built straight from a checkout (local `wrangler
 * dev`, tests, a dry-run build) reports "dev" with no timestamps rather than inventing an
 * identity; a real deploy's build step overwrites this file in its throwaway CI checkout, so the
 * deployed Worker reports the commit it was actually built from. Never hand-edit real values into
 * this file, and never commit a regenerated copy: a committed commit hash goes stale on the next
 * commit, and a stale claim is worse than an honest "dev".
 */
export const GENERATED_BUILD_IDENTITY: {
  commit: string;
  commitTime: string | null;
  buildTime: string | null;
} = {
  commit: "dev",
  commitTime: null,
  buildTime: null,
};
