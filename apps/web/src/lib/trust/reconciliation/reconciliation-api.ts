/*
 * The reconciliation screens' reads and writes, through the generated client. Every write carries
 * the key its gesture minted, so a retried tick lands once in History.
 */
import {
  trustAddBankReconciliationInterest,
  trustAddBankReconciliationNote,
  trustAttachBankReconciliationFile,
  trustBankReconciliationFile,
  trustEditBankReconciliation,
  trustFinishBankReconciliation,
  trustGetBankReconciliation,
  trustListBankReconciliations,
  trustRemoveBankReconciliationFile,
  trustRemoveBankReconciliationInterest,
  trustRestoreBankReconciliation,
  trustRevertBankReconciliationChange,
  trustSaveBankReconciliation,
  trustStartBankReconciliation,
  type StartTrustBankReconciliationRequest,
  type TrustBankReconciliationDetail,
  type TrustBankReconciliationEdit,
  type TrustBankReconciliationInterestRequest,
  type TrustBankReconciliationList,
  type TrustBankReconciliationNoteRequest,
  type TrustBankReconciliationRevertRequest,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type {
  StartTrustBankReconciliationRequest,
  TrustBankReconciliationChange,
  TrustBankReconciliationDetail,
  TrustBankReconciliationEdit,
  TrustBankReconciliationFigures,
  TrustBankReconciliationFile,
  TrustBankReconciliationInterest,
  TrustBankReconciliationInterestRequest,
  TrustBankReconciliationItem,
  TrustBankReconciliationLine,
  TrustBankReconciliationList,
  TrustBankReconciliationNote,
  TrustBankReconciliationNoteRequest,
  TrustBankReconciliationRestorePoint,
  TrustBankReconciliationRevertRequest,
  TrustBankReconciliationSummary,
} from "@magna-carta/api-client";

async function attempt<T>(run: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await run();
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

const key = (idempotencyKey: string) => ({ "idempotency-key": idempotencyKey });
type Done = ApiOutcome<unknown>;

export const readReconciliations = (
  trustAccountId: string,
): Promise<ApiOutcome<TrustBankReconciliationList>> =>
  attempt(() => trustListBankReconciliations({ query: { trustAccountId }, throwOnError: true }));

export const readReconciliation = (
  reconciliationId: string,
): Promise<ApiOutcome<TrustBankReconciliationDetail>> =>
  attempt(() => trustGetBankReconciliation({ path: { reconciliationId }, throwOnError: true }));

export const startReconciliation = (
  body: StartTrustBankReconciliationRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ trustBankReconciliationId: string }>> =>
  attempt(() =>
    trustStartBankReconciliation({ body, headers: key(idempotencyKey), throwOnError: true }),
  );

export const editReconciliation = (
  reconciliationId: string,
  edits: readonly TrustBankReconciliationEdit[],
  idempotencyKey: string,
): Promise<Done> =>
  attempt(() =>
    trustEditBankReconciliation({
      path: { reconciliationId },
      body: { edits: [...edits] },
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

export const revertReconciliationChange = (
  reconciliationId: string,
  body: TrustBankReconciliationRevertRequest,
  idempotencyKey: string,
): Promise<Done> =>
  attempt(() =>
    trustRevertBankReconciliationChange({
      path: { reconciliationId },
      body,
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

export const saveReconciliation = (
  reconciliationId: string,
  name: string,
  idempotencyKey: string,
): Promise<Done> =>
  attempt(() =>
    trustSaveBankReconciliation({
      path: { reconciliationId },
      body: { name },
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

export const restoreReconciliation = (
  reconciliationId: string,
  restorePointId: string,
  idempotencyKey: string,
): Promise<Done> =>
  attempt(() =>
    trustRestoreBankReconciliation({
      path: { reconciliationId },
      body: { restorePointId },
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

export const addReconciliationInterest = (
  reconciliationId: string,
  body: TrustBankReconciliationInterestRequest,
  idempotencyKey: string,
): Promise<Done> =>
  attempt(() =>
    trustAddBankReconciliationInterest({
      path: { reconciliationId },
      body,
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

export const removeReconciliationInterest = (
  reconciliationId: string,
  interestId: string,
  idempotencyKey: string,
): Promise<Done> =>
  attempt(() =>
    trustRemoveBankReconciliationInterest({
      path: { reconciliationId, interestId },
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

export const addReconciliationNote = (
  reconciliationId: string,
  body: TrustBankReconciliationNoteRequest,
  idempotencyKey: string,
): Promise<Done> =>
  attempt(() =>
    trustAddBankReconciliationNote({
      path: { reconciliationId },
      body,
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

/** A file as base64, read in the browser, sent whole: a statement is a few megabytes at most. */
export async function attachReconciliationFile(
  reconciliationId: string,
  file: File,
  idempotencyKey: string,
): Promise<Done> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return attempt(() =>
    trustAttachBankReconciliationFile({
      path: { reconciliationId },
      body: {
        name: file.name,
        contentType: file.type || "application/octet-stream",
        dataBase64: btoa(binary),
      },
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );
}

export const removeReconciliationFile = (
  reconciliationId: string,
  fileId: string,
  idempotencyKey: string,
): Promise<Done> =>
  attempt(() =>
    trustRemoveBankReconciliationFile({
      path: { reconciliationId, fileId },
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

export const finishReconciliation = (
  reconciliationId: string,
  idempotencyKey: string,
): Promise<Done> =>
  attempt(() =>
    trustFinishBankReconciliation({
      path: { reconciliationId },
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

/** A kept file as an object URL to open, or null. The caller revokes it. */
export async function readReconciliationFileUrl(
  reconciliationId: string,
  fileId: string,
): Promise<string | null> {
  try {
    const { data } = await trustBankReconciliationFile({
      path: { reconciliationId, fileId },
      parseAs: "blob",
      throwOnError: true,
    });
    const blob: unknown = data;
    return blob instanceof Blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}
