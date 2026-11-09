// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import devVarsContent from "../.dev.vars?raw";

// .dev.vars is deliberately tracked: the Miniflare vitest pool and `wrangler dev` both load it,
// so it must exist (with placeholder values) in every checkout. Real secrets never belong in it —
// they go through `wrangler secret put`. This guard pins the tracked file byte-for-byte to the
// known placeholder content, so a real credential dropped into the file fails the suite instead
// of relying on the header comment being read. If you legitimately change the placeholder file,
// update this literal in the same commit.
//
// THE HEADER COMMENT IS PART OF WHAT IS PINNED, and that is the whole point rather than an
// oversight: a byte-for-byte guard cannot tell a rewritten explanation from an inserted
// credential, so it refuses both and a person decides which one it was. The cost is that editing
// the prose in .dev.vars without editing it here leaves the guard red — which is exactly what
// happened, and why this literal now carries the file's current header word for word.
const EXPECTED_PLACEHOLDER_CONTENT = `# Local development and test secrets ONLY — committed because every value here is a placeholder.
# NEVER put a production value in this file; production secrets are set with
# \`wrangler secret put <NAME>\`. Both \`wrangler dev\` and the Miniflare test pool load this file.
# CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER / CLOUDFLARE_ACCOUNT_ID are deliberately ABSENT: they are deploy-time
# secrets for the Cloudflare REST FirmResourceProvider — locally the development adapter runs
# instead, selected by their absence. They ARE in wrangler.jsonc's secrets.required (a deploy
# without them must stop, not provision firms it cannot serve), so wrangler warns about the two
# missing names locally; that warning is the expected shape of a local run, and adding placeholders
# here would select the real adapters against a token that does not exist. The R2_S3_* placeholders
# keep the presigner selection honest: real presigning also needs CLOUDFLARE_ACCOUNT_ID (absent
# above) for the R2 S3 endpoint host, so the dev presigner runs.
AUTH_SECRET=magna-carta-local-development-placeholder-secret
PLATFORM_ADMIN_KEY=magna-carta-local-development-placeholder-platform-admin-key
R2_S3_ACCESS_KEY_ID=magna-carta-local-development-placeholder-r2-access-key-id
R2_S3_SECRET_ACCESS_KEY=magna-carta-local-development-placeholder-r2-secret-access-key
ROOT_KEK=bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=
# PANGRAM_API_KEY (optional): the platform-managed AI-text-detection provider key. Left unset so local dev and tests see AI-text detection as "unavailable"; paste a real Pangram key here to exercise it locally.
`;

describe("dev-vars placeholder guard", () => {
  it("keeps the tracked .dev.vars byte-identical to the known placeholder content", () => {
    expect(devVarsContent).toBe(EXPECTED_PLACEHOLDER_CONTENT);
  });
});
