# WHOIS Lookup + Safe Website Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two firm-internal security-hygiene tools to the Tools area — a WHOIS/RDAP domain+IP lookup, and a Safe Website Viewer that renders a suspect URL in Cloudflare's isolated browser and returns a static snapshot + redirect/header probe so no hostile code runs in the user's browser.

**Architecture:** Two worker-consumed logic packages (`@magna-carta/whois`, `@magna-carta/safe-browse`) sit below two Worker routes that go through the existing OpenAPI/zod chokepoint, gated by two new `tools:*` permissions. Both tools validate the user-supplied target through one shared SSRF guard (added to `@magna-carta/integrations`). The pure catalog package (`@magna-carta/tools`) gains a `web-domains` subject group, a `website` context tag, and two manifest rows. All outbound effects (RDAP fetch, port-43 socket, redirect probe, browser render) are injected interfaces so the logic packages stay pure and unit-testable; the Worker provides the real implementations.

**Tech Stack:** TypeScript, Cloudflare Workers + Hono + `@hono/zod-openapi`, Cloudflare Browser Rendering (`env.BROWSER.quickAction`), `cloudflare:sockets` (`connect()` for the port-43 fallback), RDAP over `fetch`, Vitest (unit + Miniflare integration), `vp`/`pnpm` tooling.

## Global Constraints

- **All business/data access through the firm-scoped data-access layer; no cross-firm queries.** (These tools query _public_ registries and render _external_ sites — they touch no firm data — but the routes still resolve through the chokepoint firm context for auth/permission.)
- **Standardized error & redaction:** report every error through the in-house pipeline; **never log the investigated URL/host or fetched content**; correlate by ID; surface a user-facing Error ID. No third-party error SaaS.
- **No raw SQL across firms; bulk content to R2, never D1** (only the permission-seed migration touches the DB here).
- **Full names, no shorthand** (golden rule 12). Exceptions in play: `URL`, `JSON`, `IP`, `WHOIS`, `RDAP`, `TLD`, `DNS`, `HTTP`, `SSRF` are recognized external/universal terms and are allowed.
- **No process-doc references in source/tests** (golden rule 13): no ADR-NNNN, no "slice N", no spec citations in code or test strings. Forward-looking "built later / future enhancement" wording is the only allowed schedule reference.
- **Latest library APIs only** (golden rule 11): `env.BROWSER.quickAction` requires Worker `compatibility_date >= 2026-03-24`; verify the `cloudflare:sockets` `connect()` signature against current docs at implementation time.
- **Docs same commit** (golden rule 5): the docs task is part of the feature, not optional.
- Test runner: `vp test` (Vitest single-run, includes Miniflare worker integration). Quality gate: `pnpm check`.
- Commit after every task. Branch: `tools-whois-safe-browse` (already created).

---

## File Structure

**`@magna-carta/access-control`** (modify)

- `packages/access-control/src/registry.ts` — add `tools:whois`, `tools:safeBrowse` to `PERMISSIONS`.

**`@magna-carta/tools`** (modify)

- `packages/tools/src/types.ts` — add `"web-domains"` to `SUBJECT_GROUP_ORDER`; add `"website"` to `ContextTag`.
- `packages/tools/src/catalog.ts` — add the two manifest rows.

**`@magna-carta/integrations`** (modify — shared SSRF guard, lives with the http transport seam)

- `packages/integrations/src/safe-target.ts` — new: `classifyHost`, `assertPublicTarget`, types.
- `packages/integrations/package.json` — add `"./safe-target"` export.

**`@magna-carta/whois`** (new package)

- `packages/whois/package.json`, `tsconfig.json`, `vitest.config.ts`, `CLAUDE.md`
- `packages/whois/src/types.ts` — `RegistrationResult`, `RdapBootstrap`, `WhoisSocket`, `WhoisDeps`.
- `packages/whois/src/rdap.ts` — bootstrap resolution + query + parse (injected `HttpClient`).
- `packages/whois/src/legacy.ts` — port-43 fallback (injected `WhoisSocket`).
- `packages/whois/src/lookup.ts` — `lookupRegistration()` orchestrator (guard → rdap → legacy).
- `packages/whois/src/index.ts` — re-exports.
- `packages/whois/test/{rdap,legacy,lookup}.test.ts`

**`@magna-carta/safe-browse`** (new package)

- `packages/safe-browse/package.json`, `tsconfig.json`, `vitest.config.ts`, `CLAUDE.md`
- `packages/safe-browse/src/types.ts` — `SafeView`, `RedirectHop`, `BrowserRenderer`, `RedirectProbe`, `SafeBrowseDeps`.
- `packages/safe-browse/src/probe.ts` — `probeRedirects()` shape over an injected fetch (guarded each hop).
- `packages/safe-browse/src/capture.ts` — `captureSafeView()` orchestrator (guard → probe + render).
- `packages/safe-browse/src/index.ts` — re-exports.
- `packages/safe-browse/test/{probe,capture}.test.ts`

**`apps/worker`** (modify)

- `apps/worker/src/routes/tools/whois.ts` — new route + meta + zod schemas + worker adapters.
- `apps/worker/src/routes/tools/safe-browse.ts` — new route + meta + zod schemas + worker adapters.
- `apps/worker/src/app.ts` — register both routes; add `BROWSER` to `Bindings`.
- `apps/worker/wrangler.*` — add the `browser` binding; bump `compatibility_date` if needed.
- `apps/worker/test/*` — Miniflare integration tests for both routes.
- A new permission-seed migration under the worker's migrations dir.

**Docs**

- White paper feature-map entry; `docs/user/whois-lookup.md`, `docs/user/safe-website-viewer.md`; `ROADMAP.md`; `changelog.d/<slug>.md`; `docs/decisions/pending/*.md` (4 ADR fragments); area `CLAUDE.md` files (in the two new packages).

**Gated on the 0·7a design-system shell (NOT buildable now — Phase G):**

- `apps/web` shell: `id → Svelte component` map entries + `WhoisLookup.svelte`, `SafeWebsiteViewer.svelte` widgets.

---

## Phase A — Catalog plumbing (buildable now)

### Task 1: Register the two tool permissions

**Files:**

- Modify: `packages/access-control/src/registry.ts` (the `PERMISSIONS` array, the `tools:` block ~lines 40-46)
- Test: `packages/access-control/test/registry.test.ts` (add cases; create if the file's pattern differs — check existing tests first)

**Interfaces:**

- Produces: permission strings `"tools:whois"` and `"tools:safeBrowse"`, now accepted by `isPermission`/`assertPermission`.

- [ ] **Step 1: Write the failing test** — add to the registry test file:

```ts
import { isPermission } from "../src/registry.ts";

test("web-domains tool permissions are registered", () => {
  expect(isPermission("tools:whois")).toBe(true);
  expect(isPermission("tools:safeBrowse")).toBe(true);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: FAIL — `isPermission("tools:whois")` returns `false`.

- [ ] **Step 3: Add the permissions** — in `registry.ts`, inside the Tools block after `"tools:firmUsage"`:

```ts
  "tools:whois", // WHOIS/RDAP registration lookup for a website's domain or an IP
  "tools:safeBrowse", // render a suspect URL in an isolated remote browser (static snapshot only)
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/access-control
git commit -m "feat(access-control): register tools:whois and tools:safeBrowse permissions"
```

### Task 2: Add the subject group, context tag, and two catalog rows

**Files:**

- Modify: `packages/tools/src/types.ts` (`SUBJECT_GROUP_ORDER`, `ContextTag`)
- Modify: `packages/tools/src/catalog.ts` (`CATALOG`)
- Test: `packages/tools/test/catalog.test.ts`, `packages/tools/test/select.test.ts` (extend existing)

**Interfaces:**

- Consumes: `tools:whois`, `tools:safeBrowse` from Task 1.
- Produces: catalog rows `whois-lookup`, `safe-website-viewer` under group `web-domains`, context tag `website`.

- [ ] **Step 1: Write the failing test** — add to `packages/tools/test/select.test.ts`:

```ts
import { toolsByGroup, toolsFor } from "../src/select.ts";
import { assertPermission } from "@magna-carta/access-control/registry";

const allPermissions = [assertPermission("tools:whois"), assertPermission("tools:safeBrowse")];

test("web-domains group surfaces both website tools in order", () => {
  const groups = toolsByGroup(allPermissions);
  const webDomains = groups.find((g) => g.group === "web-domains");
  expect(webDomains?.tools.map((t) => t.id)).toEqual(["whois-lookup", "safe-website-viewer"]);
});

test("toolsFor('website') returns both website tools", () => {
  const ids = toolsFor("website", allPermissions).map((t) => t.id);
  expect(ids).toEqual(["whois-lookup", "safe-website-viewer"]);
});
```

> Note: check the exact `toolsByGroup`/`toolsFor` signatures in `packages/tools/src/select.ts` before finalizing the test (the grouped return shape may be `{ subjectGroup, tools }` rather than `{ group, tools }`); match the existing shape.

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @magna-carta/tools test`
Expected: FAIL — `web-domains` group absent / `toolsFor("website")` empty / `"website"` not assignable to `ContextTag`.

- [ ] **Step 3: Extend the types** — in `packages/tools/src/types.ts`:

```ts
export const SUBJECT_GROUP_ORDER = [
  "property",
  "business-entities",
  "people-licenses",
  "mailing-shipping",
  "printing",
  "web-domains", // website/domain subjects — WHOIS lookup, safe website viewer
  "diagnostics", // connectivity / system tests — no legal subject (e.g. a network speed test)
] as const;
```

```ts
export type ContextTag = "address" | "person" | "company" | "matter" | "website" | "none";
```

- [ ] **Step 4: Add the catalog rows** — in `packages/tools/src/catalog.ts`, append to `CATALOG` (after `firm-usage`):

```ts
  {
    id: "whois-lookup",
    name: "WHOIS Lookup",
    icon: "globe",
    subjectGroup: "web-domains",
    permission: assertPermission("tools:whois"),
    contextTags: ["website"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "safe-website-viewer",
    name: "Safe Website Viewer",
    icon: "shield",
    subjectGroup: "web-domains",
    permission: assertPermission("tools:safeBrowse"),
    contextTags: ["website"],
    backing: { kind: "library" },
    matterContext: "none",
  },
```

- [ ] **Step 5: Run tests + purity gate**

Run: `pnpm --filter @magna-carta/tools test`
Expected: PASS — new tests pass AND `test/purity.test.ts` still passes (no new imports below the catalog).

- [ ] **Step 6: Commit**

```bash
git add packages/tools
git commit -m "feat(tools): add web-domains group, website context tag, WHOIS + safe-viewer rows"
```

---

## Phase B — Shared SSRF guard (buildable now)

### Task 3: SSRF guard in `@magna-carta/integrations`

**Files:**

- Create: `packages/integrations/src/safe-target.ts`
- Modify: `packages/integrations/package.json` (add `"./safe-target": "./src/safe-target.ts"` to `exports`)
- Test: `packages/integrations/test/safe-target.test.ts`

**Interfaces:**

- Produces:
  - `type TargetClass = "public" | "loopback" | "private" | "link-local" | "reserved" | "invalid-scheme" | "invalid-host";`
  - `classifyHost(host: string): TargetClass` — classifies a hostname **or** literal IP. Hostnames that are not literal IPs return `"public"` (structural check only; the resolved-IP check is the caller's, see below).
  - `interface ParsedTarget { readonly url: URL; readonly host: string; }`
  - `assertPublicTarget(input: string, resolve?: (host: string) => Promise<readonly string[]>): Promise<ParsedTarget>` — parses `input` as a URL (or bare host upgraded to `https://`), rejects non-`http(s)` schemes, classifies the literal host, and — if a `resolve` resolver is supplied and the host is a name — classifies every resolved IP. Throws `SsrfRejection` (with a `class: TargetClass`) on any non-public classification.
  - `class SsrfRejection extends Error { readonly targetClass: TargetClass }`

- [ ] **Step 1: Write the failing tests**

```ts
import { classifyHost, assertPublicTarget, SsrfRejection } from "../src/safe-target.ts";

test("classifies private and loopback IP literals", () => {
  expect(classifyHost("127.0.0.1")).toBe("loopback");
  expect(classifyHost("10.0.0.5")).toBe("private");
  expect(classifyHost("192.168.1.1")).toBe("private");
  expect(classifyHost("172.16.0.1")).toBe("private");
  expect(classifyHost("169.254.169.254")).toBe("link-local");
  expect(classifyHost("::1")).toBe("loopback");
  expect(classifyHost("fc00::1")).toBe("private"); // IPv6 unique-local
  expect(classifyHost("8.8.8.8")).toBe("public");
  expect(classifyHost("example.com")).toBe("public");
});

test("assertPublicTarget rejects non-http schemes", async () => {
  await expect(assertPublicTarget("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfRejection);
  await expect(assertPublicTarget("ftp://example.com")).rejects.toBeInstanceOf(SsrfRejection);
});

test("assertPublicTarget rejects a literal private IP URL", async () => {
  await expect(assertPublicTarget("http://169.254.169.254/latest/meta-data")).rejects.toMatchObject(
    {
      targetClass: "link-local",
    },
  );
});

test("assertPublicTarget upgrades a bare host and accepts a public name", async () => {
  const parsed = await assertPublicTarget("example.com");
  expect(parsed.url.protocol).toBe("https:");
  expect(parsed.host).toBe("example.com");
});

test("assertPublicTarget rejects when the resolver returns a private IP (DNS-rebinding defense)", async () => {
  const resolve = async () => ["10.1.2.3"];
  await expect(assertPublicTarget("https://evil.example", resolve)).rejects.toMatchObject({
    targetClass: "private",
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @magna-carta/integrations test safe-target`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `safe-target.ts`**

```ts
// Guards user-supplied targets before any outbound fetch originating inside Cloudflare. A request
// handler must never be tricked into reaching internal/cloud-metadata addresses, so we reject every
// non-public target. The resolved-IP check (optional resolver) closes the DNS-rebinding gap; the
// literal-IP and scheme checks are always applied. Kept dependency-free so it is trivially testable.

export type TargetClass =
  | "public"
  | "loopback"
  | "private"
  | "link-local"
  | "reserved"
  | "invalid-scheme"
  | "invalid-host";

export interface ParsedTarget {
  readonly url: URL;
  readonly host: string;
}

export class SsrfRejection extends Error {
  readonly targetClass: TargetClass;
  constructor(targetClass: TargetClass, message: string) {
    super(message);
    this.name = "SsrfRejection";
    this.targetClass = targetClass;
  }
}

function classifyIpv4(parts: readonly number[]): TargetClass {
  const [a, b] = parts;
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local";
  if (a === 0 || a >= 224) return "reserved"; // 0.x, multicast, future-use
  if (a === 100 && b >= 64 && b <= 127) return "reserved"; // carrier-grade NAT
  return "public";
}

function parseIpv4(host: string): readonly number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1, 5).map((p) => Number(p));
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

export function classifyHost(host: string): TargetClass {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (lower === "localhost" || lower.endsWith(".localhost")) return "loopback";

  const v4 = parseIpv4(lower);
  if (v4) return classifyIpv4(v4);

  if (lower.includes(":")) {
    // IPv6 literal
    if (lower === "::1") return "loopback";
    if (lower === "::") return "reserved";
    if (lower.startsWith("fe80")) return "link-local";
    if (lower.startsWith("fc") || lower.startsWith("fd")) return "private"; // unique-local fc00::/7
    if (lower.startsWith("::ffff:")) {
      const mapped = parseIpv4(lower.slice("::ffff:".length));
      if (mapped) return classifyIpv4(mapped); // IPv4-mapped IPv6
    }
    return "public";
  }

  // A DNS name: structurally public. The resolver pass (in assertPublicTarget) classifies its IPs.
  return /^[a-z0-9.-]+$/.test(lower) && lower.includes(".") ? "public" : "invalid-host";
}

export async function assertPublicTarget(
  input: string,
  resolve?: (host: string) => Promise<readonly string[]>,
): Promise<ParsedTarget> {
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfRejection("invalid-host", "target is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfRejection("invalid-scheme", `scheme ${url.protocol} is not allowed`);
  }
  const host = url.hostname;
  const literal = classifyHost(host);
  if (literal !== "public") {
    throw new SsrfRejection(literal, `target host is ${literal}`);
  }
  if (resolve) {
    const ips = await resolve(host);
    if (ips.length === 0) throw new SsrfRejection("invalid-host", "host did not resolve");
    for (const ip of ips) {
      const c = classifyHost(ip);
      if (c !== "public") throw new SsrfRejection(c, `resolved IP ${ip} is ${c}`);
    }
  }
  return { url, host };
}
```

- [ ] **Step 4: Add the export** — in `packages/integrations/package.json` `exports`, add:

```json
    "./safe-target": "./src/safe-target.ts"
```

- [ ] **Step 5: Run it, verify it passes**

Run: `pnpm --filter @magna-carta/integrations test safe-target`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/integrations
git commit -m "feat(integrations): add SSRF guard (assertPublicTarget/classifyHost) for outbound targets"
```

---

## Phase C — WHOIS package (buildable now)

### Task 4: Scaffold `@magna-carta/whois` + types

**Files:**

- Create: `packages/whois/package.json`, `packages/whois/tsconfig.json`, `packages/whois/vitest.config.ts`, `packages/whois/src/types.ts`, `packages/whois/CLAUDE.md`

**Interfaces:**

- Produces (in `src/types.ts`):

```ts
import type { HttpClient } from "@magna-carta/integrations/http";

export interface RegistrationResult {
  readonly source: "rdap" | "whois-43";
  readonly target: string; // normalized domain or IP queried
  readonly registrar?: string;
  readonly registeredAt?: string; // ISO 8601
  readonly expiresAt?: string;
  readonly lastChangedAt?: string;
  readonly nameservers?: readonly string[];
  readonly statuses?: readonly string[];
  readonly registrant?: string;
  readonly raw?: string; // populated for source "whois-43" (unparsed legacy text)
}

// Opens a port-43 WHOIS connection. Worker backs it with cloudflare:sockets; tests pass a fake.
export interface WhoisSocket {
  query(host: string, request: string): Promise<string>;
}

export interface WhoisDeps {
  readonly http: HttpClient;
  readonly socket: WhoisSocket;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
}
```

- [ ] **Step 1: Create the package files.** Copy `packages/tools/package.json` / `tsconfig.json` / `vitest.config.ts` as the template (match `type: module`, `sideEffects: false`, subpath `exports`, `@magna-carta/*` workspace deps). `package.json` name `@magna-carta/whois`, dependency `@magna-carta/integrations`. Exports: `"./types"`, `"./lookup"`, `".": "./src/index.ts"`.

- [ ] **Step 2: Write `src/types.ts`** with the block above.

- [ ] **Step 3: Write `CLAUDE.md`** — a short note: package is a worker-consumed RDAP/WHOIS lookup; all outbound effects injected (`WhoisDeps`); carries the SSRF invariant locally (the target is user-supplied — always `assertPublicTarget` first); RDAP-first, port-43 raw fallback.

- [ ] **Step 4: Verify it builds**

Run: `pnpm --filter @magna-carta/whois exec tsc --noEmit`
Expected: PASS (no implementation yet; types compile).

- [ ] **Step 5: Commit**

```bash
git add packages/whois
git commit -m "chore(whois): scaffold @magna-carta/whois package and types"
```

### Task 5: RDAP resolution + query + parse

**Files:**

- Create: `packages/whois/src/rdap.ts`
- Test: `packages/whois/test/rdap.test.ts`

**Interfaces:**

- Consumes: `HttpClient` (`@magna-carta/integrations/http`), `RegistrationResult` (Task 4).
- Produces:
  - `resolveRdapBase(target: string, http: HttpClient): Promise<string | null>` — fetches the IANA bootstrap (`https://data.iana.org/rdap/dns.json` for a domain by TLD, `.../ipv4.json` etc. for an IP) and returns the authoritative base URL, or `null` if the TLD/block has no RDAP server.
  - `queryRdap(target: string, base: string, http: HttpClient): Promise<RegistrationResult>` — `GET {base}domain/{target}` (or `ip/{target}`), maps the JSON into `RegistrationResult` with `source: "rdap"`.

- [ ] **Step 1: Write the failing test** (use a fake `HttpClient` returning canned bootstrap + RDAP JSON fixtures):

```ts
import { resolveRdapBase, queryRdap } from "../src/rdap.ts";
import type { HttpClient } from "@magna-carta/integrations/http";

function fakeHttp(routes: Record<string, unknown>): HttpClient {
  return {
    async request({ url }) {
      const body = routes[url];
      if (body === undefined) return { status: 404, json: async () => ({}) };
      return { status: 200, json: async () => body };
    },
  };
}

test("resolveRdapBase finds the base URL for a TLD", async () => {
  const http = fakeHttp({
    "https://data.iana.org/rdap/dns.json": {
      services: [[["com", "net"], ["https://rdap.verisign.com/com/v1/"]]],
    },
  });
  expect(await resolveRdapBase("example.com", http)).toBe("https://rdap.verisign.com/com/v1/");
});

test("resolveRdapBase returns null for a TLD with no RDAP server", async () => {
  const http = fakeHttp({
    "https://data.iana.org/rdap/dns.json": {
      services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]],
    },
  });
  expect(await resolveRdapBase("example.xn--unknown", http)).toBeNull();
});

test("queryRdap maps registrar, dates, nameservers, statuses", async () => {
  const http = fakeHttp({
    "https://rdap.verisign.com/com/v1/domain/example.com": {
      status: ["client transfer prohibited"],
      nameservers: [{ ldhName: "a.iana-servers.net" }, { ldhName: "b.iana-servers.net" }],
      events: [
        { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
        { eventAction: "expiration", eventDate: "2026-08-13T04:00:00Z" },
        { eventAction: "last changed", eventDate: "2025-08-14T07:01:44Z" },
      ],
      entities: [
        { roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "RESERVED-Internet"]]] },
      ],
    },
  });
  const result = await queryRdap("example.com", "https://rdap.verisign.com/com/v1/", http);
  expect(result.source).toBe("rdap");
  expect(result.registeredAt).toBe("1995-08-14T04:00:00Z");
  expect(result.expiresAt).toBe("2026-08-13T04:00:00Z");
  expect(result.nameservers).toEqual(["a.iana-servers.net", "b.iana-servers.net"]);
  expect(result.statuses).toEqual(["client transfer prohibited"]);
  expect(result.registrar).toBe("RESERVED-Internet");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @magna-carta/whois test rdap`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `rdap.ts`** — bootstrap structure is `{ services: Array<[matchKeys[], baseUrls[]]> }`. For a domain, match the registrable TLD (last label) against the service key lists; for an IP, match the CIDR (acceptable MVP: match the first matching service, or fall through to `null`). `queryRdap` issues `GET base + "domain/" + target` (ensure exactly one slash), pulls `events` by `eventAction` (`registration` → `registeredAt`, `expiration` → `expiresAt`, `last changed` → `lastChangedAt`), maps `nameservers[].ldhName`, copies `status`, and extracts the registrar entity's `fn` from its vCard. Be defensive — every field optional; never throw on a missing field.

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @magna-carta/whois test rdap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/whois/src/rdap.ts packages/whois/test/rdap.test.ts
git commit -m "feat(whois): RDAP bootstrap resolution, query, and result parsing"
```

### Task 6: Legacy port-43 fallback

**Files:**

- Create: `packages/whois/src/legacy.ts`
- Test: `packages/whois/test/legacy.test.ts`

**Interfaces:**

- Consumes: `WhoisSocket` (Task 4).
- Produces:
  - `whoisHostForTld(tld: string): string | null` — maps a TLD to its WHOIS port-43 host (a small static table for common ccTLDs lacking RDAP, e.g. `de` → `whois.denic.de`; return `null` if unknown).
  - `queryLegacy(target: string, socket: WhoisSocket): Promise<RegistrationResult>` — resolves the host, runs `socket.query(host, target + "\r\n")`, returns `{ source: "whois-43", target, raw }`.

- [ ] **Step 1: Write the failing test**

```ts
import { whoisHostForTld, queryLegacy } from "../src/legacy.ts";
import type { WhoisSocket } from "../src/types.ts";

test("maps a known ccTLD to its port-43 host", () => {
  expect(whoisHostForTld("de")).toBe("whois.denic.de");
  expect(whoisHostForTld("zz")).toBeNull();
});

test("queryLegacy returns raw text labelled whois-43", async () => {
  const socket: WhoisSocket = {
    async query(host, request) {
      expect(host).toBe("whois.denic.de");
      expect(request).toContain("example.de");
      return "Domain: example.de\nStatus: connect\n";
    },
  };
  const result = await queryLegacy("example.de", socket);
  expect(result.source).toBe("whois-43");
  expect(result.raw).toContain("Domain: example.de");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @magna-carta/whois test legacy`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `legacy.ts`** with a small `Record<string, string>` TLD→host table (seed with a handful: `de`, `eu`, `nl`, `fr`, `it`, `be` — extend later) and the `queryLegacy` orchestration. Throw a typed error if `whoisHostForTld` returns `null`.

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @magna-carta/whois test legacy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/whois/src/legacy.ts packages/whois/test/legacy.test.ts
git commit -m "feat(whois): legacy port-43 WHOIS fallback for ccTLDs without RDAP"
```

### Task 7: `lookupRegistration` orchestrator + index

**Files:**

- Create: `packages/whois/src/lookup.ts`, `packages/whois/src/index.ts`
- Test: `packages/whois/test/lookup.test.ts`

**Interfaces:**

- Consumes: `assertPublicTarget` (`@magna-carta/integrations/safe-target`), `resolveRdapBase`/`queryRdap` (Task 5), `whoisHostForTld`/`queryLegacy` (Task 6), `WhoisDeps` (Task 4).
- Produces: `lookupRegistration(query: string, deps: WhoisDeps): Promise<RegistrationResult>`.

- [ ] **Step 1: Write the failing test**

```ts
import { lookupRegistration } from "../src/lookup.ts";
import type { WhoisDeps } from "../src/types.ts";

const bootstrap = {
  "https://data.iana.org/rdap/dns.json": { services: [[["com"], ["https://rdap.example/com/"]]] },
};

function deps(routes: Record<string, unknown>, socketText = ""): WhoisDeps {
  return {
    http: {
      async request({ url }) {
        const body = { ...bootstrap, ...routes }[url];
        return body === undefined
          ? { status: 404, json: async () => ({}) }
          : { status: 200, json: async () => body };
      },
    },
    socket: {
      async query() {
        return socketText;
      },
    },
  };
}

test("rejects a private/invalid target via the SSRF guard", async () => {
  await expect(lookupRegistration("http://127.0.0.1", deps({}))).rejects.toMatchObject({
    name: "SsrfRejection",
  });
});

test("returns RDAP result for a com domain", async () => {
  const d = deps({ "https://rdap.example/com/domain/example.com": { status: ["active"] } });
  const result = await lookupRegistration("example.com", d);
  expect(result.source).toBe("rdap");
  expect(result.target).toBe("example.com");
});

test("falls back to port-43 when the TLD has no RDAP base", async () => {
  const d = deps({}, "Domain: example.de\n");
  const result = await lookupRegistration("example.de", d);
  expect(result.source).toBe("whois-43");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @magna-carta/whois test lookup`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lookup.ts`** — normalize the query (strip scheme/path to a bare domain or IP via `assertPublicTarget(query, deps.resolve)`, then use `parsed.host`), try RDAP (`resolveRdapBase` → `queryRdap`), and if `resolveRdapBase` returns `null`, fall back to `queryLegacy`. Surface `SsrfRejection` unchanged. Write `src/index.ts` re-exporting `lookupRegistration`, `RegistrationResult`, and the dep types.

- [ ] **Step 4: Run it, verify it passes; full package test**

Run: `pnpm --filter @magna-carta/whois test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add packages/whois
git commit -m "feat(whois): lookupRegistration orchestrator (guard, RDAP-first, port-43 fallback)"
```

---

## Phase D — Safe-browse package (buildable now)

### Task 8: Scaffold `@magna-carta/safe-browse` + types

**Files:**

- Create: `packages/safe-browse/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `CLAUDE.md`

**Interfaces:**

- Produces (`src/types.ts`):

```ts
export interface RedirectHop {
  readonly url: string;
  readonly status: number;
  readonly location?: string;
}

export interface SafeView {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly redirectChain: readonly RedirectHop[];
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly screenshotBase64: string;
  readonly title?: string;
  readonly markdown?: string;
  readonly links: readonly string[];
}

// Follows redirects with a raw fetch (no JS execution), one hop at a time, guarded per hop.
export interface RedirectProbe {
  follow(url: string): Promise<{
    chain: readonly RedirectHop[];
    finalUrl: string;
    headers: Readonly<Record<string, string>>;
  }>;
}

// Renders a URL in the isolated remote browser and returns inert artifacts. Worker backs it with
// env.BROWSER.quickAction("snapshot", ...) + ("links", ...); tests pass a fake.
export interface BrowserRenderer {
  snapshot(url: string): Promise<{
    screenshotBase64: string;
    content?: string;
    markdown?: string;
    title?: string;
    links?: readonly string[];
  }>;
}

export interface SafeBrowseDeps {
  readonly probe: RedirectProbe;
  readonly renderer: BrowserRenderer;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
}
```

- [ ] **Step 1: Create package files** (same template as `@magna-carta/whois`; name `@magna-carta/safe-browse`, dep `@magna-carta/integrations`, exports `"./types"`, `"./capture"`, `".": "./src/index.ts"`).
- [ ] **Step 2: Write `src/types.ts`** with the block above.
- [ ] **Step 3: Write `CLAUDE.md`** — worker-consumed; the suspect page renders in Cloudflare's browser, never the user's; outputs are inert (image + escaped text); all effects injected; SSRF-guard the target first; screenshots transient (not persisted).
- [ ] **Step 4: Verify it builds** — `pnpm --filter @magna-carta/safe-browse exec tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** — `git add packages/safe-browse && git commit -m "chore(safe-browse): scaffold @magna-carta/safe-browse package and types"`

### Task 9: `captureSafeView` orchestrator + index

**Files:**

- Create: `packages/safe-browse/src/capture.ts`, `packages/safe-browse/src/index.ts`
- Test: `packages/safe-browse/test/capture.test.ts`

**Interfaces:**

- Consumes: `assertPublicTarget` (`@magna-carta/integrations/safe-target`), `SafeBrowseDeps`, `SafeView` (Task 8).
- Produces: `captureSafeView(url: string, deps: SafeBrowseDeps): Promise<SafeView>`.

- [ ] **Step 1: Write the failing test**

```ts
import { captureSafeView } from "../src/capture.ts";
import type { SafeBrowseDeps } from "../src/types.ts";

function deps(): SafeBrowseDeps {
  return {
    probe: {
      async follow(url) {
        return {
          chain: [{ url, status: 301, location: "https://final.example/" }],
          finalUrl: "https://final.example/",
          headers: { "content-type": "text/html" },
        };
      },
    },
    renderer: {
      async snapshot() {
        return {
          screenshotBase64: "aGVsbG8=",
          markdown: "# Hi",
          title: "Hi",
          links: ["https://x.example/"],
        };
      },
    },
  };
}

test("rejects a private target before any render", async () => {
  const calls: string[] = [];
  const d = deps();
  d.renderer.snapshot = async () => {
    calls.push("rendered");
    return { screenshotBase64: "" };
  };
  await expect(captureSafeView("http://10.0.0.1/", d)).rejects.toMatchObject({
    name: "SsrfRejection",
  });
  expect(calls).toEqual([]); // never rendered
});

test("assembles a SafeView from probe + render", async () => {
  const view = await captureSafeView("http://start.example/", deps());
  expect(view.finalUrl).toBe("https://final.example/");
  expect(view.redirectChain).toHaveLength(1);
  expect(view.screenshotBase64).toBe("aGVsbG8=");
  expect(view.links).toEqual(["https://x.example/"]);
  expect(view.title).toBe("Hi");
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter @magna-carta/safe-browse test capture` → FAIL (module not found).

- [ ] **Step 3: Implement `capture.ts`** — `assertPublicTarget(url, deps.resolve)` first (throws `SsrfRejection` → propagate); then run `deps.probe.follow(parsed.url.href)` and `deps.renderer.snapshot(parsed.url.href)` (probe first so a redirect to a private host can be caught — MVP: render the originally-requested public URL; note that re-guarding every redirect hop target is the probe's job and a hardening point for the future interactive path). Assemble `SafeView`: `requestedUrl` = input, `finalUrl`/`redirectChain`/`responseHeaders` from the probe, `screenshotBase64`/`markdown`/`title`/`links` (default `[]`) from the render. Write `src/index.ts` re-exporting `captureSafeView` + types.

- [ ] **Step 4: Run it, verify it passes; full package test** — `pnpm --filter @magna-carta/safe-browse test` → PASS.

- [ ] **Step 5: Commit** — `git add packages/safe-browse && git commit -m "feat(safe-browse): captureSafeView orchestrator (guard, redirect probe, isolated render)"`

---

## Phase E — Worker routes + wiring (buildable now)

### Task 10: `GET /api/v1/whois` route

**Files:**

- Create: `apps/worker/src/routes/tools/whois.ts`
- Modify: `apps/worker/src/app.ts` (import + `registerWhoisRoute(app, chokepoint)` near `registerFirmUsageRoute`)
- Test: `apps/worker/test/whois-route.test.ts` (match the existing Miniflare integration test pattern — check a sibling route test first)

**Interfaces:**

- Consumes: `lookupRegistration` + `WhoisDeps` (`@magna-carta/whois`), the chokepoint helpers used by `firm-usage.ts` (`requireChokepointFirmContext`, `chokepointMiddleware`, `defineOpenAPIRoute`, `RouteMeta`, `Problem`).
- Produces: a registered route gated by `tools:whois`.

- [ ] **Step 1: Write the failing Miniflare test** — authenticated request with `tools:whois`, `GET /api/v1/whois?query=example.com`, with the worker's RDAP `fetch` stubbed (inject a fake `HttpClient` for tests via the route's deps factory, OR stub global `fetch` per the existing test harness). Assert 200 + `source: "rdap"`. Add a second case: a member lacking `tools:whois` → 403. (Mirror the auth/permission setup from the existing firm-usage route test.)

- [ ] **Step 2: Run it, verify it fails** — `vp test whois-route` → FAIL (route not registered).

- [ ] **Step 3: Implement `whois.ts`** following `firm-usage.ts` exactly:
  - `WhoisQuery = z.object({ query: z.string().min(1).max(255) })` (request query); `WhoisResponse = z.object({ source: z.enum(["rdap","whois-43"]), target: z.string(), registrar: z.string().optional(), registeredAt: z.string().optional(), expiresAt: z.string().optional(), lastChangedAt: z.string().optional(), nameservers: z.array(z.string()).optional(), statuses: z.array(z.string()).optional(), registrant: z.string().optional(), raw: z.string().optional() }).openapi("WhoisResponse")`.
  - `whoisMeta: RouteMeta` = `{ operationId: "whois.get", surface: "app", authenticated: true, permission: "tools:whois", resource: "firm", audited: false, idempotency: "optional", rateLimit: "default" }`.
  - `defineOpenAPIRoute(whoisMeta, { method: "get", path: "/api/v1/whois", request: { query: WhoisQuery }, description: "Registration data (RDAP, with a legacy WHOIS fallback) for a website's domain or an IP address.", responses: { 200, 400, 401, 403, 429 with Problem } })`.
  - Handler: build `WhoisDeps` from worker bindings — `http: fetchHttpClient()` (`@magna-carta/integrations/http`), `socket`: a `cloudflare:sockets`-backed `WhoisSocket` (see note), `resolve`: a DoH resolver (`https://cloudflare-dns.com/dns-query`) or omit for MVP. Call `lookupRegistration(query, deps)`. On `SsrfRejection` return `400` Problem (redacted — do not echo the host); on other errors, the standard error pipeline (correlated, redacted, Error ID).
  - **Port-43 `WhoisSocket` worker adapter:** `import { connect } from "cloudflare:sockets"` — open `connect({ hostname, port: 43 })`, write `request`, read the stream to a string, close. **Verify the `connect()` read/write API against current Cloudflare docs before writing** (golden rule 11). For MVP it is acceptable to provide a `WhoisSocket` whose `query` throws "legacy WHOIS unavailable" and rely on RDAP, _if_ the socket API proves out of scope — but prefer the real implementation.

- [ ] **Step 4: Run it, verify it passes** — `vp test whois-route` → PASS (200 + 403 cases).

- [ ] **Step 5: Commit** — `git add apps/worker && git commit -m "feat(worker): GET /api/v1/whois route gated by tools:whois"`

### Task 11: `POST /api/v1/safe-browse` route + BROWSER binding

**Files:**

- Modify: `apps/worker/wrangler.jsonc` (or `.toml`) — add `"browser": { "binding": "BROWSER" }`; ensure `compatibility_date >= "2026-03-24"`.
- Modify: `apps/worker/src/app.ts` — add `BROWSER` to the `Bindings` type; register the route.
- Create: `apps/worker/src/routes/tools/safe-browse.ts`
- Test: `apps/worker/test/safe-browse-route.test.ts`

**Interfaces:**

- Consumes: `captureSafeView` + `SafeBrowseDeps`/`BrowserRenderer`/`RedirectProbe` (`@magna-carta/safe-browse`), chokepoint helpers.
- Produces: a registered route gated by `tools:safeBrowse`.

- [ ] **Step 1: Write the failing Miniflare test** — authenticated `tools:safeBrowse`, `POST /api/v1/safe-browse` `{ url: "http://example.com" }`, with a **fake `BROWSER` binding** (an object whose `quickAction` returns `{ json: async () => ({ result: { screenshot: "aGk=", markdown: "# x", links: [] } }) }` — match the real binding's return shape, which is a `Response`-like with `.json()`), and the redirect probe's `fetch` stubbed. Assert 200 + a base64 `screenshotBase64`. Second case: `{ url: "http://127.0.0.1" }` → 400 (SSRF). Third: missing permission → 403.

- [ ] **Step 2: Run it, verify it fails** — `vp test safe-browse-route` → FAIL.

- [ ] **Step 3: Implement `safe-browse.ts`** following `firm-usage.ts`:
  - `SafeBrowseRequest = z.object({ url: z.string().min(1).max(2048) })`; `RedirectHopSchema`, `SafeBrowseResponse` mirroring `SafeView` (`.openapi("SafeWebsiteView")`).
  - `safeBrowseMeta: RouteMeta` = `{ operationId: "safeBrowse.post", surface: "app", authenticated: true, permission: "tools:safeBrowse", resource: "firm", audited: false, idempotency: "optional", rateLimit: "default" }`.
  - `defineOpenAPIRoute(..., { method: "post", path: "/api/v1/safe-browse", request: { body: { content: { "application/json": { schema: SafeBrowseRequest } } } }, description: "Render a potentially malicious URL in an isolated remote browser and return a static snapshot (screenshot, redirect chain, headers, links) — no code runs in the user's browser.", responses: { 200, 400, 401, 403, 429, 502 (render unavailable) with Problem } })`.
  - **`BrowserRenderer` worker adapter:** `async snapshot(url) { const res = await env.BROWSER.quickAction("snapshot", { url, formats: ["screenshot", "markdown"] }); const body = await res.json(); const links = await env.BROWSER.quickAction("links", { url }).then(r => r.json()).catch(() => ({ result: [] })); return { screenshotBase64: body.result.screenshot, markdown: body.result.markdown, content: body.result.content, title: undefined, links: links.result ?? [] }; }` — confirm the exact result envelope shape against current docs; keep links best-effort (a failed links call must not fail the capture).
  - **`RedirectProbe` worker adapter:** a manual-redirect `fetch` loop — `fetch(href, { redirect: "manual" })`, `assertPublicTarget` the `Location` of each hop before following, cap at ~10 hops and a small timeout, discard bodies; collect `{ url, status, location }` per hop and the final headers.
  - Handler: parse body, `captureSafeView(url, deps)`; map `SsrfRejection` → 400 (redacted), Browser-Rendering capacity/limit errors → 502 (redacted, correlated, Error ID).

- [ ] **Step 4: Run it, verify it passes** — `vp test safe-browse-route` → PASS (200 + 400 + 403).

- [ ] **Step 5: Commit** — `git add apps/worker && git commit -m "feat(worker): POST /api/v1/safe-browse route + BROWSER binding, gated by tools:safeBrowse"`

### Task 12: Seed the two permissions to staff roles

**Files:**

- Create: a new migration in the worker's control-plane/role migrations dir (find the dir + the latest number via `ls` of the migrations folder; mirror `0006_seed-tools-firm-usage`).
- Test: extend the migration/seed test if one exists; otherwise a Miniflare assertion that a seeded default role resolves `tools:whois` and `tools:safeBrowse`.

- [ ] **Step 1: Locate the seed pattern** — `grep -rn "seed-tools-firm-usage\|tools:firmUsage" apps/worker` to find the exact migration file + how a `tools:` permission is attached to the Owner/Admin (and any staff) roles.
- [ ] **Step 2: Write the failing test** (if the harness supports it) asserting the seeded role grants both new permissions; else verify via the route 200 path already exercised in Tasks 10-11 and skip a dedicated test.
- [ ] **Step 3: Write the migration** — seed `tools:whois` and `tools:safeBrowse` to the same roles `tools:firmUsage` is seeded to (broad staff access per the spec). Use the next migration number + a descriptive name.
- [ ] **Step 4: Run the worker migration + integration tests** — `vp test` (worker integration applies migrations) → PASS.
- [ ] **Step 5: Commit** — `git add apps/worker && git commit -m "feat(worker): seed tools:whois and tools:safeBrowse to staff roles"`

---

## Phase F — Documentation (buildable now; required, golden rule 5)

### Task 13: Developer + user docs, ROADMAP, CHANGELOG + ADR fragments

**Files:**

- Modify: `docs/Magna-Carta-White-Paper.md` — feature-map entry for the **Websites & Domains** tool group (WHOIS Lookup + Safe Website Viewer).
- Create: `docs/user/whois-lookup.md`, `docs/user/safe-website-viewer.md` (end-user guides — what each does, what "rendered safely" means, what the WHOIS fields mean; no internal architecture).
- Modify: `ROADMAP.md` — move/record these two tools as shipped (per the file's current structure; edit only the relevant rows).
- Create: `changelog.d/tools-whois-safe-browse.md` (changelog fragment — Added: WHOIS Lookup + Safe Website Viewer tools).
- Create four ADR fragments in `docs/decisions/pending/`:
  - `web-domains-tool-group-and-website-context-tag.md`
  - `whois-rdap-first-with-port-43-fallback.md`
  - `outbound-fetch-ssrf-guard-invariant.md`
  - `safe-website-viewer-static-snapshot-with-streaming-seam.md`
    Use the existing pending fragments as the frontmatter template (`ls docs/decisions/pending/` then open one).
- Modify: `docs/conventions/invariants.md` — add the SSRF-guard invariant (every user-supplied outbound target passes `assertPublicTarget` before any fetch/render).

- [ ] **Step 1:** Check the white-paper feature-map + ROADMAP structure (`grep -n "Tools" docs/Magna-Carta-White-Paper.md ROADMAP.md`) and a sample pending ADR fragment for frontmatter shape.
- [ ] **Step 2:** Write the user guides with the elements-of-style skill if available; keep them task-oriented and free of internal architecture (hard boundary per CLAUDE.md).
- [ ] **Step 3:** Write the white-paper entry, ROADMAP edit, changelog fragment, four ADR fragments, and the invariants entry. No process-doc citations leak into any `docs/user/` or source file.
- [ ] **Step 4:** Run `pnpm check` (full quality gate: fmt + lint + typecheck + svelte-check) and `pnpm run lint:process-refs` (source-scan fitness for golden rule 13) → both PASS.
- [ ] **Step 5: Commit** — `git add docs ROADMAP.md changelog.d && git commit -m "docs(tools): WHOIS + Safe Website Viewer — white paper, user guides, ADR + changelog fragments, SSRF invariant"`

---

## Phase G — UI widgets (GATED on the 0·7a design-system shell — NOT buildable now)

The Tools UI shell (left-nav, the `id → component` map, contextual entry points) does not exist on `main` yet; it lands with the design-system shell, exactly as every other tool's widget is gated. Build this phase **only once that shell is present.**

### Task 14 (gated): WHOIS + Safe Website Viewer widgets

**Files (when unblocked):**

- The shell's `id → Svelte component` map — add `whois-lookup → WhoisLookup.svelte`, `safe-website-viewer → SafeWebsiteViewer.svelte`.
- `WhoisLookup.svelte` — a query input + a structured result card (parsed RDAP fields) or a monospace block (raw port-43 text), labelled by `source`. Calls `GET /api/v1/whois` via the api-client.
- `SafeWebsiteViewer.svelte` — a URL input, a prominent "rendered safely in an isolated browser" affordance, the screenshot as an `<img>` (from base64), and inert panels for redirect chain / headers / links / markdown. **HTML content is shown only as escaped text — never re-rendered as live markup.** Calls `POST /api/v1/safe-browse`.

**Constraints when built:** all UI through `@magna-carta/design-system` + Tailwind tokens (golden rule 2); Lucide icons (`globe`, `shield`); no raw CSS, no `bits-ui` import; build against Svelte 5 runes (golden rule 11; use the svelte MCP/skill). Add an `api-client` method per route from the generated OpenAPI types.

---

## Pre-merge gate (after Phases A–F, before merging to main)

- [ ] Full suite green: `vp test` and `pnpm check`.
- [ ] `pnpm run lint:process-refs` clean (no ADR/spec/slice references in source or test strings).
- [ ] The package-build pre-merge **7-angle adversarial review** with empirical verifiers (per `docs/conventions/testing.md`) on the two new packages + the SSRF guard + the two routes — with particular attention to the SSRF guard's allow/deny matrix (the security-critical surface) and redaction (no investigated URL/host or fetched content in any log).
- [ ] Load-profile check on the two routes per the load-profile harness.
- [ ] Sync `main` (`vp run worktrees` to check drift) before touching shared/generated files; CHANGELOG/Decision-Log are assembled on `main` from the fragments — never hand-edit the rendered files on this branch.
- [ ] On merge: remove the worktree (if any), delete the branch, delete `docs/active-work/tools-whois-safe-browse.md`.

---

## Self-Review

**Spec coverage:** §1 scope → Tasks 1-13; §2 IA (group/tag/rows/permissions/seed) → Tasks 1, 2, 12; §3 WHOIS (RDAP-first + port-43 + route) → Tasks 4-7, 10; §4 Safe Viewer (snapshot + redirect/header + transient + route + binding) → Tasks 8-9, 11; §5 SSRF/redaction/timeouts invariants → Task 3 + redaction in Tasks 10-11 + invariants doc in Task 13; §6 testing → tests in every task + pre-merge gate; §7 streaming seam → documented (Phase G note + ADR fragment in Task 13, not built); §8 docs → Task 13. **One faithful refinement vs. the spec's wording:** the redirect chain / status / headers come from a guarded `fetch` redirect-probe (Task 11), not from Browser Rendering (which doesn't expose them) — same promised outputs, cleaner mechanism. No gaps.

**Placeholder scan:** no "TBD/TODO/handle edge cases" left as work items; the two explicit "verify the API against current docs" notes (`cloudflare:sockets connect()`, the Browser Rendering result envelope) are golden-rule-11 verification steps, not deferred implementation, and each has a concrete fallback.

**Type consistency:** `RegistrationResult` / `WhoisDeps` / `WhoisSocket` (Tasks 4-7, 10) and `SafeView` / `RedirectHop` / `BrowserRenderer` / `RedirectProbe` / `SafeBrowseDeps` (Tasks 8-9, 11) are defined once and consumed under the same names; `assertPublicTarget` / `SsrfRejection` / `classifyHost` / `TargetClass` (Task 3) are reused unchanged downstream; permission strings `tools:whois` / `tools:safeBrowse` are identical across Tasks 1, 2, 10, 11, 12.
