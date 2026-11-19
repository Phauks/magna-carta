import { z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { GuardedWriteRefusedError, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type {
  LedgerEntryId,
  TrustBankReconciliationInterestId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  inverseOfChange,
  undoRedoTargets,
  type BankReconciliationDetail,
  type BankReconciliationHeader,
  type BankReconciliationLineKey,
  type BankReconciliationSummary,
} from "@magna-carta/trust/bank-reconciliation";
import {
  BankReconciliationDetailResponse,
  type BankReconciliationHeaderRecord,
  type BankReconciliationLine,
} from "@magna-carta/trust/bank-reconciliation-contract";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Context } from "hono";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { problemJson } from "../../contracts/problem.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// What the bank reconciliation handlers answer with: the wire records built from the domain's
// types, refusals as problems, and the commit every write goes through.

// ---- records -------------------------------------------------------------------------------------

export function headerRecord(
  header: BankReconciliationHeader,
): z.infer<typeof BankReconciliationHeaderRecord> {
  return {
    trustBankReconciliationId: header.id,
    trustAccountId: header.trustAccountId,
    currency: header.currency,
    startDate: header.startDate,
    startBalanceMinor: header.startBalanceMinor,
    startCarriedOver: header.startCarriedOver,
    startedBy: header.startedBy,
    startedByName: header.startedByName,
    startedAt: header.startedAt,
    finishedBy: header.finishedBy,
    finishedByName: header.finishedByName,
    finishedAt: header.finishedAt,
  };
}

export function lineRecord(
  line: BankReconciliationLineKey,
): z.infer<typeof BankReconciliationLine> {
  return line.kind === "entry"
    ? { kind: "entry", entryId: line.entryId }
    : { kind: "interest", interestId: line.interestId };
}

export function lineKey(line: z.infer<typeof BankReconciliationLine>): BankReconciliationLineKey {
  return line.kind === "entry"
    ? { kind: "entry", entryId: line.entryId as LedgerEntryId }
    : { kind: "interest", interestId: line.interestId as TrustBankReconciliationInterestId };
}

export function detailRecord(
  detail: BankReconciliationDetail,
  viewer: UserId,
): z.infer<typeof BankReconciliationDetailResponse> {
  const targets = undoRedoTargets(detail.changes, viewer);
  return {
    reconciliation: headerRecord(detail.reconciliation),
    endDate: detail.endDate,
    endBalanceMinor: detail.endBalanceMinor,
    figures: { ...detail.figures },
    items: detail.items.map((item) => ({ ...item })),
    interest: detail.interest.map(({ id, ...line }) => ({ interestId: id, ...line })),
    notes: detail.notes.map(({ id, line, ...note }) => ({
      noteId: id,
      line: lineRecord(line),
      ...note,
    })),
    files: detail.files.map((file) => ({
      fileId: file.id,
      name: file.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      recordedBy: file.recordedBy,
      recordedAt: file.recordedAt,
    })),
    changes: detail.changes.map(({ id, line, ...change }) => ({
      changeId: id,
      line: line === null ? null : lineRecord(line),
      ...change,
      canRevert:
        detail.reconciliation.finishedAt === null &&
        inverseOfChange(detail.changes, { id, line, ...change }) !== null,
    })),
    restorePoints: detail.restorePoints.map(({ id, ...point }) => ({
      restorePointId: id,
      ...point,
    })),
    undoChangeId: targets.undo?.id ?? null,
    redoChangeId: targets.redo?.id ?? null,
    version: detail.version,
  };
}

export function summaryRecord(summary: BankReconciliationSummary) {
  return { ...summary, reconciliation: headerRecord(summary.reconciliation) };
}

// ---- answers -------------------------------------------------------------------------------------

export function refusal(c: Context, error: TrustValidationError) {
  if (
    error.code === "unknown-trust-account" ||
    error.code === "unknown-trust-bank-reconciliation" ||
    error.code === "bank-reconciliation-unknown-file" ||
    error.code === "bank-reconciliation-unknown-restore-point"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (
    error.code === "bank-reconciliation-finished" ||
    error.code === "bank-reconciliation-in-progress"
  ) {
    return problemJson(c, {
      type: "trust-bank-reconciliation-conflict",
      title: "This reconciliation can't change now",
      status: 409,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "trust-bank-reconciliation-refused",
    title: "The trust rules refuse this",
    status: 422,
    detail: error.message,
  });
}

/** A batch refused by its guard: someone changed the period between the read and the finish. */
export function isGuardRefusal(caught: unknown): boolean {
  return caught instanceof GuardedWriteRefusedError;
}

export async function commitWrite<Body>(
  c: Context,
  compose: (actor: UserId) => Promise<{ write: EffectWrite; body: Body }>,
) {
  const firm = requireChokepointFirmContext(c);
  const userId = requireChokepointUserId(c);
  const idempotency = requireChokepointIdempotency(c);
  let result;
  try {
    result = await runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const composed = await compose(userId);
        return {
          write: composed.write,
          responseCode: 201,
          responseBody: canonicalJsonStringify(composed.body),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof TrustValidationError) return refusal(c, caught);
    if (isGuardRefusal(caught)) {
      return problemJson(c, {
        type: "trust-bank-reconciliation-conflict",
        title: "Someone changed this reconciliation",
        status: 409,
        detail: "It changed while you were finishing. Check the figures and finish again.",
      });
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return problemResponseForIdempotencyConflict(c, result);
  }
  if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
  return c.json(JSON.parse(result.responseBody ?? "{}") as Body, 201);
}

export const ok = { ok: true as const };

/** What the bytes are, read from their first bytes, never from the name or the declared type. */
export function sniffFile(bytes: Uint8Array): { contentType: string } | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return { contentType: "application/pdf" };
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { contentType: "image/png" };
  if (starts(0xff, 0xd8, 0xff)) return { contentType: "image/jpeg" };
  return null;
}
