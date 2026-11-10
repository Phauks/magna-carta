// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
// The RFC 9457 problem module and the problem-type URI registry.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import { Problem, defaultHook, problemJson } from "../../src/http/contracts/problem";
import { PROBLEM_TYPES, problemType } from "../../src/http/contracts/problem-types";

// A minimal Context stub whose .json mirrors Hono's: serializes the body and stamps status +
// headers. .get returns undefined (no telemetry middleware ran off the request lifecycle, so there
// is no stashed correlation id — problemJson omits the field). Enough to exercise
// problemJson/defaultHook directly.
function fakeContext(path: string): Context {
  return {
    req: { path },
    get: () => undefined,
    json: (body: unknown, status?: number, headers?: Record<string, string>) =>
      new Response(JSON.stringify(body), { status: status ?? 200, headers }),
  } as unknown as Context;
}

describe("problem-type URI registry", () => {
  it("expands a key to its full type URI", () => {
    expect(problemType("validation")).toBe("https://api.magnacarta.esq/problems/validation");
    expect(problemType("idempotency-key-conflict")).toBe(
      "https://api.magnacarta.esq/problems/idempotency-key-conflict",
    );
  });

  it("registers the problem types", () => {
    expect(Object.keys(PROBLEM_TYPES).toSorted()).toEqual(
      [
        "validation",
        "unauthenticated",
        "permission-denied",
        "not-found",
        "idempotency-key-missing",
        "idempotency-key-conflict",
        "idempotency-fingerprint-mismatch",
        "rate-limited",
        "registration-not-confirmable",
        "report-period-invalid",
        "report-period-too-large",
        "report-cannot-be-produced",
        "self-administration",
        "last-administrator",
        "unknown-role",
        "role-family",
        "conflict",
        "custody-approver-must-differ",
        "custody-destruction-not-actionable",
        "custody-hold-blocks-action",
        "custody-intrinsic-value-not-destructible",
        "custody-invalid-movement",
        "custody-jurisdiction-unavailable",
        "custody-location-cycle",
        "custody-location-occupied",
        "custody-number-exhausted",
        "custody-owner-required",
        "custody-release-not-authorized",
        "custody-stocktake-closed",
        "custody-stocktake-truncated",
        "email-in-use",
        "human-verification-required",
        "upload-not-allowed",
        "malware-flagged",
        "export-copies-pending",
        "unsupported-conversion",
        "not-an-archive",
        "archive-unreadable",
        "page-render-failed",
        "storage-unavailable",
        "wrong-password",
        "internal",
        "invitation-not-redeemable",
        "not-implemented",
        "beta-consent-required",
        "service-unavailable",
        "mail-undeliverable",
        "template-normalization-failed",
        "template-not-activatable",
        "template-macro-consent-required",
        "template-expression-invalid",
        "assembly-expression-refused",
        "auto-file-direct-filing-not-permitted",
        "auto-file-rule-duplicate",
        "auto-file-rule-not-actionable",
        "auto-file-rule-not-creatable",
        "merge-field-unresolvable",
        "websocket-upgrade-required",
        "trust-insufficient-available",
        "trust-movement-refused",
        "ledger-entry-refused",
        "trust-jurisdiction-unavailable",
        "trust-disbursement-not-pending",
        "trust-disbursement-authorization-refused",
        "trust-authorization-policy-conflict",
        "trust-reconciliation-closed",
        "trust-reconciliation-already-accounted-for",
        "trust-statement-import-refused",
        "trust-reconciliation-refused",
        "trust-reconciliation-truncated",
        "trust-firm-funds-refused",
        "trust-firm-funds-insufficient",
        "trust-unclaimed-funds-refused",
        "trust-unclaimed-funds-review-not-actionable",
        "trust-dormant-list-truncated",
        "billing-invoice-not-editable",
        "billing-work-already-claimed",
        "billing-account-role-unmapped",
        "billing-refused",
        "billing-earned-fee-refused",
        "billing-exceeds-unpaid-balance",
        "billing-replenishment-already-open",
        "matter-close-refused",
        "matter-graduate-refused",
        "matter-open-refused",
        "note-retracted",
        "calendar-window-too-wide",
        "calendar-deadline-catalog-unavailable",
        "calendar-deadline-settled",
        "calendar-platform-type-immutable",
        "calendar-event-type-category-mismatch",
        "calendar-resource-inactive",
        "calendar-resource-name-taken",
        "calendar-sync-setting-refused",
        "calendar-event-not-continuable",
        "calendar-duplicate-link",
        "calendar-continuance-link-immutable",
        "calendar-continuance-chain-too-deep",
        "matter-asset-type-class-mismatch",
        "matter-asset-class-frozen",
        "matter-asset-valuation-append-only",
        "matter-asset-currency-mismatch",
        "matter-asset-credential-storage-refused",
        "matter-asset-batch-too-large",
        "matter-asset-document-matter-mismatch",
        "matter-asset-encumbrance-not-on-asset",
        "matter-asset-schedule-too-large",
        "matter-asset-unknown-custody-item",
        "magnus-firm-not-eligible",
        "magnus-not-enabled",
        "magnus-acknowledgement-required",
        "magnus-turn-too-large",
        "magnus-daily-ceiling-reached",
        "meeting-not-found",
        "meeting-ended",
        "meeting-in-progress",
        "meeting-room-full",
        "meeting-not-joined",
        "meetings-not-configured",
        "meeting-message-not-found",
        "meeting-message-too-long",
        "meeting-move-refused",
        "personal-room-changed",
        "personal-room-not-found",
        "personal-room-not-owner",
        "meeting-poll-not-found",
        "meeting-poll-closed",
        "meeting-poll-already-answered",
        "meeting-poll-answers-not-attributed",
        "meeting-poll-invalid",
        "meeting-question-not-found",
        "meeting-question-too-long",
        "meeting-question-limit-reached",
        "meeting-not-host",
        "meeting-locked",
        "meeting-removed",
        "meeting-lobby-full",
        "meeting-not-admitted",
        "meeting-recording-not-configured",
        "meeting-recording-already-running",
        "meeting-recording-not-running",
        "meeting-recording-needs-matter",
        "meeting-recording-too-many-tracks",
        "meeting-transcript-not-ready",
        "meeting-summary-not-ready",
        "meeting-summary-action-item-tasked",
        "guest-link-not-valid",
        "guest-link-expired",
        "guest-link-revoked",
        "guest-link-exhausted",
        "guest-not-invitable",
        "discovery-access-list-would-be-empty",
        "discovery-ceiling-exceeded",
        "discovery-coding-act-not-undoable",
        "discovery-coding-panel-refused",
        "discovery-review-set-closed",
        "discovery-review-set-reopen-refused",
        "discovery-load-source-not-built",
        "discovery-transcript-scope-unstated",
        "discovery-selection-refused",
        "discovery-load-not-reconciled",
      ].toSorted(),
    );
  });

  it("stays an identity map — the ProblemTypeUri template type interpolates the KEY, the runtime the VALUE", () => {
    // If a key ever maps to a different value, the compile-time URI type and the runtime URI
    // silently desynchronize; this pin makes that divergence loud.
    for (const [key, value] of Object.entries(PROBLEM_TYPES)) {
      expect(value).toBe(key);
    }
  });
});

describe("Problem schema", () => {
  it("accepts the full RFC 9457 shape including errorId and errors[]", () => {
    const parsed = Problem.safeParse({
      type: "https://api.magnacarta.esq/problems/validation",
      title: "Validation failed",
      status: 422,
      detail: "One or more fields failed validation.",
      errorId: "error_V1StGXR8_Z5jdHi6B-myT",
      instance: "/api/v1/matters",
      errors: [{ path: "title", code: "too_small", detail: "Too small" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the minimal shape (detail, instance, errors optional)", () => {
    const parsed = Problem.safeParse({
      type: "https://api.magnacarta.esq/problems/not-found",
      title: "Not found",
      status: 404,
      errorId: "error_V1StGXR8_Z5jdHi6B-myT",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a status outside the 4xx/5xx error range (the schema documents error replies only)", () => {
    const base = {
      type: "https://api.magnacarta.esq/problems/not-found",
      title: "Not found",
      errorId: "error_V1StGXR8_Z5jdHi6B-myT",
    };
    expect(Problem.safeParse({ ...base, status: 200 }).success).toBe(false);
    expect(Problem.safeParse({ ...base, status: 304 }).success).toBe(false);
    expect(Problem.safeParse({ ...base, status: 399 }).success).toBe(false);
    expect(Problem.safeParse({ ...base, status: 600 }).success).toBe(false);
    expect(Problem.safeParse({ ...base, status: 400 }).success).toBe(true);
    expect(Problem.safeParse({ ...base, status: 599 }).success).toBe(true);
  });

  it("rejects an errorId that is not a well-formed error_ handle", () => {
    const base = {
      type: "https://api.magnacarta.esq/problems/not-found",
      title: "Not found",
      status: 404,
    };
    expect(Problem.safeParse({ ...base, errorId: "error_8Kf3pQ2v" }).success).toBe(false); // token too short
    expect(Problem.safeParse({ ...base, errorId: "matter_V1StGXR8_Z5jdHi6B-myT" }).success).toBe(
      false,
    ); // wrong entity prefix
    expect(Problem.safeParse({ ...base, errorId: "not-an-identifier" }).success).toBe(false);
  });

  it("rejects a problem without an errorId (observability extension is mandatory)", () => {
    const parsed = Problem.safeParse({
      type: "https://api.magnacarta.esq/problems/not-found",
      title: "Not found",
      status: 404,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts the optional requestAccess extension (the 403 seam)", () => {
    const parsed = Problem.safeParse({
      type: "https://api.magnacarta.esq/problems/permission-denied",
      title: "Permission denied",
      status: 403,
      errorId: "error_V1StGXR8_Z5jdHi6B-myT",
      requestAccess: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("requestAccess is a typed optional, not an open passthrough — a non-boolean is rejected", () => {
    const parsed = Problem.safeParse({
      type: "https://api.magnacarta.esq/problems/permission-denied",
      title: "Permission denied",
      status: 403,
      errorId: "error_V1StGXR8_Z5jdHi6B-myT",
      requestAccess: "yes",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("problemJson", () => {
  function appWithNotFoundRoute() {
    const app = new OpenAPIHono();
    app.get("/api/v1/matters/:matterId", (c) =>
      problemJson(c, {
        type: "not-found",
        status: 404,
        title: "Matter not found",
        detail: "No such matter in this firm.",
      }),
    );
    return app;
  }

  it("replies with application/problem+json and the registry type URI", async () => {
    const response = await appWithNotFoundRoute().request("/api/v1/matters/mat_unknown00");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.type).toBe("https://api.magnacarta.esq/problems/not-found");
    expect(body.title).toBe("Matter not found");
    expect(body.status).toBe(404);
    expect(body.detail).toBe("No such matter in this firm.");
  });

  it("generates a fresh error_-prefixed errorId per reply", async () => {
    const app = appWithNotFoundRoute();
    const first = (await (await app.request("/api/v1/matters/mat_a")).json()) as Record<
      string,
      unknown
    >;
    const second = (await (await app.request("/api/v1/matters/mat_b")).json()) as Record<
      string,
      unknown
    >;
    expect(first.errorId).toMatch(/^error_[A-Za-z0-9_-]{21}$/);
    expect(second.errorId).toMatch(/^error_[A-Za-z0-9_-]{21}$/);
    expect(first.errorId).not.toBe(second.errorId);
  });

  it("includes instance from the request path", async () => {
    const response = await appWithNotFoundRoute().request("/api/v1/matters/mat_unknown00");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.instance).toBe("/api/v1/matters/mat_unknown00");
  });

  it("throws when the status is outside the 4xx/5xx range — a problem is never a 2xx/3xx reply", () => {
    const context = fakeContext("/api/v1/matters/mat_x");
    for (const status of [200, 204, 301, 399, 600]) {
      expect(() =>
        problemJson(context, {
          type: "not-found",
          // The platform error path must never emit a non-error status; status is typed to the
          // error range, so a caller reaching this has cast around the type.
          status: status as never,
          title: "Not found",
        }),
      ).toThrowError(/400.*599|range/i);
    }
    // In-range error statuses are accepted (the 400 and 599 range boundaries are exercised via the
    // never-cast path below, since the ProblemStatusCode union omits some literals like 599).
    for (const status of [400, 500] as const) {
      expect(() =>
        problemJson(context, { type: "not-found", status, title: "Not found" }),
      ).not.toThrow();
    }
    // The literal range boundaries 400 and 599 are both accepted by the runtime guard.
    for (const status of [400, 599]) {
      expect(() =>
        problemJson(context, { type: "not-found", status: status as never, title: "Not found" }),
      ).not.toThrow();
    }
  });

  it("emitted problems conform to the Problem schema", async () => {
    const response = await appWithNotFoundRoute().request("/api/v1/matters/mat_unknown00");
    expect(Problem.safeParse(await response.json()).success).toBe(true);
  });

  it("emits requestAccess into the body only when the option is set (the 403 seam)", async () => {
    const app = new OpenAPIHono();
    app.get("/api/v1/matters/:matterId/denied", (c) =>
      problemJson(c, {
        type: "permission-denied",
        status: 403,
        title: "Permission denied",
        requestAccess: true,
      }),
    );
    const response = await app.request("/api/v1/matters/mat_x/denied");
    expect(response.status).toBe(403);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.requestAccess).toBe(true);
    expect(Problem.safeParse(body).success).toBe(true);
  });

  it("omits requestAccess from the body when the option is absent", async () => {
    const response = await appWithNotFoundRoute().request("/api/v1/matters/mat_unknown00");
    const body = (await response.json()) as Record<string, unknown>;
    expect("requestAccess" in body).toBe(false);
  });
});

describe("defaultHook", () => {
  function appWithValidatedRoute() {
    const app = new OpenAPIHono({ defaultHook });
    const createMatterRoute = createRoute({
      method: "post",
      path: "/api/v1/matters",
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ title: z.string().min(1), openedAt: z.iso.datetime() }),
            },
          },
        },
      },
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: z.object({ title: z.string() }) } },
        },
        422: {
          description: "Validation failure",
          content: { "application/problem+json": { schema: Problem } },
        },
      },
    });
    app.openapi(createMatterRoute, (c) => c.json({ title: c.req.valid("json").title }, 201));
    return app;
  }

  it("maps a zod validation failure to the 422 problem shape with field-level errors[]", async () => {
    const response = await appWithValidatedRoute().request("/api/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "", openedAt: "not-a-datetime" }),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, any>;
    expect(body.type).toBe("https://api.magnacarta.esq/problems/validation");
    expect(body.title).toBe("Validation failed");
    expect(body.status).toBe(422);
    expect(body.errorId).toMatch(/^error_[A-Za-z0-9_-]{21}$/);
    expect(body.instance).toBe("/api/v1/matters");
    const paths = body.errors.map((error: { path: string }) => error.path);
    expect(paths).toContain("title");
    expect(paths).toContain("openedAt");
    // Discriminate code vs detail so a mutation swapping the two fields is caught: title: "" fails
    // the min(1) check, whose Zod issue code is "too_small" and whose message is human-readable and
    // distinct from the code.
    const titleError = body.errors.find((error: { path: string }) => error.path === "title");
    expect(titleError).toBeDefined();
    expect(titleError.code).toBe("too_small");
    expect(titleError.detail).not.toBe(titleError.code);
    expect(titleError.detail.toLowerCase()).toContain("small");
    expect(Problem.safeParse(body).success).toBe(true);
  });

  it('normalizes a top-level validation failure (empty Zod issue path) to path "$"', async () => {
    const response = await appWithValidatedRoute().request("/api/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify("not an object"),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, any>;
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].path).toBe("$");
    expect(Problem.safeParse(body).success).toBe(true);
  });

  it("does not interfere with a valid request", async () => {
    const response = await appWithValidatedRoute().request("/api/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Smith v. Jones", openedAt: "2026-06-12T00:00:00Z" }),
    });
    expect(response.status).toBe(201);
  });

  it("renders (does not throw) when an issue path contains a symbol segment", async () => {
    // A future z.map/z.record-with-symbol-keys schema can produce a symbol path segment.
    // issue.path.join(".") would throw "Cannot convert a Symbol value to a string" inside the
    // hook, collapsing a 422 into an unhandled 500. Feed a synthetic issue list directly.
    const context = fakeContext("/api/v1/matters");
    const symbolKey = Symbol("trustLedgerKey");
    const syntheticError = {
      issues: [
        { code: "custom", message: "Symbol-keyed entry failed", path: [symbolKey, "amount"] },
      ],
    } as unknown as ZodError;

    let response: Response | undefined;
    expect(() => {
      response = defaultHook({ success: false, error: syntheticError }, context);
    }).not.toThrow();
    expect(response).toBeDefined();
    const body = (await response!.json()) as Record<string, any>;
    expect(body.status).toBe(422);
    expect(body.errors[0].path).toBe("Symbol(trustLedgerKey).amount");
  });
});
