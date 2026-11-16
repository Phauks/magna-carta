/*
 * Everything the Checks screen and the stock editor ask of the outside world, as one object handed
 * in. The routes hand in the live one (the generated client, the PDF Worker, a new tab); the
 * developer-console gallery hands in one over fixtures, so the screens a reviewer looks at there are
 * these screens and not a second rendering of them.
 */
import type { ComposeDocument } from "@magna-carta/pdf-compose";
import type { ApiOutcome } from "$lib/api/request.ts";
import {
  printTrustChecks,
  readTrustCheckStockScanUrl,
  readTrustChecks,
  recordTrustCheckResults,
  saveTrustCheckStock,
  voidNextTrustCheckNumber,
  voidTrustCheck,
  type PrintTrustChecksResponse,
  type SaveTrustCheckStockRequest,
  type TrustCheckAnswer,
  type TrustChecksResponse,
} from "./checks-api.ts";
import { composeCheckPdf, openPdf } from "./check-pdf.ts";
import type {
  SaveTrustCheckStockResponse,
  TrustCheckAcknowledgement,
} from "@magna-carta/api-client";

export interface TrustChecksService {
  read(trustAccountId: string): Promise<ApiOutcome<TrustChecksResponse>>;
  print(
    trustAccountId: string,
    trustMovementIds: readonly string[],
    idempotencyKey: string,
  ): Promise<ApiOutcome<PrintTrustChecksResponse>>;
  recordResults(
    trustAccountId: string,
    results: readonly TrustCheckAnswer[],
    idempotencyKey: string,
  ): Promise<ApiOutcome<TrustCheckAcknowledgement>>;
  voidCheck(
    trustAccountId: string,
    checkId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<ApiOutcome<TrustCheckAcknowledgement>>;
  voidNextNumber(
    trustAccountId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<ApiOutcome<TrustCheckAcknowledgement>>;
  saveStock(
    request: SaveTrustCheckStockRequest,
    idempotencyKey: string,
  ): Promise<ApiOutcome<SaveTrustCheckStockResponse>>;
  /** The saved scan as an object URL, or null. The caller revokes it. */
  readScanUrl(trustAccountId: string): Promise<string | null>;
  /** Compose a document into a PDF, off the main thread. Throws CheckPdfError. */
  composePdf(document: ComposeDocument): Promise<Blob>;
  /** Hand the PDF to the browser to print from. */
  openPdf(pdf: Blob): void;
}

export const liveTrustChecksService: TrustChecksService = {
  read: readTrustChecks,
  print: printTrustChecks,
  recordResults: recordTrustCheckResults,
  voidCheck: voidTrustCheck,
  voidNextNumber: voidNextTrustCheckNumber,
  saveStock: saveTrustCheckStock,
  readScanUrl: readTrustCheckStockScanUrl,
  composePdf: composeCheckPdf,
  openPdf,
};
