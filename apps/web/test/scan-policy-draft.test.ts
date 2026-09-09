/*
 * The firm's scan-policy draft: what it reads, what it stages, and what it sends.
 *
 * The case worth having a test for is the one the shared server-backed draft exists to get right:
 * the scan depth and the suspicion threshold are two settings that live inside ONE object on the
 * wire, so changing both has to send one `policy` carrying both — and changing either has to send
 * the other's current value beside it, because the server takes the pair or neither.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createScanPolicyDraft,
  FLAGGED_TREATMENT_DEFINITION as FLAGGED_TREATMENT,
  SCAN_TIER_DEFINITION as SCAN_DEPTH,
  SCORE_FLOOR_DEFINITION as SCORE_FLOOR,
  STEP_UP_DEFINITION as STEP_UP,
  scoreFloorFromValue,
} from "$lib/file-manager/scan-policy-draft.svelte.ts";
import type { ScanPolicySettings } from "$lib/file-manager/scan-policy-api.ts";

interface Seen {
  method: string;
  url: string;
  idempotencyKey: string | null;
  body: unknown;
}

const INITIAL: ScanPolicySettings = {
  policy: { tier: "extended", suspiciousScoreFloor: 75 },
  flaggedTreatment: "block",
  stepUpReauthOnFlagged: false,
};

function fakeServer(initial: ScanPolicySettings = INITIAL, patchStatus = 200) {
  let settings: ScanPolicySettings = structuredClone(initial);
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    seen.push({ method, url, idempotencyKey: headers.get("Idempotency-Key"), body });
    if (method === "PATCH") {
      if (patchStatus !== 200) {
        return new Response(
          JSON.stringify({ type: "about:blank", title: "Refused", status: patchStatus }),
          { status: patchStatus, headers: { "content-type": "application/problem+json" } },
        );
      }
      settings = { ...settings, ...(body as Partial<ScanPolicySettings>) };
    }
    return new Response(JSON.stringify(settings), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, seen, current: () => settings };
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => `key-${Math.random().toString(36).slice(2)}` });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the scan policy draft", () => {
  it("answers from the firm's own read, and is not loaded before it", async () => {
    const server = fakeServer();
    const draft = createScanPolicyDraft(server.fetch);
    expect(draft.loaded).toBe(false);
    await draft.load();
    expect(draft.loaded).toBe(true);
    expect(server.seen[0]).toMatchObject({ method: "GET", url: "/api/v1/firm/scan-policy" });
    expect(draft.value(SCAN_DEPTH)).toBe("extended");
    expect(draft.value(SCORE_FLOOR)).toBe("75");
    expect(draft.value(FLAGGED_TREATMENT)).toBe("block");
    expect(draft.value(STEP_UP)).toBe(false);
    expect(draft.stagedCount).toBe(0);
  });

  it("sends both halves of the policy when only one of them changed", async () => {
    // The wire shape carries the tier and the floor together, so the untouched one rides along at
    // the value the firm currently holds rather than being dropped.
    const server = fakeServer();
    const draft = createScanPolicyDraft(server.fetch);
    await draft.load();
    draft.stage(SCAN_DEPTH, "full");
    await draft.commit();
    expect(server.seen.find((request) => request.method === "PATCH")).toMatchObject({
      body: { policy: { tier: "full", suspiciousScoreFloor: 75 } },
    });
    expect(draft.value(SCAN_DEPTH)).toBe("full");
  });

  it("folds two settings that share one object into a single change", async () => {
    const server = fakeServer();
    const draft = createScanPolicyDraft(server.fetch);
    await draft.load();
    draft.stage(SCAN_DEPTH, "core");
    draft.stage(SCORE_FLOOR, "40");
    expect(draft.stagedCount).toBe(2);
    await draft.commit();
    const patch = server.seen.find((request) => request.method === "PATCH");
    expect(patch?.body).toEqual({ policy: { tier: "core", suspiciousScoreFloor: 40 } });
  });

  it("sends every staged setting in one write", async () => {
    const server = fakeServer();
    const draft = createScanPolicyDraft(server.fetch);
    await draft.load();
    draft.stage(SCAN_DEPTH, "full");
    draft.stage(FLAGGED_TREATMENT, "informed-access");
    draft.stage(STEP_UP, true);
    await draft.commit();
    const patches = server.seen.filter((request) => request.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({
      policy: { tier: "full", suspiciousScoreFloor: 75 },
      flaggedTreatment: "informed-access",
      stepUpReauthOnFlagged: true,
    });
    expect(patches[0]?.idempotencyKey).toMatch(/^key-/);
  });

  it("counts a value staged back to what the firm holds as no change", async () => {
    const draft = createScanPolicyDraft(fakeServer().fetch);
    await draft.load();
    draft.stage(FLAGGED_TREATMENT, "allow-and-flag");
    expect(draft.stagedCount).toBe(1);
    draft.stage(FLAGGED_TREATMENT, "block");
    expect(draft.stagedCount).toBe(0);
  });

  it("asks before loosening what a flagged file may do", async () => {
    // The one consequential setting on the page: the firm deciding a file its own scanner
    // distrusts may be opened.
    const draft = createScanPolicyDraft(fakeServer().fetch);
    await draft.load();
    draft.stage(SCAN_DEPTH, "core");
    expect(draft.requiresConfirm).toBe(false);
    draft.stage(FLAGGED_TREATMENT, "allow-and-flag");
    expect(draft.requiresConfirm).toBe(true);
  });

  it("never sends a threshold outside the server's own bounds", async () => {
    const server = fakeServer();
    const draft = createScanPolicyDraft(server.fetch);
    await draft.load();
    draft.stage(SCORE_FLOOR, "120");
    // Staged, and refused where the Save button is rather than sent and reported back as a 422 —
    // the typing has to be allowed through or the field could not be typed in at all.
    expect(draft.stagedCount).toBe(1);
    expect(draft.saveRefusal).toBe("The suspicion threshold is a whole number from 0 to 100.");
    await draft.commit();
    expect(server.seen.filter((request) => request.method === "PATCH")).toHaveLength(0);

    draft.stage(SCORE_FLOOR, "40");
    expect(draft.saveRefusal).toBeUndefined();
    expect(scoreFloorFromValue("120")).toBeNull();
    expect(scoreFloorFromValue("0")).toBe(0);
    expect(scoreFloorFromValue("100")).toBe(100);
    expect(scoreFloorFromValue(" 40 ")).toBe(40);
    expect(scoreFloorFromValue("4.5")).toBeNull();
    expect(scoreFloorFromValue("")).toBeNull();
  });

  it("keeps the stage when the save is refused, and retries under a new key", async () => {
    const server = fakeServer(INITIAL, 403);
    const draft = createScanPolicyDraft(server.fetch);
    await draft.load();
    draft.stage(STEP_UP, true);
    await draft.commit();
    expect(draft.saveFailure).not.toBeNull();
    expect(draft.stagedCount).toBe(1);
    expect(draft.value(STEP_UP)).toBe(false);

    await draft.commit();
    const keys = server.seen
      .filter((request) => request.method === "PATCH")
      .map((request) => request.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);

    draft.discard();
    expect(draft.stagedCount).toBe(0);
    expect(draft.saveFailure).toBeNull();
  });

  it("saves nothing when nothing is staged", async () => {
    const server = fakeServer();
    const draft = createScanPolicyDraft(server.fetch);
    await draft.load();
    await draft.commit();
    expect(server.seen.filter((request) => request.method === "PATCH")).toHaveLength(0);
  });
});
