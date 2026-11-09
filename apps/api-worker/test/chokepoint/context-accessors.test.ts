// Slice 0·5b hardening: the fail-closed chokepoint-context accessors. The chokepoint stashes the
// tenancy variables (chokepointUserId / chokepointFirmId / chokepointFirmContext) only on the
// non-public, session-present path. The context-variable TYPES declare them non-optional, so a
// future app-surface route mistakenly authored authenticated: false would let the session-null path
// reach a handler that trusts `undefined` tenancy. These accessors convert that latent
// undefined-trust into a loud throw (→ Hono default 500, fail-closed). The current routes never hit
// the throw — the latent case is contrived to trigger — so a focused unit test on the accessor
// reading a context WITHOUT the vars set is sufficient.
import { Hono } from "hono";
import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../src/http/chokepoint/context-accessors";
import type { AppVariables, FirmContext } from "../../src/http/chokepoint/ports";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";

type AppContext = Context<{ Variables: AppVariables }>;

// Runs `read` inside a real Hono request context whose Variables have NOT been populated by the
// chokepoint — the contrived authenticated: false fall-through. Returns the captured context so the
// caller asserts the accessor's behavior against it.
async function withUnpopulatedContext(read: (c: AppContext) => void): Promise<void> {
  const app = new Hono<{ Variables: AppVariables }>();
  let thrown: unknown;
  app.get("/probe", (c) => {
    try {
      read(c as AppContext);
    } catch (caught) {
      thrown = caught;
    }
    return c.json({ ok: true });
  });
  await app.request("/probe");
  if (thrown !== undefined) throw thrown;
}

// A context WHOSE vars ARE set: proves the accessor returns the stashed value on the happy path.
async function withPopulatedContext<T>(
  read: (c: AppContext) => T,
  vars: Partial<AppVariables>,
): Promise<T> {
  const app = new Hono<{ Variables: AppVariables }>();
  let captured: T;
  app.get("/probe", (c) => {
    for (const [key, value] of Object.entries(vars)) {
      c.set(key as keyof AppVariables, value as never);
    }
    captured = read(c as AppContext);
    return c.json({ ok: true });
  });
  await app.request("/probe");
  return captured!;
}

const FIRM = "firm_test0000000000000" as FirmId;
const USER = "user_test0000000000000" as UserId;
const FIRM_CONTEXT = {
  firmDatabase: {} as FirmContext["firmDatabase"],
  migrationState: () =>
    Promise.resolve({
      fault: null,
      appliedCount: 0,
      appliedHead: null,
      outOfOrderArrivals: [],
      restorePoint: null,
    }),
  readFirmName: () => Promise.resolve("Test Firm"),
  bucketName: "test-firm-bucket",
} satisfies FirmContext;

describe("chokepoint context accessors — fail closed when the populated-context invariant is broken", () => {
  it("requireChokepointUserId throws when the var is unset", async () => {
    await expect(withUnpopulatedContext((c) => requireChokepointUserId(c))).rejects.toThrow(
      /chokepointUserId.*undefined/,
    );
  });

  it("requireChokepointFirmId throws when the var is unset", async () => {
    await expect(withUnpopulatedContext((c) => requireChokepointFirmId(c))).rejects.toThrow(
      /chokepointFirmId.*undefined/,
    );
  });

  it("requireChokepointFirmContext throws when the var is unset", async () => {
    await expect(withUnpopulatedContext((c) => requireChokepointFirmContext(c))).rejects.toThrow(
      /chokepointFirmContext.*undefined/,
    );
  });

  it("returns the stashed values on the populated (chokepoint-passed) path", async () => {
    expect(
      await withPopulatedContext((c) => requireChokepointUserId(c), { chokepointUserId: USER }),
    ).toBe(USER);
    expect(
      await withPopulatedContext((c) => requireChokepointFirmId(c), { chokepointFirmId: FIRM }),
    ).toBe(FIRM);
    expect(
      await withPopulatedContext((c) => requireChokepointFirmContext(c), {
        chokepointFirmContext: FIRM_CONTEXT,
      }),
    ).toBe(FIRM_CONTEXT);
  });
});
