/*
 * A trust checks service over memory, for the developer-console gallery: the Checks screen and the
 * stock editor drawn over sample payments and checks a local firm never has.
 *
 * IT KEEPS THE SERVER'S RULES THAT THE SCREENS SHOW. Printing numbers the chosen payments from the
 * first number on the screen, records them as printed and takes them off the queue, and refuses a
 * batch over a number already used; returning a printed check to the list voids its number and
 * puts the payment back; the next number is the first unused one at or after the stock's starting
 * number. The PDF is composed for real, in the Worker.
 */
import { STANDARD_CHECK_FIELDS } from "@magna-carta/trust/check-layout";
import type { ApiOutcome } from "$lib/api/request.ts";
import type {
  TrustCheckRegisterRow,
  TrustCheckToPrint,
  TrustChecksResponse,
} from "./checks-api.ts";
import type { TrustChecksService } from "./checks-service.ts";
import { composeCheckPdf, openPdf } from "./check-pdf.ts";
import { nextUnusedNumber } from "./checks-model.ts";

export const GALLERY_ACCOUNT_ID = "trustAccount_gallery";
export const GALLERY_ACCOUNT_NAME = "IOLTA Client Trust";
export const GALLERY_MEMBERS: Readonly<Record<string, string>> = {
  user_whitfield: "Eleanor Whitfield",
  user_okafor: "Daniel Okafor",
};

const SAVED_AT = "2026-11-02T17:20:00.000Z";

function queueRow(
  identifier: string,
  payee: string,
  amountMinor: number,
  memo: string,
  matterNumber: string,
  matterTitle: string,
  effectiveDate: string,
  earlierCheckNumbers: number[] = [],
): TrustCheckToPrint {
  return {
    trustMovementId: identifier,
    payee,
    amountMinor,
    currency: "USD",
    memo,
    effectiveDate,
    authorizedBy: "user_whitfield",
    matterNumber,
    matterTitle,
    earlierCheckNumbers,
  };
}

function registerRow(
  checkNumber: number,
  status: TrustCheckRegisterRow["status"],
  payee: string,
  amountMinor: number,
  matterNumber: string,
  matterTitle: string,
  settledReason: string | null = null,
): TrustCheckRegisterRow {
  return {
    trustCheckId: `trustCheck_${checkNumber}`,
    checkNumber,
    status,
    trustMovementId: `trustMovement_${checkNumber}`,
    payee,
    amountMinor,
    currency: "USD",
    effectiveDate: "2026-10-28",
    matterNumber,
    matterTitle,
    memo: null,
    numberedBy: "user_okafor",
    numberedAt: "2026-10-28T16:00:00.000Z",
    settledReason,
    lastEventAt: status === "numbered" ? null : "2026-10-28T16:05:00.000Z",
  };
}

function initial(): TrustChecksResponse {
  const toPrint = [
    queueRow(
      "trustMovement_desert",
      "Desert Title Company",
      300_000,
      "Harrington closing",
      "26-0141",
      "Harrington Purchase",
      "2026-10-31",
    ),
    queueRow(
      "trustMovement_smith",
      "Jordan Smith",
      125_050,
      "Settlement share",
      "26-0098",
      "Smith v. Clearwater Logistics",
      "2026-10-31",
      [10_398],
    ),
    queueRow(
      "trustMovement_county",
      "Clark County Recorder",
      8_400,
      "Recording fee",
      "26-0141",
      "Harrington Purchase",
      "2026-11-01",
    ),
  ];
  const register: TrustCheckRegisterRow[] = [
    // Printed before a check was recorded as printed at once: it reads exactly like the rest.
    registerRow(10_417, "numbered", "Reno Courier Service", 4_500, "26-0122", "Okafor Estate"),
    registerRow(10_418, "printed", "Silver State Appraisals", 45_000, "26-0122", "Okafor Estate"),
    registerRow(10_419, "printed", "Maria Delgado", 1_840_000, "26-0087", "Delgado Settlement"),
    registerRow(
      10_398,
      "voided",
      "Jordan Smith",
      125_050,
      "26-0098",
      "Smith v. Clearwater Logistics",
      "Lost in the mail; stop payment placed",
    ),
    registerRow(
      10_420,
      "spoiled",
      "Nevada Court Reporters",
      61_500,
      "26-0110",
      "Reyes Deposition",
      "Misprinted",
    ),
    registerRow(10_421, "printed", "Nevada Court Reporters", 61_500, "26-0110", "Reyes Deposition"),
  ];
  return {
    nextCheckNumber: nextUnusedNumber(
      10_422,
      register.map((row) => row.checkNumber),
    ),
    stock: {
      trustCheckStockId: "trustCheckStock_gallery",
      version: 3,
      name: "IOLTA checks, voucher bottom",
      pageLayout: "check_top",
      fields: STANDARD_CHECK_FIELDS.map((field) => ({ ...field })),
      shiftXMils: 0,
      shiftYMils: 0,
      startingCheckNumber: 10_422,
      hasScan: false,
      savedBy: "user_whitfield",
      savedAt: SAVED_AT,
    },
    toPrint,
    register,
  };
}

function ok<T>(value: T): ApiOutcome<T> {
  return { kind: "ok", value };
}

/** A pause the length of a quick request, so busy labels are seen. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

export function galleryChecksService(): TrustChecksService {
  const data = initial();
  /** The payment each printed check was printed for, so a returned one can go back. */
  const printedFrom = new Map<string, TrustCheckToPrint>();
  for (const row of data.register) {
    if ((row.status !== "printed" && row.status !== "numbered") || row.trustMovementId === null) {
      continue;
    }
    printedFrom.set(
      row.trustCheckId,
      queueRow(
        row.trustMovementId,
        row.payee ?? "",
        row.amountMinor ?? 0,
        row.memo ?? "",
        row.matterNumber ?? "",
        row.matterTitle ?? "",
        row.effectiveDate ?? "2026-10-31",
      ),
    );
  }

  function nextNumber(): number {
    return nextUnusedNumber(
      data.stock?.startingCheckNumber ?? 1,
      data.register.map((row) => row.checkNumber),
    );
  }

  function takeOutOfUse(trustCheckId: string, reason: string): void {
    const row = data.register.find((candidate) => candidate.trustCheckId === trustCheckId);
    if (row === undefined) return;
    const index = data.register.indexOf(row);
    data.register[index] = {
      ...row,
      status: "voided",
      settledReason: reason,
      lastEventAt: new Date().toISOString(),
    };
    const payment = printedFrom.get(trustCheckId);
    if (payment !== undefined) {
      data.toPrint.push({
        ...payment,
        earlierCheckNumbers: [...payment.earlierCheckNumbers, row.checkNumber],
      });
    }
  }

  return {
    async read() {
      await settle();
      return ok(structuredClone({ ...data, nextCheckNumber: nextNumber() }));
    },
    async print(_account, trustMovementIds, _key, firstCheckNumber) {
      await settle();
      const first = firstCheckNumber ?? nextNumber();
      const used = data.register
        .map((row) => row.checkNumber)
        .filter((number) => number >= first && number < first + trustMovementIds.length)
        .toSorted((left, right) => left - right);
      if (used.length > 0) {
        const problem = {
          status: 422,
          type: "https://api.magnacarta.esq/problems/trust-check-refused",
          title: "Trust check refused",
          detail: `Check ${used.join(", ")} is already in this account's register. A check number is never used twice.`,
        };
        return {
          kind: "problem",
          problem,
          failure: {
            problem,
            request: "POST /api/v1/trust/checks/print",
            failedAt: new Date(),
          },
        };
      }
      const checks = trustMovementIds.flatMap((identifier, index) => {
        const payment = data.toPrint.find((row) => row.trustMovementId === identifier);
        if (payment === undefined) return [];
        const checkNumber = first + index;
        return [{ payment, checkNumber }];
      });
      const printed = checks.map(({ payment, checkNumber }) => {
        const trustCheckId = `trustCheck_${checkNumber}`;
        printedFrom.set(trustCheckId, payment);
        return {
          trustCheckId,
          checkNumber,
          trustMovementId: payment.trustMovementId,
          payee: payment.payee,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          effectiveDate: payment.effectiveDate,
          memo: payment.memo,
          matterNumber: payment.matterNumber,
          matterTitle: payment.matterTitle,
        };
      });
      for (const check of printed) {
        const payment = printedFrom.get(check.trustCheckId);
        data.toPrint = data.toPrint.filter((row) => row.trustMovementId !== check.trustMovementId);
        data.register.push({
          ...registerRow(
            check.checkNumber,
            "printed",
            check.payee,
            check.amountMinor,
            check.matterNumber ?? "",
            check.matterTitle ?? "",
          ),
          trustMovementId: payment?.trustMovementId ?? null,
          memo: check.memo,
        });
      }
      // The server refuses a print with no stock saved, and the gallery always has one.
      const stock = data.stock;
      if (stock === null) throw new Error("The gallery's check stock is missing.");
      return ok({ stock, checks: printed });
    },
    async voidCheck(_account, checkId, reason) {
      await settle();
      takeOutOfUse(checkId, reason);
      return ok({ recorded: 1, checkNumber: nextNumber() });
    },
    async voidNextNumber(_account, reason) {
      await settle();
      const checkNumber = nextNumber();
      data.register.push({
        ...registerRow(checkNumber, "voided", "", 0, "", "", reason),
        trustMovementId: null,
        payee: null,
        amountMinor: null,
        matterNumber: null,
        matterTitle: null,
        effectiveDate: null,
      });
      return ok({ recorded: 1, checkNumber: nextNumber() });
    },
    async saveStock(request) {
      await settle();
      data.stock = {
        trustCheckStockId: "trustCheckStock_gallery",
        version: (data.stock?.version ?? 0) + 1,
        name: request.name,
        pageLayout: request.pageLayout,
        fields: request.fields.map((field) => ({ ...field })),
        shiftXMils: request.shiftXMils,
        shiftYMils: request.shiftYMils,
        startingCheckNumber: request.startingCheckNumber,
        hasScan:
          request.scan === "remove"
            ? false
            : request.scan === "keep"
              ? (data.stock?.hasScan ?? false)
              : true,
        savedBy: "user_whitfield",
        savedAt: new Date().toISOString(),
      };
      return ok({ stock: data.stock, nextCheckNumber: nextNumber() });
    },
    async readScanUrl() {
      return null;
    },
    composePdf: composeCheckPdf,
    openPdf,
  };
}
