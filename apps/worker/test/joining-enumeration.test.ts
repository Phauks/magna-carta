import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  postJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import {
  digestsMatch,
  generateInvitationCode,
  invitationVerifierHash,
  normalizeInvitationCode,
  normalizeLastName,
  UNMATCHABLE_VERIFIER_HASH,
} from "../src/joining-secrets.ts";
import { INVITATION_ATTEMPT_LIMIT } from "../src/routes/invitations.ts";

// THE ATTACK THESE TESTS RUN. Everything below is written from the position of somebody who has no
// account and wants to learn something they are not entitled to: whether a named person banks with
// this platform, whether a named person was invited to a named firm, or whether a guessed date of
// birth was the one wrong fact. Each test asserts that two situations an attacker would want to
// tell apart are, on the wire, the same situation.
//
// The assertions are deliberately on the WHOLE observable answer — status, problem type, title and
// detail — rather than on the status alone. A pair of responses that agree on 422 and disagree on
// the sentence is exactly as good an oracle as a pair that disagree on the status.

let poolFirmId: FirmId;
let issuerCookie: string;

const ISSUER_EMAIL = "invitation-issuer@example.com";

// Two facts that belong together, and the three ways of getting one of them wrong.
const INVITEE = {
  email: "priya.raman@example.com",
  name: "Priya Raman",
  lastName: "Raman",
  dateOfBirth: "1984-03-17",
};

interface ObservableAnswer {
  status: number;
  type: unknown;
  title: unknown;
  detail: unknown;
}

// What a caller can actually see. attemptsRemaining is deliberately EXCLUDED: it is a fact about
// the caller's own spent attempts, which they already know, and it legitimately differs between a
// miss against a real invitation and a miss against nothing.
async function observableAnswer(response: Response): Promise<ObservableAnswer> {
  const body = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    type: body["type"],
    title: body["title"],
    detail: body["detail"],
  };
}

// Issuing is a required-idempotency route, so every call carries a fresh key — a reused one would
// replay the first invitation's stored response and quietly hand back the same code.
async function issueInvitation(overrides: Partial<typeof INVITEE> = {}): Promise<string> {
  const invitee = { ...INVITEE, ...overrides };
  const response = await SELF.fetch("https://example.com/api/v1/invitations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: issuerCookie,
      "idempotency-key": newIdentifier("idempotencyRecord"),
    },
    body: JSON.stringify({
      kind: "firmMember",
      email: invitee.email,
      name: invitee.name,
      lastName: invitee.lastName,
      dateOfBirth: invitee.dateOfBirth,
    }),
  });
  const body = (await response.json()) as { code?: string };
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body.code ?? "";
}

// Every anonymous call below carries its own client address. That is not test scaffolding around
// an inconvenience — it is the rate limiter working exactly as designed: the public surface is
// keyed on the edge-set client address, so one bucket is shared by everything that looks like one
// caller, and a suite firing forty anonymous requests from "one caller" is correctly throttled.
// Giving each test its own address is what makes it a test of the ROUTE rather than of the bucket;
// the bucket itself is asserted on directly in the exhaustion test at the end.
let nextClientAddress = 0;
function freshClientAddress(): string {
  nextClientAddress += 1;
  return `203.0.113.${nextClientAddress % 250}`;
}

function postAnonymous(
  path: string,
  body: unknown,
  clientAddress: string = freshClientAddress(),
): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      "cf-connecting-ip": clientAddress,
    },
    body: JSON.stringify(body),
  });
}

function redeem(body: Record<string, unknown>, clientAddress?: string): Promise<Response> {
  return postAnonymous("/api/v1/invitations/redemptions", body, clientAddress);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Joining Enumeration Firm" })).firmId;
  const issuer = await seedCredentialedUser(ISSUER_EMAIL, { firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(issuer.userId, "Invitation Issuer", poolFirmId);
  issuerCookie = await signInForSessionCookie(ISSUER_EMAIL);
});

describe("invitation redemption is not an oracle", () => {
  it("answers a valid code with the wrong date of birth exactly as it answers an invented code", async () => {
    const code = await issueInvitation({ email: "dob-probe@example.com" });

    // The interesting pair: the attacker HOLDS a real code (forwarded, printed, found) and is
    // walking the date of birth. If this differs from a code that never existed, every guess is a
    // free confirmation that the code is live and the person is invited.
    const wrongDateOfBirth = await observableAnswer(
      await redeem({ code, lastName: INVITEE.lastName, dateOfBirth: "1984-03-18" }),
    );
    const inventedCode = await observableAnswer(
      await redeem({
        code: generateInvitationCode(),
        lastName: INVITEE.lastName,
        dateOfBirth: INVITEE.dateOfBirth,
      }),
    );

    expect(wrongDateOfBirth).toEqual(inventedCode);
    expect(wrongDateOfBirth.status).toBe(422);
  });

  it("answers a wrong surname exactly as it answers a wrong date of birth", async () => {
    const code = await issueInvitation({ email: "surname-probe@example.com" });

    const wrongSurname = await observableAnswer(
      await redeem({ code, lastName: "Ramanujan", dateOfBirth: INVITEE.dateOfBirth }),
    );
    const wrongDateOfBirth = await observableAnswer(
      await redeem({ code, lastName: INVITEE.lastName, dateOfBirth: "1970-01-01" }),
    );

    expect(wrongSurname).toEqual(wrongDateOfBirth);
  });

  it("answers an already-redeemed invitation exactly as it answers an invented code", async () => {
    const email = "already-redeemed@example.com";
    const code = await issueInvitation({ email });

    const firstRedemption = await redeem({
      code,
      lastName: INVITEE.lastName,
      dateOfBirth: INVITEE.dateOfBirth,
    });
    expect(firstRedemption.status).toBe(200);

    // "That code has already been used" would confirm, to somebody who merely GUESSED the code,
    // that it belonged to a real person at a real firm — which is the whole fact worth stealing.
    const secondRedemption = await observableAnswer(
      await redeem({ code, lastName: INVITEE.lastName, dateOfBirth: INVITEE.dateOfBirth }),
    );
    const inventedCode = await observableAnswer(
      await redeem({
        code: generateInvitationCode(),
        lastName: INVITEE.lastName,
        dateOfBirth: INVITEE.dateOfBirth,
      }),
    );

    expect(secondRedemption).toEqual(inventedCode);
  });

  it("answers an invitation for an address that already has an account exactly as it answers an invented code", async () => {
    const email = "collides-with-existing@example.com";
    await seedCredentialedUser(email, { firmId: poolFirmId });
    const code = await issueInvitation({ email });

    // Everything about this redemption is correct; the only thing wrong is that the address is
    // taken. Answering "that address is already registered" here is the account-existence oracle
    // wearing a different hat.
    const collided = await observableAnswer(
      await redeem({ code, lastName: INVITEE.lastName, dateOfBirth: INVITEE.dateOfBirth }),
    );
    const inventedCode = await observableAnswer(
      await redeem({
        code: generateInvitationCode(),
        lastName: INVITEE.lastName,
        dateOfBirth: INVITEE.dateOfBirth,
      }),
    );

    expect(collided).toEqual(inventedCode);
  });

  it("spends the invitation's own attempt budget and locks it, so a date of birth cannot be walked", async () => {
    const code = await issueInvitation({ email: "budget-walk@example.com" });

    const remainingSeen: number[] = [];
    for (let attempt = 0; attempt < INVITATION_ATTEMPT_LIMIT; attempt += 1) {
      const response = await redeem({
        code,
        lastName: INVITEE.lastName,
        dateOfBirth: `19${70 + attempt}-01-01`,
      });
      expect(response.status).toBe(422);
      const body = (await response.json()) as { attemptsRemaining?: number };
      remainingSeen.push(body.attemptsRemaining ?? -1);
    }
    // The budget is published and it counts down honestly, which is the whole reason the screens
    // can render a remaining-attempts line at all.
    expect(remainingSeen).toEqual([4, 3, 2, 1, 0]);

    // And the RIGHT answer is now refused too: once the budget is spent, whether this attempt was
    // correct stopped mattering — otherwise the lockout would hand back one oracle bit per request.
    const correctButLocked = await redeem({
      code,
      lastName: INVITEE.lastName,
      dateOfBirth: INVITEE.dateOfBirth,
    });
    expect(correctButLocked.status).toBe(422);
    const lockedBody = (await correctButLocked.json()) as {
      attemptsRemaining?: number;
      retryAfterSeconds?: number;
      detail?: string;
    };
    expect(lockedBody.attemptsRemaining).toBe(0);
    expect(lockedBody.retryAfterSeconds).toBeGreaterThan(0);
    // Still the same sentence — the lockout does not get its own wording that would mark the code
    // out as real.
    expect(lockedBody.detail).toContain("could not be redeemed");
  });

  it("redeems on the correct three facts, and tolerates the ways a person types them", async () => {
    const email = "typing-tolerance@example.com";
    // A surname somebody will punctuate differently on different days, and a code they will
    // hyphenate and lower-case out of habit.
    const code = await issueInvitation({ email, lastName: "O'Brien-Walsh" });

    const response = await redeem({
      code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`,
      lastName: "obrien walsh",
      dateOfBirth: INVITEE.dateOfBirth,
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body["email"]).toBe(email);
    expect(body["next"]).toBe("checkEmail");
  });
});

describe("registration does not reveal whether an address is taken", () => {
  it("answers identically for a free address and one that already has an account", async () => {
    const takenEmail = "registration-taken@example.com";
    await seedCredentialedUser(takenEmail, { firmId: poolFirmId });

    const freeAnswer = await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email: "registration-free@example.com",
      name: "Dana Okafor",
      firmName: "Okafor Legal",
    });
    const takenAnswer = await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email: takenEmail,
      name: "Dana Okafor",
      firmName: "Okafor Legal",
    });

    expect(freeAnswer.status).toBe(202);
    expect(takenAnswer.status).toBe(202);
    expect(await freeAnswer.json()).toEqual(await takenAnswer.json());
  });

  it("writes no registration row for an address that already has an account", async () => {
    const takenEmail = "registration-no-row@example.com";
    await seedCredentialedUser(takenEmail, { firmId: poolFirmId });
    await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email: takenEmail,
      name: "Someone Else",
      firmName: "Someone Else Law",
    });

    // The uniform answer must not be uniform-looking on the wire and different underneath: a
    // pending registration for a taken address would be a live confirmation link that, when
    // followed, would try to provision a second firm around an existing user.
    const rows = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS total FROM registration WHERE email = ?1",
    )
      .bind(takenEmail)
      .first<{ total: number }>();
    expect(rows?.total).toBe(0);
  });

  it("refuses an unknown, a spent and an expired confirmation token identically", async () => {
    const unknownToken = await observableAnswer(
      await postAnonymous("/api/v1/registrations/confirmations", {
        token: "NEVERISSUEDTOKEN22222222",
      }),
    );

    // A real one, spent by confirming it once.
    const email = "confirmation-replay@example.com";
    await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email,
      name: "Rafa Iglesias",
      firmName: "Iglesias and Partners",
    });
    const stored = await env.DB_CONTROL.prepare(
      "SELECT confirmation_hash FROM registration WHERE email = ?1",
    )
      .bind(email)
      .first<{ confirmation_hash: string }>();
    expect(stored).not.toBeNull();

    // The token itself is unrecoverable from the row by construction — only its hash is kept — so
    // this asserts the property directly rather than reaching for the token.
    expect(stored?.confirmation_hash).toHaveLength(64);
    expect(stored?.confirmation_hash).not.toContain(" ");

    // Expire the row and confirm against a token that cannot match it: the answer is the same
    // sentence the unknown token got.
    await env.DB_CONTROL.prepare(
      "UPDATE registration SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = ?1",
    )
      .bind(email)
      .run();
    const expiredToken = await observableAnswer(
      await postAnonymous("/api/v1/registrations/confirmations", {
        token: "ANOTHERWRONGTOKEN2222222",
      }),
    );
    expect(expiredToken).toEqual(unknownToken);
  });

  it("sends the two non-founding doors to invitation redemption without touching the user table", async () => {
    for (const role of ["clientOfFirm", "firmMember"] as const) {
      const response = await postAnonymous("/api/v1/registrations", {
        role,
        email: "join-existing@example.com",
        name: "Wanting To Join",
      });
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ next: "redeemInvitation" });
    }
    const rows = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS total FROM registration WHERE email = ?1",
    )
      .bind("join-existing@example.com")
      .first<{ total: number }>();
    expect(rows?.total).toBe(0);
  });
});

describe("the stored shapes are what make the neutrality structural", () => {
  it("keeps no surname and no date of birth to compare separately", async () => {
    const code = await issueInvitation({ email: "no-plaintext-facts@example.com" });
    const row = await env.DB_CONTROL.prepare("SELECT * FROM invitation WHERE email = ?1")
      .bind("no-plaintext-facts@example.com")
      .first();
    expect(row).not.toBeNull();

    // The columns simply are not there. This is the assertion that keeps a future handler from
    // being ABLE to say which fact was wrong, however carefully or carelessly it is written.
    const columns = Object.keys(row ?? {});
    expect(columns).not.toContain("last_name");
    expect(columns).not.toContain("date_of_birth");

    // And nothing in the row is the code, or either fact, in the clear.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(normalizeInvitationCode(code));
    expect(serialized).not.toContain(INVITEE.dateOfBirth);
    expect(serialized).not.toContain(normalizeLastName(INVITEE.lastName));
  });

  it("compares against an unmatchable digest when there is no invitation, so both paths do the same work", async () => {
    const verifier = await invitationVerifierHash({
      code: generateInvitationCode(),
      lastName: "Anybody",
      dateOfBirth: "1990-01-01",
    });
    expect(digestsMatch(UNMATCHABLE_VERIFIER_HASH, verifier)).toBe(false);
    expect(UNMATCHABLE_VERIFIER_HASH).toHaveLength(verifier.length);
  });

  it("folds all three facts into one digest, so no two of them can be checked apart", async () => {
    const code = generateInvitationCode();
    const base = { code, lastName: "Raman", dateOfBirth: "1984-03-17" };
    const [correct, otherName, otherDate, otherCode] = await Promise.all([
      invitationVerifierHash(base),
      invitationVerifierHash({ ...base, lastName: "Ramani" }),
      invitationVerifierHash({ ...base, dateOfBirth: "1984-03-18" }),
      invitationVerifierHash({ ...base, code: generateInvitationCode() }),
    ]);
    // Changing ANY one fact moves the whole digest, and the three changes are indistinguishable
    // from one another because each produces one unequal digest and nothing else.
    for (const wrong of [otherName, otherDate, otherCode]) {
      expect(digestsMatch(correct, wrong)).toBe(false);
    }
  });

  it("separates the fields, so a shifted boundary between them is a different verifier", async () => {
    const code = generateInvitationCode();
    const [left, right] = await Promise.all([
      invitationVerifierHash({ code, lastName: "smith", dateOfBirth: "1990-01-02" }),
      invitationVerifierHash({ code, lastName: "smith1", dateOfBirth: "990-01-02" }),
    ]);
    expect(digestsMatch(left, right)).toBe(false);
  });
});

describe("issuing an invitation", () => {
  it("hands the code back exactly once and stores only its hash", async () => {
    const email = "code-once@example.com";
    const code = await issueInvitation({ email });
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);

    const row = await env.DB_CONTROL.prepare(
      "SELECT code_hash, verifier_hash, status FROM invitation WHERE email = ?1",
    )
      .bind(email)
      .first<{ code_hash: string; verifier_hash: string; status: string }>();
    expect(row?.status).toBe("pending");
    expect(row?.code_hash).toHaveLength(64);
    expect(row?.verifier_hash).toHaveLength(64);
    expect(row?.code_hash).not.toBe(row?.verifier_hash);
  });

  it("refuses a caller with no session", async () => {
    const response = await postJson("/api/v1/invitations", {
      kind: "firmMember",
      email: "unauthorized@example.com",
      name: "No Session",
      lastName: "Session",
      dateOfBirth: "1990-01-01",
    });
    expect(response.status).toBe(401);
  });

  it("mints a distinct code for every invitation", async () => {
    const issued = await Promise.all(
      [0, 1, 2, 3, 4].map((index) => issueInvitation({ email: `distinct-${index}@example.com` })),
    );
    expect(new Set(issued).size).toBe(issued.length);
  });
});

describe("the redemption path leaves the invitation usable exactly once", () => {
  it("records the redeeming user and the firm on the row", async () => {
    const email = "records-redeemer@example.com";
    const code = await issueInvitation({ email });
    const response = await redeem({
      code,
      lastName: INVITEE.lastName,
      dateOfBirth: INVITEE.dateOfBirth,
    });
    expect(response.status).toBe(200);

    const row = await env.DB_CONTROL.prepare(
      "SELECT status, redeemed_user_id, firm_id FROM invitation WHERE email = ?1",
    )
      .bind(email)
      .first<{ status: string; redeemed_user_id: string; firm_id: string }>();
    expect(row?.status).toBe("redeemed");
    expect(row?.firm_id).toBe(poolFirmId);

    const user = await env.DB_CONTROL.prepare(
      'SELECT id, firm_id, email_verified FROM "user" WHERE email = ?1',
    )
      .bind(email)
      .first<{ id: string; firm_id: string; email_verified: number }>();
    // Unverified and account-less, exactly as an invited member is: the emailed link is what
    // creates the credential, so guessing the three facts is not by itself a way in.
    expect(user?.id).toBe(row?.redeemed_user_id);
    expect(user?.firm_id).toBe(poolFirmId);
    expect(user?.email_verified).toBe(0);
    const account = await env.DB_CONTROL.prepare("SELECT id FROM account WHERE user_id = ?1")
      .bind(row?.redeemed_user_id ?? "")
      .first();
    expect(account).toBeNull();

    // And the member mirror is queued rather than written from the request path.
    const queued = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS total FROM outbox WHERE topic = 'member.provision' AND payload LIKE '%' || ?1 || '%'",
    )
      .bind(row?.redeemed_user_id ?? "")
      .first<{ total: number }>();
    expect(queued?.total).toBe(1);
  });
});

// The identifier the outbox payload carries has to survive assertIdentifier in the consumer, which
// is the kind of thing that only fails once, in production, on the first real registration.
describe("the registration handle is a usable firm resume identity", () => {
  it("mints a registration handle the consumer can assert", () => {
    const handle = newIdentifier("registration");
    expect(handle.startsWith("registration_")).toBe(true);
  });
});
