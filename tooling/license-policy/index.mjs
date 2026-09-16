// THE dependency-license policy: the allowlist of permitted SPDX identifiers and the expression
// classifier that reads a license string against it. This module is the single home of that policy,
// and it is deliberately not owned by either gate that applies it — the platform is proprietary SaaS,
// so AGPL/SSPL (network copyleft, which treats network interaction as distribution and would force a
// source offer) must be denied identically in every supply chain the firm ships, and a policy copied
// per ecosystem drifts into two different answers to "is this license allowed".
//
// Applied by two gates, both deny-by-default, both running on the firm's own compute with no
// third-party license tool or SaaS in the path:
//   npm/pnpm   tooling/lint-licenses.mjs        `pnpm run lint:licenses`
//   Cargo      tooling/license-policy/cargo.mjs `pnpm run lint:cargo-licenses`
//
// HOW AN EXPRESSION IS READ (as-used, never as-published):
//   "MIT OR GPL-2.0"        passes  — a permissive disjunct exists and we take it
//   "MIT AND GPL-3.0"       fails   — every operand of AND binds us
//   "(MIT OR GPL-3.0) AND AGPL-3.0" fails — parentheses bind, so the AGPL conjunct still binds
//   "Apache-2.0 WITH LLVM-exception" passes — an exception only ADDS permissions, so the verdict is
//                                    the base license's; a non-permissive base stays denied
//   "MIT/Apache-2.0"        passes  — the legacy slash form predates SPDX expressions and means OR
//                                    (Cargo emitted it for years; crates in this tree still carry it)
//   "UNLICENSED" / missing / unparseable  fails — no verdict is possible, so a human gives one
// Operators are recognised only in upper case, as the SPDX grammar requires, so the lower-case "or"
// inside an identifier ("LGPL-3.0-or-later") is never mistaken for one. Identifiers are matched
// case-insensitively, which the SPDX grammar also requires.
//
// Adding an identifier to the allowlist below is a deliberate policy act, not a way to clear a gate.

// Default for the per-gate reviewed-exception map, so a caller that has none passes nothing.
const EMPTY_EXCEPTIONS = new Map();

// Allowed SPDX identifiers: permissive licenses plus WEAK copyleft (MPL-2.0 file-level, LGPL
// library-level) — weak copyleft is SaaS-compatible (use in proprietary software is permitted) and is
// materially different from the AGPL/SSPL network copyleft this policy exists to deny. Keep this list
// tight.
export const ALLOWED_LICENSE_IDENTIFIERS = new Set([
  "MIT",
  // MIT with the attribution requirement dropped; strictly more permissive than MIT.
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Zlib",
  // Zlib plus a request (not a requirement) to acknowledge the author; carried by a search dependency.
  "zlib-acknowledgement",
  "Python-2.0",
  // Boost Software License — permissive, and explicitly waives the attribution requirement for
  // binary distribution, so it imposes nothing on a shipped service.
  "BSL-1.0",
  // University of Illinois/NCSA — MIT plus BSD-style clauses, permissive on both halves.
  "NCSA",
  // Unicode License v3 — the license the Unicode Consortium's data tables ship under, carried by the
  // whole icu_* family in the Rust tree. Permits use, modification and redistribution, including in
  // proprietary software; the only condition is preserving the notice.
  "Unicode-3.0",
  // Community Data License Agreement, Permissive 2.0 — a DATA license (it reaches this tree through
  // the bundled root-certificate stores, which are data, not code). It permits redistribution of the
  // data and of anything built from it with attribution only, and explicitly imposes nothing on the
  // software that uses it.
  "CDLA-Permissive-2.0",
  // SIL Open Font License 1.1 — the permissive open-font license the bundled UI webfonts declare
  // (@fontsource-variable/atkinson-hyperlegible-next, @fontsource-variable/fraunces,
  // @fontsource/unifrakturmaguntia). OFL explicitly permits embedding + redistribution inside
  // software; its only restriction is selling the font files on their own, which does not affect
  // bundling a webfont into the app. A font license, not a general-purpose code license — but the
  // policy classifies by SPDX identifier and OFL-only packages here are all fonts.
  "OFL-1.1",
]);

// Non-SPDX license strings some older packages emit, mapped to their SPDX equivalent. Matched after
// case-folding, so only the shape has to be listed, not every casing of it.
const ALIASES = new Map([
  ["bsd", "BSD-3-Clause"],
  ["mit*", "MIT"],
  ["apache 2.0", "Apache-2.0"],
  ["apache license 2.0", "Apache-2.0"],
  ["apache2", "Apache-2.0"],
]);

const OPERATORS = new Set(["AND", "OR", "WITH"]);

// Tokenize an SPDX expression. `/` is emitted as OR: it is the legacy dual-license separator from
// before SPDX expressions existed ("MIT/Apache-2.0"), and no SPDX identifier contains a slash, so the
// reading is unambiguous. Operator words are recognised in upper case only — the SPDX grammar says
// so, and it is what keeps "LGPL-3.0-or-later" a single identifier rather than three tokens.
function tokenize(expression) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push({ type: character });
      index += 1;
      continue;
    }
    if (character === "/") {
      tokens.push({ type: "OR" });
      index += 1;
      continue;
    }
    let end = index;
    while (end < expression.length && !/[\s()/]/.test(expression[end])) end += 1;
    const word = expression.slice(index, end);
    index = end;
    tokens.push(OPERATORS.has(word) ? { type: word } : { type: "identifier", value: word });
  }
  return tokens;
}

// Is one identifier on the allowlist? A trailing "+" ("LGPL-2.1+") means "this version or later"; the
// base version is the strictest reading of that, so it is the one checked.
function identifierPermissive(identifier) {
  const bare = identifier.endsWith("+") ? identifier.slice(0, -1) : identifier;
  const folded = bare.toLowerCase();
  const resolved = ALIASES.get(folded) ?? bare;
  const resolvedFolded = resolved.toLowerCase();
  for (const allowed of ALLOWED_LICENSE_IDENTIFIERS) {
    if (allowed.toLowerCase() === resolvedFolded) return true;
  }
  return false;
}

// Recursive-descent parse of the SPDX grammar's precedence: OR binds loosest, then AND, then WITH,
// with parentheses overriding both. Parenthesised sub-expressions are evaluated in place rather than
// stripped — stripping them silently re-associates "(MIT OR GPL-3.0) AND AGPL-3.0" into a pass.
// Throws on anything it cannot parse; the caller turns that into a denial.
function parseExpression(tokens, state) {
  let value = parseConjunction(tokens, state);
  while (tokens[state.index]?.type === "OR") {
    state.index += 1;
    const right = parseConjunction(tokens, state);
    value = value || right;
  }
  return value;
}

function parseConjunction(tokens, state) {
  let value = parseWithClause(tokens, state);
  while (tokens[state.index]?.type === "AND") {
    state.index += 1;
    const right = parseWithClause(tokens, state);
    value = value && right;
  }
  return value;
}

function parseWithClause(tokens, state) {
  const value = parsePrimary(tokens, state);
  if (tokens[state.index]?.type === "WITH") {
    state.index += 1;
    const exception = tokens[state.index];
    if (exception?.type !== "identifier") throw new Error("WITH is not followed by an exception");
    state.index += 1;
    // The exception identifier itself is not consulted: an SPDX exception only grants permissions
    // beyond the base license, so it can never make a permitted license forbidden, and treating it as
    // able to rescue a forbidden one would be the unsafe direction.
  }
  return value;
}

function parsePrimary(tokens, state) {
  const token = tokens[state.index];
  if (!token) throw new Error("expression ended early");
  if (token.type === "(") {
    state.index += 1;
    const value = parseExpression(tokens, state);
    if (tokens[state.index]?.type !== ")") throw new Error("unbalanced parenthesis");
    state.index += 1;
    return value;
  }
  if (token.type !== "identifier") throw new Error(`unexpected token: ${token.type}`);
  state.index += 1;
  return identifierPermissive(token.value);
}

// Evaluate a whole license expression. Returns false rather than throwing for anything malformed —
// an expression this policy cannot read is an expression it must not permit.
export function expressionPermissive(expression) {
  const tokens = tokenize(expression);
  if (tokens.length === 0) return false;
  const state = { index: 0 };
  try {
    const value = parseExpression(tokens, state);
    if (state.index !== tokens.length) return false;
    return value;
  } catch {
    return false;
  }
}

// Pure classifier, shared by both gates. `exceptions` is a Map of "name@version" => reason, owned by
// the calling gate: a reviewed exception is a statement about one package in one ecosystem, not about
// the policy, and the two ecosystems have separate name spaces.
// Returns { allowed: boolean, reason: string }.
export function classifyLicense(name, version, license, exceptions = EMPTY_EXCEPTIONS) {
  const key = `${name}@${version}`;
  if (exceptions.has(key)) {
    return { allowed: true, reason: `reviewed exception: ${exceptions.get(key)}` };
  }
  // Both gates print the license beside the name, so a reason never repeats it.
  if (!license || license === "UNLICENSED" || /^unknown$/i.test(license)) {
    return { allowed: false, reason: "no resolvable license; review required" };
  }
  return expressionPermissive(license)
    ? { allowed: true, reason: license }
    : { allowed: false, reason: "not on the permissive allowlist" };
}

// Every gate runs this before it scans, so a logic regression fails loudly rather than silently
// mis-permitting a dependency. It covers the operators, the precedence, the legacy forms, and the
// denials the policy exists for; the same cases are asserted again in index.test.mjs, which is where
// a new case is added when the policy grows.
export function runLicensePolicySelfTest() {
  const expect = (condition, label) => {
    if (!condition) throw new Error(`license-policy self-test failed: ${label}`);
  };
  const allowed = (license) => classifyLicense("package", "1", license).allowed;

  expect(allowed("MIT"), "MIT allowed");
  expect(allowed("Apache-2.0"), "Apache-2.0 allowed");
  expect(!allowed("AGPL-3.0"), "AGPL denied");
  expect(!allowed("AGPL-3.0-or-later"), "AGPL-or-later denied");
  expect(!allowed("SSPL-1.0"), "SSPL denied");
  expect(allowed("(MIT OR GPL-2.0)"), "OR with permissive disjunct allowed");
  expect(allowed("(Apache-2.0 AND MIT)"), "AND all-permissive allowed");
  expect(allowed("Apache-2.0 AND LGPL-3.0-or-later"), "weak-copyleft LGPL allowed");
  expect(!allowed("(MIT AND GPL-3.0)"), "AND with strong copyleft denied");
  // Precedence: AND binds tighter than OR, and parentheses override that. Both readings are asserted
  // because stripping parentheses gets the second one wrong in the permitting direction.
  expect(allowed("MIT OR GPL-3.0 AND AGPL-3.0"), "AND binds tighter than OR");
  expect(!allowed("(MIT OR GPL-3.0) AND AGPL-3.0"), "parenthesised OR still bound by an AGPL AND");
  expect(allowed("(MIT OR Apache-2.0) AND Unicode-3.0"), "parenthesised OR with permissive AND");
  expect(allowed("Apache-2.0 WITH LLVM-exception"), "WITH keeps the base license's verdict");
  expect(!allowed("GPL-2.0 WITH Classpath-exception-2.0"), "WITH cannot rescue a denied base");
  expect(allowed("MIT/Apache-2.0"), "legacy slash form reads as OR");
  expect(allowed("Apache-2.0 / MIT / MPL-2.0"), "spaced legacy slash form reads as OR");
  expect(!allowed("AGPL-3.0/SSPL-1.0"), "legacy slash form denies when every operand is denied");
  expect(allowed("mit"), "identifiers are case-insensitive");
  expect(
    !allowed("LGPL-3.0-or-later AND AGPL-3.0"),
    "lower-case 'or' inside an identifier is not an operator",
  );
  expect(allowed("LGPL-2.1+"), "trailing + reads as the base version");
  expect(!allowed("UNLICENSED"), "UNLICENSED denied");
  expect(!allowed("unknown"), "unknown denied");
  expect(!allowed(""), "empty license denied");
  expect(!allowed(null), "missing license denied");
  expect(!allowed("Frobnicate-1.0"), "unlisted identifier denied");
  expect(!allowed("(MIT OR Apache-2.0"), "unbalanced parenthesis denied");
  expect(!allowed("MIT AND"), "dangling operator denied");
  expect(allowed("BSD"), "BSD alias allowed");
  expect(allowed("OFL-1.1"), "OFL-1.1 font license allowed");
  expect(
    !allowed("Limited W3 License"),
    "apca-w3's field-restricted 'Limited W3 License' stays denied (not the permissive W3C license)",
  );
  expect(
    classifyLicense("rescued", "1.0.0", "AGPL-3.0", new Map([["rescued@1.0.0", "reviewed"]]))
      .allowed,
    "a reviewed exception is honoured",
  );
}
