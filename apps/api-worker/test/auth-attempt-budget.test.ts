import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { BUCKETS } from "../src/http/chokepoint/rate-limiter.ts";
import { PASSWORD, seedCredentialedUser, seedFirm } from "./support/test-auth.ts";
import {
  ATTEMPTS_REMAINING_HEADER,
  ATTEMPT_LIMIT,
  ATTEMPT_LIMIT_HEADER,
  LOCKOUT_SECONDS,
  LOCKOUT_SECONDS_HEADER,
  createAttemptLadder,
  isCredentialAttemptPath,
} from "../src/http/auth-attempt-budget.ts";

// The gap this closes, stated as the screens state it: the sign-in surface renders a
// remaining-attempts line and a lockout countdown, and until now the server published neither, so
// the ladder was modelled on the client and left unwired rather than fed an invented number. These
// tests are what let it be wired — they pin that the numbers exist, that they count down, and that
// they are the SAME budget however the visitor is asked to prove who they are.

let poolFirmId: FirmId;
const SIGN_IN_EMAIL = "budget-signin@example.com";

let nextClientAddress = 0;
function freshClientAddress(): string {
  nextClientAddress += 1;
  return `198.51.100.${nextClientAddress % 250}`;
}

function signInAttempt(email: string, password: string, clientAddress: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      "cf-connecting-ip": clientAddress,
    },
    body: JSON.stringify({ email, password }),
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Attempt Budget Firm" })).firmId;
  await seedCredentialedUser(SIGN_IN_EMAIL, { firmId: poolFirmId });
});

describe("the ladder itself", () => {
  it("counts down, locks at the limit, and reports the countdown", () => {
    let clock = 1_000_000;
    const ladder = createAttemptLadder({ now: () => clock });

    expect(ladder.read("ip:a")).toEqual({
      limit: ATTEMPT_LIMIT,
      remaining: ATTEMPT_LIMIT,
      lockoutSecondsRemaining: null,
    });

    const remainingSeen: number[] = [];
    for (let attempt = 0; attempt < ATTEMPT_LIMIT; attempt += 1) {
      remainingSeen.push(ladder.spend("ip:a").remaining);
    }
    // Derived from the limit rather than written out: the claim is that every spend takes exactly
    // one and the last one lands on zero, which is true at any limit.
    expect(remainingSeen).toEqual(
      Array.from({ length: ATTEMPT_LIMIT }, (_unused, index) => ATTEMPT_LIMIT - index - 1),
    );
    expect(ladder.read("ip:a").lockoutSecondsRemaining).toBe(LOCKOUT_SECONDS);

    // The countdown is a real countdown, not a constant: the screen renders it against a clock.
    clock += 60_000;
    expect(ladder.read("ip:a").lockoutSecondsRemaining).toBe(LOCKOUT_SECONDS - 60);

    // And it lifts on its own. A lockout that needed an operator to clear it would make a mistyped
    // password a support ticket.
    clock += LOCKOUT_SECONDS * 1000;
    expect(ladder.read("ip:a")).toEqual({
      limit: ATTEMPT_LIMIT,
      remaining: ATTEMPT_LIMIT,
      lockoutSecondsRemaining: null,
    });
  });

  it("keeps one client's failures away from another's", () => {
    const ladder = createAttemptLadder();
    ladder.spend("ip:a");
    ladder.spend("ip:a");
    expect(ladder.read("ip:a").remaining).toBe(ATTEMPT_LIMIT - 2);
    expect(ladder.read("ip:b").remaining).toBe(ATTEMPT_LIMIT);
  });

  it("clears on a credential that worked", () => {
    const ladder = createAttemptLadder();
    ladder.spend("ip:a");
    ladder.spend("ip:a");
    ladder.clear("ip:a");
    expect(ladder.read("ip:a").remaining).toBe(ATTEMPT_LIMIT);
  });

  it("ages a stray failure out rather than accumulating it over a working day", () => {
    let clock = 1_000_000;
    const ladder = createAttemptLadder({ now: () => clock });
    ladder.spend("ip:a");
    ladder.spend("ip:a");
    clock += 20 * 60 * 1000;
    expect(ladder.read("ip:a").remaining).toBe(ATTEMPT_LIMIT);
  });

  it("charges only the endpoints that actually present a credential", () => {
    // The ones that do.
    expect(isCredentialAttemptPath("/api/auth/sign-in/email")).toBe(true);
    expect(isCredentialAttemptPath("/api/auth/two-factor/verify-totp")).toBe(true);
    expect(isCredentialAttemptPath("/api/auth/two-factor/verify-backup-code")).toBe(true);
    // The ones that do NOT. A session read is the call an open tab makes on every navigation;
    // charging it would lock somebody out of the app they are already signed in to.
    expect(isCredentialAttemptPath("/api/auth/get-session")).toBe(false);
    expect(isCredentialAttemptPath("/api/auth/sign-out")).toBe(false);
    expect(isCredentialAttemptPath("/api/auth/request-password-reset")).toBe(false);
    expect(isCredentialAttemptPath("/api/auth/two-factor/enable")).toBe(false);
  });
});

describe("the budget on the wire", () => {
  it("publishes the budget on a rejected sign-in and counts it down", async () => {
    const clientAddress = freshClientAddress();

    const first = await signInAttempt(SIGN_IN_EMAIL, "not-the-password", clientAddress);
    expect(first.status).toBeGreaterThanOrEqual(400);
    expect(first.headers.get(ATTEMPT_LIMIT_HEADER)).toBe(String(ATTEMPT_LIMIT));
    expect(first.headers.get(ATTEMPTS_REMAINING_HEADER)).toBe(String(ATTEMPT_LIMIT - 1));

    const second = await signInAttempt(SIGN_IN_EMAIL, "still-not-it", clientAddress);
    expect(second.headers.get(ATTEMPTS_REMAINING_HEADER)).toBe(String(ATTEMPT_LIMIT - 2));
  });

  it("locks out at the limit and refuses even the right password while it stands", async () => {
    const clientAddress = freshClientAddress();
    for (let attempt = 0; attempt < ATTEMPT_LIMIT; attempt += 1) {
      await signInAttempt(SIGN_IN_EMAIL, `wrong-${attempt}`, clientAddress);
    }

    const lockedOut = await signInAttempt(SIGN_IN_EMAIL, PASSWORD, clientAddress);
    expect(lockedOut.status).toBe(429);
    expect(lockedOut.headers.get(ATTEMPTS_REMAINING_HEADER)).toBe("0");
    expect(Number(lockedOut.headers.get(LOCKOUT_SECONDS_HEADER))).toBeGreaterThan(0);
    // Retry-After is the standard header a client already honours; the lockout header is the one
    // the screen renders a countdown from. Both, so neither kind of consumer has to special-case.
    expect(Number(lockedOut.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await lockedOut.json()) as { lockoutSecondsRemaining?: number };
    expect(body.lockoutSecondsRemaining).toBeGreaterThan(0);
  });

  it("spends nothing on a correct password, and restores the full budget", async () => {
    const clientAddress = freshClientAddress();
    await signInAttempt(SIGN_IN_EMAIL, "one-wrong-guess", clientAddress);

    const success = await signInAttempt(SIGN_IN_EMAIL, PASSWORD, clientAddress);
    expect(success.status).toBe(200);
    // A credential that worked clears the ladder: the visitor proved who they were, and carrying
    // their earlier typo forward would punish the right person for the wrong reason.
    expect(success.headers.get(ATTEMPTS_REMAINING_HEADER)).toBe(String(ATTEMPT_LIMIT));
  });

  it("keeps one visitor's ladder off another's", async () => {
    const victim = freshClientAddress();
    const attacker = freshClientAddress();
    for (let attempt = 0; attempt < ATTEMPT_LIMIT; attempt += 1) {
      await signInAttempt(SIGN_IN_EMAIL, `wrong-${attempt}`, attacker);
    }
    // The budget is keyed on the caller, never on the address being TRIED — otherwise anyone could
    // lock a colleague out of their own firm by failing five sign-ins against their email, and the
    // ladder itself would report which addresses have one in progress.
    const unaffected = await signInAttempt(SIGN_IN_EMAIL, PASSWORD, victim);
    expect(unaffected.status).toBe(200);
  });

  it("puts the same budget on the chokepoint's own throttle reply", async () => {
    const clientAddress = freshClientAddress();
    let throttled: Response | undefined;
    // Walk past the auth bucket on one address. The count comes from the bucket itself rather than
    // a number written here: the bucket sits above the credential ladder on purpose, so a literal
    // would silently stop reaching the throttle the day either of them moves.
    for (let attempt = 0; attempt < BUCKETS.auth.limit + 2; attempt += 1) {
      const response = await SELF.fetch("https://example.com/api/v1/registrations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          "cf-connecting-ip": clientAddress,
        },
        body: JSON.stringify({ role: "clientOfFirm", email: "x@example.com", name: "X" }),
      });
      if (response.status === 429) {
        throttled = response;
        break;
      }
    }
    expect(throttled).toBeDefined();
    const body = (await throttled?.json()) as {
      attemptsRemaining?: number;
      retryAfterSeconds?: number;
    };
    // The 429 that "carried no budget" now carries one, in the body as well as the header — a
    // client reads one shape whether it was throttled on the auth surface or on /api/v1.
    expect(body.attemptsRemaining).toBe(0);
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(throttled?.headers.get("retry-after")).not.toBeNull();
  });
});
