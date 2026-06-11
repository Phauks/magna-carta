import { describe, expect, it } from "vitest";
import devVarsContent from "../.dev.vars?raw";

// .dev.vars is deliberately tracked: the Miniflare vitest pool and `wrangler dev` both load it,
// so it must exist (with placeholder values) in every checkout. Real secrets never belong in it —
// they go through `wrangler secret put`. This guard pins the tracked file byte-for-byte to the
// known placeholder content, so a real credential dropped into the file fails the suite instead
// of relying on the header comment being read. If you legitimately change the placeholder file,
// update this literal in the same commit.
const EXPECTED_PLACEHOLDER_CONTENT = `# Local development and test secrets ONLY — committed because every value here is a placeholder.
# NEVER put a production value in this file; production secrets are set with
# \`wrangler secret put <NAME>\`. Both \`wrangler dev\` and the Miniflare test pool load this file.
AUTH_SECRET=magna-carta-local-development-placeholder-secret
`;

describe("dev-vars placeholder guard", () => {
  it("keeps the tracked .dev.vars byte-identical to the known placeholder content", () => {
    expect(devVarsContent).toBe(EXPECTED_PLACEHOLDER_CONTENT);
  });
});
