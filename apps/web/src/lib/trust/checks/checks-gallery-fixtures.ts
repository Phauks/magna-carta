/*
 * A trust checks service over memory, for the developer-console gallery: the Checks screen and the
 * stock editor drawn over fixtures a local firm never has, in each state a reviewer needs to see.
 *
 * IT KEEPS THE SERVER'S RULES THAT THE SCREENS SHOW. Printing numbers the chosen payments from the
 * next number and takes them off the queue; answering spoiled voids the number and puts the payment
 * back; voiding a printed check does the same; the next number is the greater of the stock's
 * starting number and one past the highest used. The PDF is composed for real, in the Worker.
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

export type ChecksGalleryState = "ready" | "no-stock" | "empty" | "waiting" | "loading" | "failed";

export const CHECKS_GALLERY_STATES: readonly ChecksGalleryState[] = [
  "ready",
  "waiting",
  "empty",
  "no-stock",
  "loading",
  "failed",
];

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

function initial(state: ChecksGalleryState): TrustChecksResponse {
  const toPrint =
    state === "empty"
      ? []
      : [
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
      "Jammed in the printer",
    ),
    registerRow(10_421, "printed", "Nevada Court Reporters", 61_500, "26-0110", "Reyes Deposition"),
  ];
  if (state === "waiting") {
    register.push(
      registerRow(
        10_422,
        "numbered",
        "Henderson Medical Group",
        230_000,
        "26-0098",
        "Smith v. Clearwater Logistics",
      ),
      registerRow(
        10_423,
        "numbered",
        "Jordan Smith",
        412_500,
        "26-0098",
        "Smith v. Clearwater Logistics",
      ),
    );
  }
  const highest = Math.max(...register.map((row) => row.checkNumber));
  return {
    nextCheckNumber: highest + 1,
    stock:
      state === "no-stock"
        ? null
        : {
            trustCheckStockId: "trustCheckStock_gallery",
            version: 3,
            name: "IOLTA checks, voucher bottom",
            pageLayout: "check_top",
            fields: STANDARD_CHECK_FIELDS.map((field) => ({ ...field })),
            shiftXMils: 0,
            shiftYMils: 0,
            startingCheckNumber: 10_401,
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

export function galleryChecksService(state: ChecksGalleryState): TrustChecksService {
  const data = initial(state);
  /** The payment each numbered check was printed for, so a spoiled one can go back. */
  const printedFrom = new Map<string, TrustCheckToPrint>();

  function nextNumber(): number {
    const highest = Math.max(0, ...data.register.map((row) => row.checkNumber));
    return Math.max(data.stock?.startingCheckNumber ?? 0, highest + 1);
  }

  function takeOutOfUse(trustCheckId: string, status: "spoiled" | "voided", reason: string): void {
    const row = data.register.find((candidate) => candidate.trustCheckId === trustCheckId);
    if (row === undefined) return;
    const index = data.register.indexOf(row);
    data.register[index] = {
      ...row,
      status,
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
      if (state === "loading") return new Promise(() => {});
      await settle();
      if (state === "failed") {
        return {
          kind: "transport",
          failure: {
            problem: null,
            request: `GET /trust/accounts/${GALLERY_ACCOUNT_ID}/checks`,
            failedAt: new Date("2026-11-14T15:02:00.000Z"),
          },
        };
      }
      return ok(structuredClone({ ...data, nextCheckNumber: nextNumber() }));
    },
    async print(_account, trustMovementIds) {
      await settle();
      const checks = trustMovementIds.flatMap((identifier, index) => {
        const payment = data.toPrint.find((row) => row.trustMovementId === identifier);
        if (payment === undefined) return [];
        const checkNumber = nextNumber() + index;
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
            "numbered",
            check.payee,
            check.amountMinor,
            check.matterNumber ?? "",
            check.matterTitle ?? "",
          ),
          trustMovementId: payment?.trustMovementId ?? null,
          memo: check.memo,
        });
      }
      return ok({ stock: data.stock, checks: printed });
    },
    async recordResults(_account, results) {
      await settle();
      for (const result of results) {
        if (result.outcome === "spoiled") {
          takeOutOfUse(result.trustCheckId, "spoiled", "Spoiled in the printer");
          continue;
        }
        const index = data.register.findIndex((row) => row.trustCheckId === result.trustCheckId);
        const row = data.register[index];
        if (row !== undefined) data.register[index] = { ...row, status: "printed" };
      }
      return ok({ recorded: results.length, checkNumber: nextNumber() });
    },
    async voidCheck(_account, checkId, reason) {
      await settle();
      takeOutOfUse(checkId, "voided", reason);
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
