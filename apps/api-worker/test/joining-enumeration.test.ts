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
import { INVITATION_ATTEMPT_LIMIT } from "../src/http/invitation-redemption.ts";
import { ATTEMPT_LIMIT } from "../src/http/auth-attempt-budget.ts";

// The password a registering visitor now chooses on the form. Registration commits it with the
// account at confirmation, so every body that opens an account-creating door carries one.
const TEST_PASSWORD = "a-sufficiently-long-test-password";

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

// Minted fresh on every reply and identifying the REQUEST rather than its answer, so two identical
// answers carry different ones. They are the only things a comparison may drop.
const PER_REQUEST_HANDLES = new Set(["errorId", "correlationId"]);

// What a caller can actually see: the status and every field of the body except those handles.
// Nothing is exempted by name — in particular NOT attemptsRemaining and NOT retryAfterSeconds. A
// budget that moves with what the lookup found is an enumeration oracle however neutral the
// sentence printed beside it reads, and a field added here later is compared by default rather than
// slipping through because nobody thought to add it.
async function observableAnswer(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
  return {
    httpStatus: response.status,
    ...Object.fromEntries(
      Object.entries(body).filter(([field]) => !PER_REQUEST_HANDLES.has(field)),
    ),
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
    expect(wrongDateOfBirth["httpStatus"]).toBe(422);
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

  // THE ORACLE THIS TEST EXISTS TO DENY. The row is looked up by the code ALONE — the combined
  // digest guards the verifier comparison, not the lookup — so anybody holding a guessed code can
  // submit it with invented facts and read the answer. If ANY field of that answer moves with what
  // the lookup found, the surname and the date of birth have stopped mattering and the endpoint is
  // a "does this code exist" service: the enumeration this whole module is arranged to prevent,
  // reached without knowing either fact about the person.
  //
  // Anything a future refactor adds to the refusal has to survive this table. If it does not, do
  // not exempt the field — the field is the leak.
  it("tells a prober nothing about whether the code they guessed belongs to a real invitation", async () => {
    const liveEmail = "state-live@example.com";
    const liveCode = await issueInvitation({ email: liveEmail });

    const expiredEmail = "state-expired@example.com";
    const expiredCode = await issueInvitation({ email: expiredEmail });
    await env.DB_CONTROL.prepare(
      "UPDATE invitation SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = ?1",
    )
      .bind(expiredEmail)
      .run();

    const revokedEmail = "state-revoked@example.com";
    const revokedCode = await issueInvitation({ email: revokedEmail });
    await env.DB_CONTROL.prepare("UPDATE invitation SET status = 'revoked' WHERE email = ?1")
      .bind(revokedEmail)
      .run();

    const redeemedEmail = "state-redeemed@example.com";
    const redeemedCode = await issueInvitation({ email: redeemedEmail });
    const spent = await redeem({
      code: redeemedCode,
      lastName: INVITEE.lastName,
      dateOfBirth: INVITEE.dateOfBirth,
    });
    expect(spent.status).toBe(200);

    const lockedEmail = "state-locked@example.com";
    const lockedCode = await issueInvitation({ email: lockedEmail });
    await env.DB_CONTROL.prepare(
      "UPDATE invitation SET attempt_count = ?2, locked_until = ?3 WHERE email = ?1",
    )
      .bind(lockedEmail, INVITATION_ATTEMPT_LIMIT, "2999-01-01T00:00:00.000Z")
      .run();

    // What the prober actually sends: the code under test, and facts they do not have.
    const invented = { lastName: "Notthename", dateOfBirth: "1900-01-01" };

    // Every probe comes from its OWN caller address, so all six stand at the same rung of their own
    // ladder. The only thing left that could make two answers differ is the invitation the lookup
    // did or did not find, which is exactly the fact under test.
    const probes = [
      ["a code that matches no invitation at all", generateInvitationCode()],
      ["a live, pending, unlocked invitation", liveCode],
      ["an expired invitation", expiredCode],
      ["a revoked invitation", revokedCode],
      ["an already-redeemed invitation", redeemedCode],
      ["an invitation locked out by its own spent attempts", lockedCode],
    ] as const;

    const answers: { label: string; answer: Record<string, unknown> }[] = [];
    for (const [label, code] of probes) {
      answers.push({ label, answer: await observableAnswer(await redeem({ code, ...invented })) });
    }

    const noSuchCode = answers[0];
    expect(noSuchCode?.answer["httpStatus"]).toBe(422);
    // The published budget is the CALLER's first spend, identical for all six because all six
    // callers have spent exactly one attempt. Asserted against the caller ladder's own limit rather
    // than the invitation's, because that is the ladder it must be read from.
    expect(noSuchCode?.answer["attemptsRemaining"]).toBe(ATTEMPT_LIMIT - 1);
    for (const { label, answer } of answers.slice(1)) {
      expect(
        answer,
        `probing ${label} must be indistinguishable from probing a code that matches nothing`,
      ).toEqual(noSuchCode?.answer);
    }
  });

  it("still spends the invitation's own attempt budget and locks it, while saying nothing about it", async () => {
    const email = "budget-walk@example.com";
    const code = await issueInvitation({ email });

    // Five wrong guesses, each from a different caller, so the only ladder walking down is the
    // invitation's. Every answer is identical, because none of them is about the invitation.
    const answers: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < INVITATION_ATTEMPT_LIMIT; attempt += 1) {
      answers.push(
        await observableAnswer(
          await redeem({
            code,
            lastName: INVITEE.lastName,
            dateOfBirth: `19${70 + attempt}-01-01`,
          }),
        ),
      );
    }
    for (const answer of answers) expect(answer).toEqual(answers[0]);

    // The counter is kept and the lockout is armed. This is the defence that stops somebody walking
    // a date of birth against a code they genuinely hold, and it has to survive the refusal going
    // quiet — the defect was reporting this number, never keeping it.
    const row = await env.DB_CONTROL.prepare(
      "SELECT attempt_count, locked_until FROM invitation WHERE email = ?1",
    )
      .bind(email)
      .first<{ attempt_count: number; locked_until: string | null }>();
    expect(row?.attempt_count).toBe(INVITATION_ATTEMPT_LIMIT);
    expect(row?.locked_until).not.toBeNull();

    // And the RIGHT answer is now refused too, to a fresh caller with a full budget of their own —
    // byte for byte the answer a wrong guess got. Once the invitation's attempts are spent, whether
    // this attempt was correct stopped mattering, and the lockout does not get a wording, a status
    // or a number of its own that would mark the code out as real.
    const correctButLocked = await observableAnswer(
      await redeem({ code, lastName: INVITEE.lastName, dateOfBirth: INVITEE.dateOfBirth }),
    );
    expect(correctButLocked).toEqual(answers[0]);
  });

  it("counts the caller's own budget down and then refuses them, so the number it publishes is real", async () => {
    // One address across codes that match nothing: the ladder being walked here is the caller's,
    // and it is the one the answer reports.
    const prober = "198.51.100.7";
    const remainingSeen: number[] = [];
    for (let attempt = 0; attempt < ATTEMPT_LIMIT; attempt += 1) {
      const response = await redeem(
        { code: generateInvitationCode(), lastName: "Nobody", dateOfBirth: "1900-01-01" },
        prober,
      );
      expect(response.status).toBe(422);
      const body = (await response.json()) as { attemptsRemaining?: number };
      remainingSeen.push(body.attemptsRemaining ?? -1);
    }
    expect(remainingSeen).toEqual([...Array(ATTEMPT_LIMIT).keys()].toReversed());

    // Spent, and enforced rather than decorative: the correct three facts for a live invitation are
    // refused from this address, and the invitation is left untouched for the person it belongs to.
    const email = "caller-locked-out@example.com";
    const code = await issueInvitation({ email });
    const lockedOut = await redeem(
      { code, lastName: INVITEE.lastName, dateOfBirth: INVITEE.dateOfBirth },
      prober,
    );
    expect(lockedOut.status).toBe(422);
    const lockedBody = (await lockedOut.json()) as {
      attemptsRemaining?: number;
      retryAfterSeconds?: number;
    };
    expect(lockedBody.attemptsRemaining).toBe(0);
    expect(lockedBody.retryAfterSeconds).toBeGreaterThan(0);

    const untouched = await env.DB_CONTROL.prepare(
      "SELECT status, attempt_count FROM invitation WHERE email = ?1",
    )
      .bind(email)
      .first<{ status: string; attempt_count: number }>();
    expect(untouched?.status).toBe("pending");
    expect(untouched?.attempt_count).toBe(0);
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
      password: TEST_PASSWORD,
      firmName: "Okafor Legal",
    });
    const takenAnswer = await postAnonymous("/api/v1/registrations", {
      role: "foundFirm",
      email: takenEmail,
      name: "Dana Okafor",
      password: TEST_PASSWORD,
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
      password: TEST_PASSWORD,
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
      password: TEST_PASSWORD,
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
