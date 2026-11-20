import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  InvoiceApplicationId,
  InvoiceId,
  LedgerAccountId,
  MatterId,
  PaymentDepositFileId,
  PaymentDepositId,
  PaymentDepositNoteId,
  PaymentReceiptId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { PaymentDetails, PaymentMethod } from "./payment-methods.ts";

// What a recorded deposit holds, read back for its own page: each line with its matter and bill, the
// bank fees, the notes and the files still kept with it. A line whose payment was later reversed is
// still shown, marked, because the deposit happened.

export interface PaymentDepositLine {
  readonly receiptId: PaymentReceiptId;
  readonly lineNumber: number;
  readonly applicationId: InvoiceApplicationId;
  readonly invoiceId: InvoiceId;
  readonly invoiceNumber: string | null;
  readonly matterId: MatterId;
  readonly matterNumber: string | null;
  readonly matterTitle: string;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly receivedFrom: string;
  readonly receivedOn: string;
  readonly amountMinor: number;
  readonly memo: string | null;
  readonly details: PaymentDetails;
  readonly reversed: boolean;
}

export interface PaymentDepositFee {
  readonly lineNumber: number;
  readonly description: string;
  readonly amountMinor: number;
}

export interface PaymentDepositNote {
  readonly id: PaymentDepositNoteId;
  readonly receiptId: PaymentReceiptId | null;
  readonly body: string;
  readonly writtenBy: UserId | null;
  readonly writtenAt: string;
}

export interface PaymentDepositFile {
  readonly id: PaymentDepositFileId;
  readonly receiptId: PaymentReceiptId | null;
  readonly kind: "scan" | "file";
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly recordedAt: string;
}

export interface PaymentDepositDetail {
  readonly id: PaymentDepositId;
  readonly depositToAccountId: LedgerAccountId;
  readonly depositToName: string;
  readonly depositedOn: string;
  readonly slipNumber: string | null;
  readonly currency: string;
  readonly paymentsMinor: number;
  readonly feesMinor: number;
  readonly depositMinor: number;
  readonly recordedBy: UserId | null;
  readonly recordedAt: string;
  readonly lines: readonly PaymentDepositLine[];
  readonly fees: readonly PaymentDepositFee[];
  readonly notes: readonly PaymentDepositNote[];
  readonly files: readonly PaymentDepositFile[];
}

export async function readPaymentDeposit(
  database: SqlDatabase,
  depositId: PaymentDepositId,
): Promise<PaymentDepositDetail | undefined> {
  const { results: heads } = await database
    .prepare(
      `SELECT d.id, d.deposit_to_account_id, COALESCE(o.name, a.name) AS deposit_to_name,
              d.deposited_on, d.slip_number, d.currency, d.recorded_by, d.recorded_at
         FROM payment_deposit d
         JOIN ledger_account a ON a.id = d.deposit_to_account_id
         LEFT JOIN operating_bank_account o ON o.ledger_account_id = d.deposit_to_account_id
        WHERE d.id = ?1`,
    )
    .bind(depositId)
    .all<{
      id: PaymentDepositId;
      deposit_to_account_id: LedgerAccountId;
      deposit_to_name: string;
      deposited_on: string;
      slip_number: string | null;
      currency: string;
      recorded_by: UserId | null;
      recorded_at: string;
    }>();
  const head = heads[0];
  if (!head) return undefined;

  const { results: lineRows } = await database
    .prepare(
      `SELECT r.id, r.line_number, r.application_id, ap.invoice_id, i.invoice_number, ap.matter_id,
              m.matter_number, m.title AS matter_title, r.method, r.reference, r.received_from,
              ap.effective_date, ap.amount_minor, r.memo, r.details,
              EXISTS (SELECT 1 FROM invoice_application rv WHERE rv.reverses_application_id = ap.id) AS reversed
         FROM payment_receipt r
         JOIN invoice_application ap ON ap.id = r.application_id
         JOIN invoice i ON i.id = ap.invoice_id
         JOIN matter m ON m.id = ap.matter_id
        WHERE r.deposit_id = ?1
        ORDER BY r.line_number`,
    )
    .bind(depositId)
    .all<{
      id: PaymentReceiptId;
      line_number: number;
      application_id: InvoiceApplicationId;
      invoice_id: InvoiceId;
      invoice_number: string | null;
      matter_id: MatterId;
      matter_number: string | null;
      matter_title: string;
      method: PaymentMethod;
      reference: string | null;
      received_from: string;
      effective_date: string;
      amount_minor: number;
      memo: string | null;
      details: string;
      reversed: number;
    }>();
  const { results: feeRows } = await database
    .prepare(
      `SELECT line_number, description, amount_minor FROM payment_deposit_fee WHERE deposit_id = ?1 ORDER BY line_number`,
    )
    .bind(depositId)
    .all<{ line_number: number; description: string; amount_minor: number }>();
  const { results: noteRows } = await database
    .prepare(
      `SELECT n.id, n.receipt_id, n.body, n.written_by, n.written_at
         FROM payment_deposit_note n
         LEFT JOIN payment_receipt r ON r.id = n.receipt_id
        WHERE n.deposit_id = ?1
        ORDER BY n.written_at, COALESCE(r.line_number, 0), n.id`,
    )
    .bind(depositId)
    .all<{
      id: PaymentDepositNoteId;
      receipt_id: PaymentReceiptId | null;
      body: string;
      written_by: UserId | null;
      written_at: string;
    }>();
  const files = await readPaymentDepositFiles(database, depositId);

  const lines = lineRows.map((row) => ({
    receiptId: row.id,
    lineNumber: row.line_number,
    applicationId: row.application_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    matterId: row.matter_id,
    matterNumber: row.matter_number,
    matterTitle: row.matter_title,
    method: row.method,
    reference: row.reference,
    receivedFrom: row.received_from,
    receivedOn: row.effective_date,
    amountMinor: row.amount_minor,
    memo: row.memo,
    details: JSON.parse(row.details) as PaymentDetails,
    reversed: row.reversed === 1,
  }));
  const fees = feeRows.map((row) => ({
    lineNumber: row.line_number,
    description: row.description,
    amountMinor: row.amount_minor,
  }));
  const paymentsMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const feesMinor = fees.reduce((sum, fee) => sum + fee.amountMinor, 0);
  return {
    id: head.id,
    depositToAccountId: head.deposit_to_account_id,
    depositToName: head.deposit_to_name,
    depositedOn: head.deposited_on,
    slipNumber: head.slip_number,
    currency: head.currency,
    paymentsMinor,
    feesMinor,
    depositMinor: paymentsMinor - feesMinor,
    recordedBy: head.recorded_by,
    recordedAt: head.recorded_at,
    lines,
    fees,
    notes: noteRows.map((row) => ({
      id: row.id,
      receiptId: row.receipt_id,
      body: row.body,
      writtenBy: row.written_by,
      writtenAt: row.written_at,
    })),
    files,
  };
}

interface FileRow {
  id: PaymentDepositFileId;
  receipt_id: PaymentReceiptId | null;
  kind: "scan" | "file";
  name: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  recorded_at: string;
}

/** The files still kept with a deposit: every file row no later row removed, oldest first. */
export async function readPaymentDepositFiles(
  database: SqlDatabase,
  depositId: PaymentDepositId,
): Promise<readonly PaymentDepositFile[]> {
  const { results } = await database
    .prepare(
      `SELECT f.id, f.receipt_id, f.kind, f.name, f.content_type, f.size_bytes, f.object_key, f.recorded_at
         FROM payment_deposit_file f
        WHERE f.deposit_id = ?1 AND f.removes_file_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM payment_deposit_file r WHERE r.removes_file_id = f.id)
        ORDER BY f.recorded_at, f.id`,
    )
    .bind(depositId)
    .all<FileRow>();
  return results.map((row) => ({
    id: row.id,
    receiptId: row.receipt_id,
    kind: row.kind,
    name: row.name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    recordedAt: row.recorded_at,
  }));
}

/** One file kept with a deposit, with where its bytes are, or undefined when it is not kept. */
export async function readPaymentDepositFile(
  database: SqlDatabase,
  depositId: PaymentDepositId,
  fileId: PaymentDepositFileId,
): Promise<(PaymentDepositFile & { readonly objectKey: string }) | undefined> {
  const { results } = await database
    .prepare(
      `SELECT f.id, f.receipt_id, f.kind, f.name, f.content_type, f.size_bytes, f.object_key, f.recorded_at
         FROM payment_deposit_file f
        WHERE f.deposit_id = ?1 AND f.id = ?2 AND f.removes_file_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM payment_deposit_file r WHERE r.removes_file_id = f.id)`,
    )
    .bind(depositId, fileId)
    .all<FileRow>();
  const row = results[0];
  if (!row) return undefined;
  return {
    id: row.id,
    receiptId: row.receipt_id,
    kind: row.kind,
    name: row.name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    recordedAt: row.recorded_at,
    objectKey: row.object_key,
  };
}

/** Does this receipt belong to this deposit? A file or note on a line is kept on the line's deposit. */
export async function receiptBelongsToDeposit(
  database: SqlDatabase,
  depositId: PaymentDepositId,
  receiptId: PaymentReceiptId,
): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT 1 AS present FROM payment_receipt WHERE id = ?1 AND deposit_id = ?2`)
    .bind(receiptId, depositId)
    .all<{ present: number }>();
  return results.length > 0;
}

/** One matter's share of one issued bill that still has something owing: a line's Matter and Bill. */
export interface OpenBillShare {
  readonly invoiceId: InvoiceId;
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly matterId: MatterId;
  readonly matterNumber: string | null;
  readonly matterTitle: string;
  readonly clientName: string | null;
  readonly currency: string;
  readonly owedMinor: number;
}

/** Every issued bill's matter share with a balance left, by matter number then bill number. */
export async function readOpenBillShares(database: SqlDatabase): Promise<readonly OpenBillShare[]> {
  const { results } = await database
    .prepare(
      `SELECT b.invoice_id, i.invoice_number, i.issue_date, b.matter_id, m.matter_number,
              m.title AS matter_title, m.client_display_name AS client_name, b.currency,
              b.total_minor - b.applied_minor AS owed_minor
         FROM invoice_matter_balance b
         JOIN invoice i ON i.id = b.invoice_id
         JOIN matter m ON m.id = b.matter_id
        WHERE i.status = 'final' AND b.total_minor > b.applied_minor
        ORDER BY m.matter_number, m.title, i.invoice_number, b.invoice_id`,
    )
    .all<{
      invoice_id: InvoiceId;
      invoice_number: string | null;
      issue_date: string | null;
      matter_id: MatterId;
      matter_number: string | null;
      matter_title: string;
      client_name: string | null;
      currency: string;
      owed_minor: number;
    }>();
  return results.map((row) => ({
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date,
    matterId: row.matter_id,
    matterNumber: row.matter_number,
    matterTitle: row.matter_title,
    clientName: row.client_name,
    currency: row.currency,
    owedMinor: row.owed_minor,
  }));
}
