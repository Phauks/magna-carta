/*
 * Check printing's reads and writes, through the generated client. Every write carries the key its
 * gesture minted, so a retried print numbers its checks once.
 */
import {
  trustCheckStockScan,
  trustChecks,
  trustPrintChecks,
  trustRecordCheckResults,
  trustSaveCheckStock,
  trustVoidCheck,
  trustVoidNextCheckNumber,
  type PrintTrustChecksResponse,
  type SaveTrustCheckStockRequest,
  type SaveTrustCheckStockResponse,
  type TrustCheckAcknowledgement,
  type TrustChecksResponse,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type {
  PrintTrustChecksResponse,
  PrintedTrustCheck,
  SaveTrustCheckStockRequest,
  TrustCheckField,
  TrustCheckRegisterRow,
  TrustCheckStock,
  TrustCheckToPrint,
  TrustChecksResponse,
} from "@magna-carta/api-client";

export async function readTrustChecks(
  trustAccountId: string,
): Promise<ApiOutcome<TrustChecksResponse>> {
  try {
    const { data } = await trustChecks({ query: { trustAccountId }, throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

export async function printTrustChecks(
  trustAccountId: string,
  trustMovementIds: readonly string[],
  idempotencyKey: string,
): Promise<ApiOutcome<PrintTrustChecksResponse>> {
  try {
    const { data } = await trustPrintChecks({
      body: { trustAccountId, trustMovementIds: [...trustMovementIds] },
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

export interface TrustCheckAnswer {
  readonly trustCheckId: string;
  readonly outcome: "printed" | "spoiled";
}

export async function recordTrustCheckResults(
  trustAccountId: string,
  results: readonly TrustCheckAnswer[],
  idempotencyKey: string,
): Promise<ApiOutcome<TrustCheckAcknowledgement>> {
  try {
    const { data } = await trustRecordCheckResults({
      body: { trustAccountId, results: results.map((result) => ({ ...result })) },
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

export async function voidTrustCheck(
  trustAccountId: string,
  checkId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustCheckAcknowledgement>> {
  try {
    const { data } = await trustVoidCheck({
      path: { checkId },
      body: { trustAccountId, reason },
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

export async function voidNextTrustCheckNumber(
  trustAccountId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<TrustCheckAcknowledgement>> {
  try {
    const { data } = await trustVoidNextCheckNumber({
      body: { trustAccountId, reason },
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

export async function saveTrustCheckStock(
  request: SaveTrustCheckStockRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<SaveTrustCheckStockResponse>> {
  try {
    const { data } = await trustSaveCheckStock({
      body: request,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/**
 * The account's scan as an object URL for an `<img>`, or null when it has none. Read as bytes
 * through the client so the session rides it; the caller revokes the URL when it lets the image go.
 */
export async function readTrustCheckStockScanUrl(trustAccountId: string): Promise<string | null> {
  try {
    const { data } = await trustCheckStockScan({
      query: { trustAccountId },
      parseAs: "blob",
      throwOnError: true,
    });
    const scan: unknown = data;
    return scan instanceof Blob ? URL.createObjectURL(scan) : null;
  } catch {
    return null;
  }
}
