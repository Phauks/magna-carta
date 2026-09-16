/*
 * The rules of the secret scan, and why each one exists. The runner is index.mjs; every decision
 * here is a pure function over (path, source) so it can be unit-tested without a repository.
 *
 * WHY THIS EXISTS. This platform holds firm credentials, the root key-encryption key that wraps
 * every per-firm data key, and privileged client documents. A credential committed to git is
 * compromised the moment it is pushed and stays compromised in the object database after the
 * commit that removes it, so the only cheap moment to catch one is before it lands. There was no
 * scan of any kind here before this file.
 *
 * NO THIRD-PARTY TOOL OR SaaS. Same standing constraint the license gate states: the firm keeps
 * this kind of metadata on its own compute. A hosted secret scanner is handed, by construction,
 * exactly the bytes it is looking for. So this is plain text matching over tracked files with
 * node builtins only — no install, no network, no service.
 *
 * PRECISION OVER RECALL, DELIBERATELY. A scan that fires on golden test vectors and seeded
 * identifiers is switched off within a week, and a switched-off scan catches nothing at all. Every
 * rule below is therefore either a vendor-issued credential shape that cannot occur by accident
 * (an AWS key id, a GitHub token, a PEM private-key header) or is gated on BOTH a secret-shaped
 * name AND a high-entropy value AND the absence of a placeholder marker. The carve-outs are
 * derived from what this repository actually contains, and each is named with its reason below.
 *
 * NOTHING SECRET IS EVER PRINTED. A finding reports the path, the line, the rule and a redacted
 * fingerprint (leading characters plus a length) — never the matched value. A scan that echoes the
 * credential into a build log has moved it from one durable store to another.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH, stated plainly, because a gate that claims more than it
 * delivers is worse than none:
 *
 *   - A secret that is not shaped like one. A 20-character human-chosen password, a bearer value
 *     assigned to a name nobody would call a secret, a credential split across concatenated
 *     fragments, or one assembled at runtime. Every rule reads source text, not behaviour.
 *   - A secret in an untracked or git-ignored file. The scan walks `git ls-files`, so it sees what
 *     would be pushed. That is the boundary that matters; a local .env nobody tracks is not one.
 *   - A secret in git HISTORY. This answers "is the tree about to be pushed clean", not "was a
 *     credential ever committed". History rewriting and rotation are incident response, not a lint.
 *   - A binary file's contents. Files with a NUL byte in their first block are skipped: a
 *     credential hidden inside a .docx fixture is not a shape text matching can reach.
 *   - Whether a committed credential is LIVE. The scan cannot tell a rotated key from a current
 *     one, so every finding is treated as live until a person says otherwise.
 *   - A publishable-by-design value. A Stripe `pk_` publishable key and a public VAPID key are
 *     meant to ship in a browser bundle; flagging them teaches people to ignore the gate.
 *
 * SELF-SCANNING. This tool's own source is NOT skipped, and that is a deliberate property: every
 * pattern below is written so that its own source text cannot satisfy it (character classes stand
 * where the literal prefix would be, and `-{5}` stands where five dashes would), and every
 * self-test sample in SELF_TEST is assembled from fragments at run time rather than written out.
 * So the scan walks this directory like any other and finds nothing — which means a real secret
 * dropped into this directory is still caught, instead of hiding in the one place a scanner is
 * usually blind.
 *
 * Run: `pnpm run lint:secrets`. Pure text over tracked files; no install, no build, no network.
 */

/* ---------------------------------------------------------------------------------------------
 * Shared value judgement: is this string a placeholder rather than a credential?
 * ------------------------------------------------------------------------------------------- */

/**
 * Markers that make a value self-evidently not a credential. Drawn from what the repository
 * already commits on purpose: apps/api-worker/.dev.vars is tracked WITH values, because every one
 * of them says "placeholder" or "local-development" in the clear, and a byte-identity test pins
 * the file so a real credential dropped in fails the suite. This scan agrees with that test rather
 * than second-guessing it.
 */
const PLACEHOLDER_MARKERS = [
  "placeholder",
  "example",
  "changeme",
  "change-me",
  "change_me",
  "dummy",
  "sample",
  "local-dev",
  "local_dev",
  "localdev",
  "development",
  "fake",
  "not-a-real",
  "not_a_real",
  "notarreal",
  "test-only",
  "test_only",
  "your-",
  "your_",
  "todo",
  "redacted",
  "xxxxx",
  "aaaaaa",
  "0000000000",
  "deadbeef",
];

/** A value that is only `<angle brackets>` or `${interpolation}` is a template, not a secret. */
const TEMPLATE_SHAPE = /^[<$]|\$\{|\{\{|<[a-z]/i;

/**
 * Base64 hides English. `ROOT_KEK` in apps/api-worker/.dev.vars is a base64 blob whose plaintext
 * reads "magna-carta-local-dev-root-kek!!" — a placeholder wearing a credential's clothes. Decoding
 * one level and re-running the marker test is what lets the gate accept it without an allowlist
 * entry, which matters: an allowlist entry for a path stops looking at the path, and this keeps
 * looking at the value.
 */
export function decodeIfBase64(value) {
  if (!/^[A-Za-z0-9+/_-]{8,}={0,2}$/.test(value)) return null;
  let decoded;
  try {
    decoded = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString(
      "utf8",
    );
  } catch {
    return null;
  }
  // Only trust the decode when it produced ordinary printable text; random key bytes decode to
  // mojibake, and mojibake must not be read as evidence of anything. Tested by code point rather
  // than by a character class, so this source never has to carry a control character at all.
  if (decoded.length < 4) return null;
  for (let index = 0; index < decoded.length; index += 1) {
    const code = decoded.charCodeAt(index);
    const printable = code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    if (!printable) return null;
  }
  return decoded;
}

/** True when the value announces itself as a placeholder, directly or one base64 layer down. */
export function isPlaceholder(value) {
  if (value === "" || value === '""' || value === "''") return true;
  if (TEMPLATE_SHAPE.test(value)) return true;
  const lower = value.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) return true;
  const decoded = decodeIfBase64(value);
  if (decoded) {
    const decodedLower = decoded.toLowerCase();
    if (PLACEHOLDER_MARKERS.some((marker) => decodedLower.includes(marker))) return true;
  }
  return false;
}

/** Shannon entropy in bits per character. A real key sits near 4+ for base64, 3.7+ for hex. */
export function shannonEntropy(value) {
  if (value.length === 0) return 0;
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

/** A redacted fingerprint: enough to find the value in the file, never enough to use it. */
export function fingerprint(value) {
  const head = value.slice(0, 4);
  return `${head}… (${value.length} characters)`;
}

/* ---------------------------------------------------------------------------------------------
 * Which files are worth reading at all.
 * ------------------------------------------------------------------------------------------- */

/**
 * Extensions whose bytes are a compiled or compressed artefact. Text matching over them produces
 * noise, never a finding a person can act on. The NUL-byte probe in index.mjs is the general
 * defence; this list just avoids reading megabytes to reach it.
 */
export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".icns",
  ".bmp",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".zip",
  ".7z",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".wasm",
  ".docx",
  ".doc",
  ".odt",
  ".xlsx",
  ".pptx",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".onnx",
  ".bin",
  ".db",
  ".sqlite",
  ".jar",
  ".class",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
]);

/**
 * Files whose whole job is holding environment assignments. Rule R10 reads only these, and reads
 * every line in them. The shapes: `.env` and `.env.<stage>`, a `<name>.env` sibling, `.dev.vars`
 * and `.dev.vars.<stage>` (what wrangler and the Miniflare test pool load), and `.envrc`. The tree
 * tracks exactly one today — apps/api-worker/.dev.vars — and that is the file the rule exists for.
 */
export function isEnvironmentFile(file) {
  const name = file.split("/").pop() ?? "";
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name.endsWith(".env") ||
    name === ".dev.vars" ||
    name.startsWith(".dev.vars.") ||
    name.endsWith(".envrc")
  );
}

/* ---------------------------------------------------------------------------------------------
 * Line bookkeeping.
 * ------------------------------------------------------------------------------------------- */

function lineOf(source, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (source.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

function finding(rule, file, source, index, value, fix) {
  return { rule, file, line: lineOf(source, index), evidence: fingerprint(value), fix };
}

/* ---------------------------------------------------------------------------------------------
 * R1 — private key material.
 * ------------------------------------------------------------------------------------------- */

/*
 * A PEM private-key header is unambiguous: nothing else in a source tree opens with one. Written
 * as `-{5}` rather than five dashes so this file does not match its own rule.
 */
const PRIVATE_KEY_HEADER = /-{5}BEGIN(?: [A-Z0-9]+){0,4} PRIVATE KEY(?: BLOCK)?-{5}/g;

export function findPrivateKeyMaterial(file, source) {
  const found = [];
  for (const match of source.matchAll(PRIVATE_KEY_HEADER)) {
    found.push(
      finding(
        "private-key",
        file,
        source,
        match.index,
        match[0],
        "Remove the key from the tree, rotate it (it is compromised from the moment it is pushed), " +
          "and set the replacement with `wrangler secret put <NAME>` — never a tracked file. A key " +
          "a TEST needs must be generated inside the test, not committed beside it.",
      ),
    );
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * R2/R3 — Amazon Web Services.
 * ------------------------------------------------------------------------------------------- */

/*
 * The vendor-assigned access-key-id prefixes. R2's S3-compatible API uses the same shape, so this
 * rule covers the firm's own object-storage credentials as well as any AWS account's.
 */
const AWS_ACCESS_KEY_ID = /\b(?:A(?:KIA|SIA|ROA|IDA|NPA|NVA|GPA|IPA|BIA|CCA|3T))[A-Z2-7]{16}\b/g;

export function findAwsAccessKeyId(file, source) {
  const found = [];
  for (const match of source.matchAll(AWS_ACCESS_KEY_ID)) {
    // The vendor's own documentation identifier says EXAMPLE in the middle of it, on purpose.
    if (match[0].includes("EXAMPLE")) continue;
    found.push(
      finding(
        "aws-access-key-id",
        file,
        source,
        match.index,
        match[0],
        "Delete the access key in the provider console (it is compromised), remove the literal, and " +
          "read the replacement from a Worker secret — R2_S3_ACCESS_KEY_ID is already wired that way.",
      ),
    );
  }
  return found;
}

/*
 * The secret half has no prefix — it is 40 characters of base64 alphabet, which on its own matches
 * a great deal of innocent text. So it is gated on the name it is assigned to. The 40 characters
 * must be delimited on both sides, which is what keeps the tracked placeholder
 * (`…-placeholder-r2-secret-access-key`, hyphenated and therefore never a 40-character run) out.
 */
const AWS_SECRET_ACCESS_KEY =
  /(?:aws|r2|s3)?_?secret_?access_?key\b\s*[:=]\s*["']?([A-Za-z0-9+/]{40})(?![A-Za-z0-9+/-])/gi;

export function findAwsSecretAccessKey(file, source) {
  const found = [];
  for (const match of source.matchAll(AWS_SECRET_ACCESS_KEY)) {
    if (isPlaceholder(match[1])) continue;
    found.push(
      finding(
        "aws-secret-access-key",
        file,
        source,
        match.index,
        match[1],
        "Delete the key pair in the provider console, remove the literal, and read the replacement " +
          "from a Worker secret set with `wrangler secret put`.",
      ),
    );
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * R4 — GitHub.
 * ------------------------------------------------------------------------------------------- */

/*
 * GitHub's issued shapes: the `gh?_` family (classic personal, OAuth, user-to-server,
 * server-to-server, refresh) and the fine-grained `github_pat_` form. Both are vendor-prefixed and
 * cannot arise by accident.
 */
const GITHUB_TOKEN =
  /\b(?:gh[pousr]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\b/g;

export function findGithubToken(file, source) {
  const found = [];
  for (const match of source.matchAll(GITHUB_TOKEN)) {
    found.push(
      finding(
        "github-token",
        file,
        source,
        match.index,
        match[0],
        "Revoke the token at github.com/settings/tokens, remove the literal, and supply the " +
          "replacement through the environment (a repository secret in the gate, a Worker secret " +
          "in production) rather than a tracked file.",
      ),
    );
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * R5 — Cloudflare.
 * ------------------------------------------------------------------------------------------- */

/*
 * Two shapes. The Origin CA key is vendor-prefixed and self-identifying. An API token, by
 * contrast, is 40 unprefixed token characters and the legacy Global API Key is 37 hex characters —
 * neither is distinguishable from an identifier, so both are gated on a Cloudflare-shaped name.
 * The repository's own naming convention (`CLOUDFLARE_API_TOKEN_<purpose>`) is what the name test
 * is built around.
 */
const CLOUDFLARE_ORIGIN_CA_KEY = /\bv1\.0-[A-Za-z0-9]{24}-[A-Za-z0-9_-]{140,}/g;
const CLOUDFLARE_NAMED_CREDENTIAL =
  /\b((?:CLOUDFLARE|CF)_[A-Z0-9_]*(?:API_TOKEN|API_KEY|TOKEN|KEY)[A-Z0-9_]*)\s*[:=]\s*["']?([A-Za-z0-9_-]{37,})["']?/g;

export function findCloudflareCredential(file, source) {
  const found = [];
  for (const match of source.matchAll(CLOUDFLARE_ORIGIN_CA_KEY)) {
    found.push(
      finding(
        "cloudflare-origin-ca-key",
        file,
        source,
        match.index,
        match[0],
        "Roll the Origin CA key in the Cloudflare dashboard and remove the literal; it belongs in a " +
          "Worker secret, never in the tree.",
      ),
    );
  }
  for (const match of source.matchAll(CLOUDFLARE_NAMED_CREDENTIAL)) {
    if (isPlaceholder(match[2])) continue;
    found.push(
      finding(
        "cloudflare-api-token",
        file,
        source,
        match.index,
        match[2],
        `Roll the token in the Cloudflare dashboard, remove the literal, and set ${match[1]} with ` +
          "`wrangler secret put` — Cloudflare credentials are named per purpose so each stays " +
          "individually rotatable, which only works while none of them is in the tree.",
      ),
    );
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * R6 — Stripe.
 * ------------------------------------------------------------------------------------------- */

/*
 * Secret and restricted keys, live and test, plus the webhook signing secret. The publishable
 * `pk_` key is deliberately absent: it is designed to ship in a browser bundle, and a rule that
 * fires on a value meant to be public is how a gate loses its audience.
 */
const STRIPE_SECRET = /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{24,})\b/g;

export function findStripeKey(file, source) {
  const found = [];
  for (const match of source.matchAll(STRIPE_SECRET)) {
    found.push(
      finding(
        "stripe-secret-key",
        file,
        source,
        match.index,
        match[0],
        "Roll the key in the Stripe dashboard and remove the literal. Test-mode keys are included " +
          "on purpose: they reach real test data and they are how live keys get committed by habit.",
      ),
    );
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * R7 — Slack.
 * ------------------------------------------------------------------------------------------- */

const SLACK_TOKEN = /\bxox[abeoprs]-[A-Za-z0-9-]{12,}\b/g;
const SLACK_WEBHOOK =
  /\bhooks\.slack\.com\/services\/T[A-Za-z0-9_]{6,}\/B[A-Za-z0-9_]{6,}\/[A-Za-z0-9]{20,}/g;

export function findSlackCredential(file, source) {
  const found = [];
  for (const match of source.matchAll(SLACK_TOKEN)) {
    found.push(
      finding(
        "slack-token",
        file,
        source,
        match.index,
        match[0],
        "Revoke the token in the Slack app configuration and remove the literal.",
      ),
    );
  }
  for (const match of source.matchAll(SLACK_WEBHOOK)) {
    found.push(
      finding(
        "slack-webhook",
        file,
        source,
        match.index,
        match[0],
        "A Slack webhook URL is a bearer credential — anyone holding it can post as the app. " +
          "Regenerate it and read it from the environment.",
      ),
    );
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * R8 — Google.
 * ------------------------------------------------------------------------------------------- */

const GOOGLE_API_KEY = /\bAIza[A-Za-z0-9_-]{35}\b/g;

export function findGoogleApiKey(file, source) {
  const found = [];
  for (const match of source.matchAll(GOOGLE_API_KEY)) {
    found.push(
      finding(
        "google-api-key",
        file,
        source,
        match.index,
        match[0],
        "Delete the key in the Google Cloud console and remove the literal; restrict its " +
          "replacement by referrer or address and read it from the environment.",
      ),
    );
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * R9 — JSON Web Tokens with a real-looking payload.
 * ------------------------------------------------------------------------------------------- */

const JSON_WEB_TOKEN = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g;

/** Registered and near-universal claims. A payload carrying two of these is a real token shape. */
const TOKEN_CLAIMS = new Set([
  "iss",
  "sub",
  "aud",
  "exp",
  "nbf",
  "iat",
  "jti",
  "scope",
  "scp",
  "azp",
  "email",
  "email_verified",
  "name",
  "role",
  "roles",
  "permissions",
  "session_id",
  "user_id",
  "firm_id",
  "tenant_id",
  "client_id",
]);

function decodeSegment(segment) {
  try {
    const text = Buffer.from(segment.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString(
      "utf8",
    );
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The precision knob for this rule. A JWT-shaped string is only reported when BOTH halves decode
 * to JSON, the header names a real algorithm, and the payload carries at least two registered
 * claims. `alg: "none"` is excluded because an unsigned token is a teaching example, not a
 * credential — it authenticates nothing.
 */
export function isRealLookingJsonWebToken(token) {
  const [headerSegment, payloadSegment] = token.split(".");
  const header = decodeSegment(headerSegment);
  const payload = decodeSegment(payloadSegment);
  if (!header || !payload) return false;
  const algorithm = typeof header.alg === "string" ? header.alg.toLowerCase() : "";
  if (algorithm === "" || algorithm === "none") return false;
  const claims = Object.keys(payload).filter((key) => TOKEN_CLAIMS.has(key));
  if (claims.length < 2) return false;
  // The vendor-documentation token everybody pastes. Its subject is 1234567890 and its holder is
  // John Doe; treating it as a credential is exactly the cry-wolf failure this gate must avoid.
  if (payload.sub === "1234567890" || payload.name === "John Doe") return false;
  return true;
}

export function findJsonWebToken(file, source) {
  const found = [];
  for (const match of source.matchAll(JSON_WEB_TOKEN)) {
    if (!isRealLookingJsonWebToken(match[0])) continue;
    found.push(
      finding(
        "json-web-token",
        file,
        source,
        match.index,
        match[0],
        "A signed token is a bearer credential for whatever issued it. Remove the literal, and " +
          "have the test mint its own token at run time from a throwaway signing key so nothing " +
          "long-lived is ever in the tree.",
      ),
    );
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * R10 — environment files must hold placeholders only.
 * ------------------------------------------------------------------------------------------- */

const ENVIRONMENT_ASSIGNMENT = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/;

/**
 * The repository tracks apps/api-worker/.dev.vars on purpose, because a committed file of
 * placeholders is what keeps a developer from inventing their own untracked one with a real value
 * in it. The rule that makes that safe is this one: in a file whose entire job is environment
 * assignments, EVERY value must announce itself as a placeholder. No path allowlist — the file
 * stays under the rule forever, so the day someone pastes a real value in, the gate says so.
 */
export function findEnvironmentSecrets(file, source) {
  if (!isEnvironmentFile(file)) return [];
  const found = [];
  const lines = source.split("\n");
  for (const [index, text] of lines.entries()) {
    if (/^[ \t]*(#|$)/.test(text)) continue;
    const match = ENVIRONMENT_ASSIGNMENT.exec(text);
    if (!match) continue;
    const [, name, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, "");
    if (value.length < 8) continue;
    if (isPlaceholder(value)) continue;
    found.push({
      rule: "environment-file-value",
      file,
      line: index + 1,
      evidence: `${name}=${fingerprint(value)}`,
      fix:
        `A tracked environment file may hold placeholders only. Either make ${name}'s value say so ` +
        "in the clear (the other values in this file read `…-placeholder-…`, and a base64 value " +
        "whose plaintext says it counts too), or remove the line and set the real value with " +
        "`wrangler secret put`.",
    });
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * R11 — a high-entropy literal assigned to a secret-shaped name.
 * ------------------------------------------------------------------------------------------- */

/*
 * The one heuristic rule, and the one that decides whether the whole gate survives contact with
 * this repository. It fires only when FOUR conditions hold at once:
 *
 *   1. The name is secret-shaped — it ends in key / secret / token / password / passphrase /
 *      credential, or is apiKey, after underscores are stripped and case is folded.
 *   2. The value is a QUOTED STRING LITERAL of at least 32 characters drawn from the base64 or hex
 *      alphabet. Not an identifier, not a call, not a template literal with a substitution.
 *   3. The value's Shannon entropy clears the threshold for its alphabet, and it mixes character
 *      classes. A 32-character run of one repeated token is not a key.
 *   4. It is not a placeholder, directly or one base64 layer down.
 *
 * NAMES DELIBERATELY EXCLUDED. `*_KEY` is the noisiest suffix in any codebase, and in this one it
 * is overwhelmingly a lookup key rather than a cryptographic one — a cache key, an idempotency
 * key, an R2 object key, a translation key, a sort key. Those are enumerated in NOT_A_CREDENTIAL
 * below rather than left to entropy, because an opaque server-minted identifier scores as high as
 * a key does and no threshold can separate them.
 *
 * WHAT THIS TRADES AWAY. A real 32-byte key pasted into a variable called `config` or `value` is
 * invisible here, and so is one that happens to sit inside an array rather than an assignment.
 * That is the price of not firing on the golden vectors, the frozen ciphertext envelopes and the
 * seeded identifiers this repository is full of, and it is the right side of the trade: those
 * fixtures are load-bearing and would have to be exempted one by one, and an exemption list is a
 * gate that has stopped reading.
 */

const NAME_SUFFIXES = ["key", "secret", "token", "password", "passphrase", "credential"];

/**
 * Names that end in a credential-shaped suffix but denote something else entirely. Each is a real
 * shape in this tree: opaque identifiers minted by the platform score exactly as high on entropy
 * as key material does, so they are separated by meaning here rather than by threshold.
 */
const NOT_A_CREDENTIAL = new Set([
  // The bare, unqualified container words. Every credential in this platform is NAMED for what it
  // is — AUTH_SECRET, ROOT_KEK, PLATFORM_ADMIN_KEY, R2_S3_SECRET_ACCESS_KEY, PANGRAM_API_KEY — while
  // a bare `key`/`token` is a lookup, a routing label or a digest (the one occurrence in this tree
  // is the truncated SHA-256 the editor mints to route a document to its container). A signed
  // bearer token assigned to a bare `token` is still caught, by the json-web-token rule, which
  // reads the value rather than the name. `secret`, `password`, `passphrase` and `credential` are
  // deliberately NOT excluded: unqualified, those words mean what they say.
  "key",
  "keys",
  "token",
  "tokens",
  "cachekey",
  "cachekeys",
  "idempotencykey",
  "objectkey",
  "storagekey",
  "sortkey",
  "partitionkey",
  "primarykey",
  "foreignkey",
  "translationkey",
  "routekey",
  "rowkey",
  "mapkey",
  "querykey",
  "querykeys",
  "storekey",
  "r2key",
  "versionkey",
  "fieldkey",
  "tokenkey",
  "csskey",
  "testkey",
  "indexkey",
  "blindindexkey",
  "aadkey",
  "publickey",
  "continuationtoken",
  "cursortoken",
  "pagetoken",
  "nexttoken",
  "designtoken",
  "designtokens",
  "colortoken",
  "spacingtoken",
  "csrftoken",
]);

export function isSecretShapedName(name) {
  const normalized = name.replaceAll("_", "").replaceAll("-", "").toLowerCase();
  if (NOT_A_CREDENTIAL.has(normalized)) return false;
  if (normalized === "apikey") return true;
  return NAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

const BASE64_ALPHABET = /^[A-Za-z0-9+/_-]+={0,2}$/;
const HEX_ALPHABET = /^[A-Fa-f0-9]+$/;

/** The value test: long enough, dense enough, and mixed enough to be key material. */
export function isCredentialShapedValue(value) {
  if (value.length < 32 || value.length > 512) return false;
  if (isPlaceholder(value)) return false;
  if (HEX_ALPHABET.test(value)) {
    // Hex has a 4-bit ceiling; a real 32+ hex-character key sits within a hair of it. The floor is
    // set high on purpose: a hex-looking value that is not near-uniform is a formatted identifier.
    if (!/[a-f]/i.test(value) || !/\d/.test(value)) return false;
    return shannonEntropy(value) >= 3.5;
  }
  if (!BASE64_ALPHABET.test(value)) return false;
  // Mixed classes: a run of one case with no digits is a slug, a hyphenated name or a word list.
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  if (!hasDigit || !(hasLower && hasUpper)) return false;
  return shannonEntropy(value) >= 4.2;
}

const SECRET_ASSIGNMENT =
  /(?:^|[^A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$-]{1,60})["']?\s*[:=]\s*["']([A-Za-z0-9+/=_-]{32,512})["']/g;

export function findHighEntropyAssignment(file, source) {
  const found = [];
  for (const match of source.matchAll(SECRET_ASSIGNMENT)) {
    const [, name, value] = match;
    if (!isSecretShapedName(name)) continue;
    if (!isCredentialShapedValue(value)) continue;
    found.push(
      finding(
        "high-entropy-assignment",
        file,
        source,
        match.index,
        value,
        `\`${name}\` is a credential-shaped name holding a high-entropy literal. If it IS a ` +
          "credential: rotate it and read it from a Worker secret. If it is NOT — a golden vector, " +
          "a seeded identifier, a frozen envelope — rename it so it does not read as a credential, " +
          "or add the name to NOT_A_CREDENTIAL in tooling/lint-secrets/rules.mjs with the reason.",
      ),
    );
  }
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * The rule table.
 * ------------------------------------------------------------------------------------------- */

export const RULES = [
  findPrivateKeyMaterial,
  findAwsAccessKeyId,
  findAwsSecretAccessKey,
  findGithubToken,
  findCloudflareCredential,
  findStripeKey,
  findSlackCredential,
  findGoogleApiKey,
  findJsonWebToken,
  findEnvironmentSecrets,
  findHighEntropyAssignment,
];

export function scan(file, source) {
  const found = [];
  for (const rule of RULES) found.push(...rule(file, source));
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * Self-test samples.
 * ------------------------------------------------------------------------------------------- */

/*
 * Every positive sample is assembled from fragments at run time, so no sample's matching text ever
 * appears as a literal in this file. That is what lets the scan walk its own source without
 * finding itself — see SELF-SCANNING at the top — and it is checked by the negative sample
 * "this file's own rule table", which runs the whole scan over this module's source.
 */
const join = (...parts) => parts.join("");

const SYNTHETIC_JSON_WEB_TOKEN = (() => {
  const encode = (object) =>
    Buffer.from(JSON.stringify(object)).toString("base64url").replace(/=+$/, "");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ iss: "magna-carta-self-test", sub: "synthetic-subject", exp: 4102444800 }),
    "c3ludGhldGljLXNpZ25hdHVyZS1ub3QtYS1yZWFsLW9uZQ",
  ].join(".");
})();

const UNSIGNED_JSON_WEB_TOKEN = (() => {
  const encode = (object) =>
    Buffer.from(JSON.stringify(object)).toString("base64url").replace(/=+$/, "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ iss: "a", sub: "b", exp: 1 })}.`;
})();

/**
 * Positive and negative samples, each with the file path it is judged under (R10 reads the path).
 * `rule` is the rule a positive sample must produce; a negative sample expects nothing at all.
 */
export const SELF_TEST = [
  {
    label: "a PEM private-key header",
    file: "apps/api-worker/src/keys.ts",
    source: join("const pem = `", "-".repeat(5), "BEGIN RSA PRIVATE KEY", "-".repeat(5), "`;"),
    rule: "private-key",
  },
  {
    label: "an OpenSSH private key header",
    file: "tools/deploy.sh",
    source: join("-".repeat(5), "BEGIN OPENSSH PRIVATE KEY", "-".repeat(5)),
    rule: "private-key",
  },
  {
    label: "a public key header is not a finding",
    file: "apps/api-worker/src/keys.ts",
    source: join("-".repeat(5), "BEGIN PUBLIC KEY", "-".repeat(5)),
    rule: null,
  },
  {
    label: "an access key id",
    file: "apps/api-worker/src/storage.ts",
    source: join('const id = "', "AKIA", "3ZZQ7YB4TN5RJ2WK", '";'),
    rule: "aws-access-key-id",
  },
  {
    label: "the vendor's documentation access key id is not a finding",
    file: "docs/conventions/security.md",
    source: join("AKIA", "IOSFODNN7EXAMPLE"),
    rule: null,
  },
  {
    label: "a secret access key assigned to its own name",
    file: "apps/api-worker/src/storage.ts",
    source: join(
      'R2_S3_SECRET_ACCESS_KEY = "',
      "wJ7bQx",
      "MSyXhTnFEMI",
      "K7MDENGbPxRfiCY",
      "aZ4pQ7tR",
      '"',
    ),
    rule: "aws-secret-access-key",
  },
  {
    label: "the tracked placeholder secret access key is not a finding",
    file: "apps/api-worker/.dev.vars",
    source:
      "R2_S3_SECRET_ACCESS_KEY=magna-carta-local-development-placeholder-r2-secret-access-key",
    rule: null,
  },
  {
    label: "a classic personal access token",
    file: "tooling/release.mjs",
    source: join('token: "', "ghp_", "0Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx", '"'),
    rule: "github-token",
  },
  {
    label: "a fine-grained personal access token",
    file: "tooling/release.mjs",
    source: join("github", "_pat_", "11ABCDEFG0aBcDeFgHiJkL", "_", "9".repeat(59)),
    rule: "github-token",
  },
  {
    label: "a named Cloudflare token",
    file: "tooling/deploy.mjs",
    source: join('CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER = "', "Qz7", "-", "b".repeat(36), '"'),
    rule: "cloudflare-api-token",
  },
  {
    label: "the Cloudflare token name alone, with no value, is not a finding",
    file: "apps/api-worker/wrangler.jsonc",
    source: '"secrets": { "required": ["CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER"] }',
    rule: null,
  },
  {
    label: "a live secret key",
    file: "packages/payments/src/client.ts",
    source: join('const key = "', "sk", "_live_", "51QzAbCdEfGhIjKlMnOpQr", '";'),
    rule: "stripe-secret-key",
  },
  {
    label: "a publishable key is not a finding",
    file: "apps/web/src/lib/payments.ts",
    source: join('const key = "', "pk", "_live_", "51QzAbCdEfGhIjKlMnOpQr", '";'),
    rule: null,
  },
  {
    label: "an origin certificate authority key",
    file: "tooling/deploy.mjs",
    source: join("v1", ".", "0-", "A".repeat(24), "-", "9zK".repeat(47)),
    rule: "cloudflare-origin-ca-key",
  },
  {
    label: "an incoming webhook address",
    file: "tooling/notify.mjs",
    source: join(
      "https://hooks.",
      "slack.com/services/T",
      "0A1B2C3D4/B",
      "5E6F7G8H9/",
      "q".repeat(24),
    ),
    rule: "slack-webhook",
  },
  {
    label: "a bot token",
    file: "tooling/notify.mjs",
    source: join("xox", "b-", "111111111111-222222222222-", "AbCdEfGhIjKlMnOpQrStUvWx"),
    rule: "slack-token",
  },
  {
    label: "an application programming interface key",
    file: "apps/web/src/lib/maps.ts",
    source: join('"', "AIza", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q", '"'),
    rule: "google-api-key",
  },
  {
    label: "a signed token with registered claims",
    file: "apps/api-worker/test/support/tokens.ts",
    source: `const token = "${SYNTHETIC_JSON_WEB_TOKEN}";`,
    rule: "json-web-token",
  },
  {
    label: "an unsigned token is a teaching example, not a credential",
    file: "docs/conventions/api.md",
    source: UNSIGNED_JSON_WEB_TOKEN,
    rule: null,
  },
  {
    label: "a real value in an environment file",
    file: "apps/api-worker/.dev.vars",
    source: join("AUTH_SECRET=", "Jq4", "vR9tLm2XbN7wKd1ZsY6hG3pC8aE5uT0i"),
    rule: "environment-file-value",
  },
  {
    label: "the tracked root key-encryption key placeholder, base64 over readable text",
    file: "apps/api-worker/.dev.vars",
    source: `ROOT_KEK=${Buffer.from("magna-carta-local-dev-root-kek!!").toString("base64")}`,
    rule: null,
  },
  {
    label: "a real value in a `<name>.env` sibling, which is an environment file too",
    file: "apps/web/production.env",
    source: join("SESSION_SIGNING_SECRET=", "Jq4", "vR9tLm2XbN7wKd1ZsY6hG3pC8aE5uT0i"),
    rule: "environment-file-value",
  },
  {
    label: "an empty value in an environment file",
    file: "apps/api-worker/.dev.vars",
    source: "PANGRAM_API_KEY=",
    rule: null,
  },
  {
    label: "a high-entropy literal on a credential-shaped name",
    file: "packages/integrations/src/client.ts",
    source: join('const apiKey = "', "7Kq", "Zt2Vm9Xr4Bn1Wp6Ld3Hs8Yc5Fj0Ga", '";'),
    rule: "high-entropy-assignment",
  },
  {
    label: "a truncated digest on a bare container name is not a finding",
    file: "apps/edit-worker/test/document-routing.test.ts",
    source: join('const KEY = "', "9f2c4a1e0b7d83562fae19cc470db28e6153af90724ec8bd31056e7a", '";'),
    rule: null,
  },
  {
    label: "the same value on a NAMED credential is still a finding",
    file: "apps/edit-worker/src/config.ts",
    source: join(
      'const ADMIN_API_KEY = "',
      "9f2c4a1e0b7d83562fae19cc470db28e6153af90724ec8bd31056e7a",
      '";',
    ),
    rule: "high-entropy-assignment",
  },
  {
    label: "an opaque identifier on a lookup-key name is not a finding",
    file: "packages/data-access/src/cache.ts",
    source: join('const cacheKey = "', "7Kq", "Zt2Vm9Xr4Bn1Wp6Ld3Hs8Yc5Fj0Ga", '";'),
    rule: null,
  },
  {
    label: "a hyphenated slug on a credential-shaped name is not a finding",
    file: "packages/integrations/src/client.ts",
    source: 'const apiKey = "magna-carta-local-development-placeholder-value";',
    rule: null,
  },
  {
    label: "a repeated run is not key material",
    file: "packages/database/test/seed.ts",
    source: `const apiToken = "${"Ab1".repeat(12)}";`,
    rule: null,
  },
  {
    label: "a lowercase identifier with no digits is not key material",
    file: "packages/identifiers/test/identifiers.test.ts",
    source: 'const sessionToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
    rule: null,
  },
];
