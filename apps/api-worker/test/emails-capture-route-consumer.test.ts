import { env } from "cloudflare:test";
import { findEmailCaptureRouteByToken } from "@magna-carta/data-access/email-capture-route-statements";
import { newCaptureToken } from "@magna-carta/email-filing/capture-token";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import {
  consumeCaptureRouteRegistration,
  parseCaptureRouteRegistrationPayload,
} from "../src/background/emails/capture-route-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

// The relay half of a capture-address mint, exercised directly against the real control-plane D1.
// The relay is at-least-once and its sweeps may overlap, so what matters here is what the handler
// does the SECOND time it sees a message — and what it refuses to do when the token is not its own.

const NOW = "2026-08-04T00:00:00.000Z";

let firmId: FirmId;
let otherFirmId: FirmId;

function contextFor(id: FirmId) {
  return { controlPlaneDatabase: env.DB_CONTROL, firmId: id, now: () => NOW };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Capture Route Consumer Firm" })).firmId;
  otherFirmId = (await seedFirm({ name: "Capture Route Consumer Other Firm" })).firmId;
});

describe("capture-route registration consumer", () => {
  it("writes the routing row, and a redelivery changes nothing", async () => {
    const token = newCaptureToken();
    const payload = JSON.stringify({ token, firmId });

    await consumeCaptureRouteRegistration(contextFor(firmId), "outbox_first", payload);
    expect(await findEmailCaptureRouteByToken(env.DB_CONTROL, token)).toEqual({
      token,
      firmId,
      active: true,
    });

    // At-least-once: the same message again must be a no-op, not a second row or an error.
    await consumeCaptureRouteRegistration(contextFor(firmId), "outbox_first", payload);
    const { results } = await env.DB_CONTROL.prepare(
      "SELECT token FROM email_capture_route WHERE token = ?1",
    )
      .bind(token)
      .all<{ token: string }>();
    expect(results).toHaveLength(1);
  });

  it("never resurrects a token the firm has since revoked", async () => {
    const token = newCaptureToken();
    const payload = JSON.stringify({ token, firmId });
    await consumeCaptureRouteRegistration(contextFor(firmId), "outbox_revoked", payload);
    await env.DB_CONTROL.prepare(
      "UPDATE email_capture_route SET active = 0, revoked_at = ?1 WHERE token = ?2",
    )
      .bind(NOW, token)
      .run();

    // A redelivery arriving after the revoke must leave it revoked — a mint message can never undo a
    // revocation that came later.
    await consumeCaptureRouteRegistration(contextFor(firmId), "outbox_revoked", payload);
    expect((await findEmailCaptureRouteByToken(env.DB_CONTROL, token))?.active).toBe(false);
  });

  it("refuses a token that already routes to another firm rather than adopting it", async () => {
    const token = newCaptureToken();
    await consumeCaptureRouteRegistration(
      contextFor(otherFirmId),
      "outbox_other",
      JSON.stringify({ token, firmId: otherFirmId }),
    );
    await expect(
      consumeCaptureRouteRegistration(
        contextFor(firmId),
        "outbox_collide",
        JSON.stringify({ token, firmId }),
      ),
    ).rejects.toThrow(/already routes to another firm/);
    // The other firm's route is untouched.
    expect((await findEmailCaptureRouteByToken(env.DB_CONTROL, token))?.firmId).toBe(otherFirmId);
  });

  it("refuses a payload whose firm disagrees with the message envelope", async () => {
    const token = newCaptureToken();
    await expect(
      consumeCaptureRouteRegistration(
        contextFor(firmId),
        "outbox_mismatch",
        JSON.stringify({ token, firmId: otherFirmId }),
      ),
    ).rejects.toThrow(/does not match the originating firm/);
    expect(await findEmailCaptureRouteByToken(env.DB_CONTROL, token)).toBeNull();
  });

  it("dead-letters a malformed payload instead of writing a bad routing key", () => {
    const cases = [
      "not json",
      JSON.stringify({ firmId: newIdentifier("firm") }),
      JSON.stringify({ token: "TOO-SHORT", firmId: newIdentifier("firm") }),
      // A token with a character a forwarder could rewrite would never resolve; refuse it here.
      JSON.stringify({ token: `a.${"b".repeat(18)}`, firmId: newIdentifier("firm") }),
      JSON.stringify({ token: newCaptureToken(), firmId: "not-a-firm-handle" }),
    ];
    for (const payload of cases) {
      expect(() => parseCaptureRouteRegistrationPayload("outbox_bad", payload)).toThrow(
        /emailCaptureAddress\.minted outbox_bad/,
      );
    }
  });
});
