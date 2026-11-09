import { env, SELF } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { settleBackgroundWork } from "./support/settle-background-work.ts";
import { backgroundWorkStatus } from "../src/http/deferred-work.ts";
import { confirmationTokenHash, generateConfirmationToken } from "../src/joining-secrets.ts";

// The password a registering visitor now chooses on the form. Registration commits it with the
// account at confirmation, so every body that opens an account-creating door carries one.
const TEST_PASSWORD = "a-sufficiently-long-test-password";

// The barrier that keeps every other file in this suite honest, asserted on directly.
//
// Routes start work that outlives their response, and the environment is torn down as soon as the
// last test in a file returns. A test that reads the response and stops leaves that work running
// into the teardown, where its calls to the test host are closed underneath it and reject into
// nothing. test/support/settle-background-work.ts waits for the worker to go quiet after every test;
// this file is what fails if that stops working — including if it stops working silently, because
// the barrier reading counters that the worker never increments would drain instantly and forever.
//
// So the first assertion is that the barrier can SEE the work at all, and only the second is that it
// waits for it.

function postAnonymous(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      "cf-connecting-ip": "192.0.2.201",
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

it("sees the background work a request starts, and waits for it to finish", async () => {
  const startedBefore = backgroundWorkStatus().started;
  const email = "barrier@example.com";

  const started = await postAnonymous("/api/v1/registrations", {
    role: "foundFirm",
    email,
    name: "Barrier Tester",
    password: TEST_PASSWORD,
    firmName: "Barrier and Company",
  });
  expect(started.status).toBe(202);

  const pending = await env.DB_CONTROL.prepare("SELECT id FROM registration WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  const token = generateConfirmationToken();
  await env.DB_CONTROL.prepare("UPDATE registration SET confirmation_hash = ?2 WHERE id = ?1")
    .bind(pending?.id ?? "", await confirmationTokenHash(token))
    .run();

  // Confirming schedules the request-path sweep behind the response — the longest-running piece of
  // background work this worker starts.
  const confirmed = await postAnonymous("/api/v1/registrations/confirmations", { token });
  expect(confirmed.status).toBe(200);

  // The counter is the worker's, read from the test: if this fails, the barrier is looking at a
  // different copy of the module than the worker is incrementing, and every wait it performs is
  // vacuous.
  expect(backgroundWorkStatus().started).toBeGreaterThan(startedBefore);

  await settleBackgroundWork();
  expect(backgroundWorkStatus().inFlight).toBe(0);
});
