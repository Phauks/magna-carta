/*
 * The Record a Payment screen's writes, behind one small interface so the developer gallery can
 * hand the screen a fake and photograph it without a server. Each answers the three-outcome
 * `ApiOutcome` every failure surface renders from, never a throw.
 *
 * FILES GO AFTER THE DEPOSIT. A line's scan belongs to that line's receipt, and the receipt has no
 * id until the deposit is recorded, so the screen records first and then sends each file naming the
 * receipt it belongs to. A file that fails to send leaves the deposit recorded; the screen says
 * which file and the deposit's own page takes it again.
 */
import {
  billingAddDepositNote,
  billingAttachDepositFile,
  billingRecordDeposit,
  type BillingDepositFileRequest,
  type BillingRecordDepositAck,
  type BillingRecordDepositRequest,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export interface DepositService {
  record(
    request: BillingRecordDepositRequest,
    key: string,
  ): Promise<ApiOutcome<BillingRecordDepositAck>>;
  attachFile(
    depositId: string,
    request: BillingDepositFileRequest,
    key: string,
  ): Promise<ApiOutcome<{ id: string }>>;
  addNote(
    depositId: string,
    request: { receiptId: string | null; body: string },
    key: string,
  ): Promise<ApiOutcome<{ id: string }>>;
}

async function attempt<T>(call: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

const keyed = (idempotencyKey: string) => ({ "idempotency-key": idempotencyKey });

export const liveDepositService: DepositService = {
  record: (body, key) =>
    attempt(() => billingRecordDeposit({ body, headers: keyed(key), throwOnError: true })),
  attachFile: (depositId, body, key) =>
    attempt(() =>
      billingAttachDepositFile({
        path: { depositId },
        body,
        headers: keyed(key),
        throwOnError: true,
      }),
    ),
  addNote: (depositId, body, key) =>
    attempt(() =>
      billingAddDepositNote({ path: { depositId }, body, headers: keyed(key), throwOnError: true }),
    ),
};

/** Where a kept file is read from, to show it on the page or download it. */
export function depositFileAddress(depositId: string, fileId: string): string {
  return `/api/v1/billing/deposits/${encodeURIComponent(depositId)}/files/${encodeURIComponent(fileId)}`;
}

/** A file's bytes as base64, read in slices so a 25 MB scan does not overflow the call stack. */
export async function fileAsBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const slice = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += slice) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + slice));
  }
  return btoa(binary);
}
