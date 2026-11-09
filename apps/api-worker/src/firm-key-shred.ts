import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "./bindings.ts";
import { firmKeyProviderForEnv } from "./firm-key-provider-wiring.ts";

// Crypto-shred: the irreversible destruction of a firm's data key. Nulling the wrapped firm key in
// the control-plane registry is the whole mechanism — every purpose/index key derives from it, so
// once it is gone the firm's entire protected corpus (incident descriptions, secrets, and any future
// sensitive identifiers) is permanently unreadable; decrypts fail closed with FirmKeyUnavailableError.
//
// Three effects, in order:
//   1. NULL wrapped_firm_key (the destruction). Guarded so a re-run is a no-op.
//   2. A firm.key_shredded row in the control-plane auth_audit (the firm row's audit home) — this is
//      ALSO what distinguishes a shredded firm from a never-minted one, so the provisioning key-mint
//      step never re-mints a key for a firm that was deliberately shredded.
//   3. Invalidate the per-isolate key-handle cache, so a key whose wrapped form was just nulled
//      cannot keep being served from the cache within the same isolate (the same-isolate window the
//      provider's invalidate() closes).
//
// Function only, no route this slice: the offboarding flow that invokes it is its own design. The
// audit metadata is ids-only (the firm id) — never any protected value.
export async function shredFirmKey(env: Bindings, firmId: FirmId): Promise<void> {
  const provider = firmKeyProviderForEnv(env);
  // Idempotent guard: a firm with no live wrapped key is either already shredded or never minted, so
  // there is nothing to destroy and no new shred event to record. Return without touching the batch —
  // this keeps a retry or queue redelivery from writing a duplicate firm.key_shredded audit row. Still
  // invalidate, in case this isolate cached the handle before the key was nulled elsewhere.
  const firm = await env.DB_CONTROL.prepare("SELECT wrapped_firm_key FROM firm WHERE id = ?1")
    .bind(firmId)
    .first<{ wrapped_firm_key: string | null }>();
  if (firm?.wrapped_firm_key == null) {
    provider.invalidate(firmId);
    return;
  }

  const now = new Date().toISOString();
  // The destruction + its audit commit in one atomic batch (composeEffectBatch accepts the
  // data-access SqlStatement shape, which a raw env.DB_CONTROL.prepare(...).bind(...) also satisfies).
  await commitEffectBatch(
    env.DB_CONTROL,
    {
      statements: [
        env.DB_CONTROL.prepare(
          "UPDATE firm SET wrapped_firm_key = NULL WHERE id = ?1 AND wrapped_firm_key IS NOT NULL",
        ).bind(firmId),
        insertAuthAuditStatement(env.DB_CONTROL, {
          id: newIdentifier("authAudit"),
          event: "firm.key_shredded",
          // Actor-less: invoked by the offboarding flow (a platform/firm-admin action with no user
          // row in this seam) — the firm id rides the metadata, like firm.provisioned.
          userId: null,
          metadata: { firmId },
          now,
        }),
      ],
      outboxMessages: [],
    },
    { now: () => now },
  );
  provider.invalidate(firmId);
}
