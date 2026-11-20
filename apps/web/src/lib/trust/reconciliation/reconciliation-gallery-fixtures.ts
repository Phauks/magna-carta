/*
 * The reconciliation screens over fixtures, for the developer gallery: one trust account with six
 * finished periods and one in progress, held in memory. Ticking, notes, Save, Restore Points,
 * Undo, Redo, History, interest, files and Finish all work here, by the server's rules in
 * miniature, so a reviewer can try the screen without a firm that has a trust account. Reload the
 * page to start the fixtures over.
 */
import type { ApiOutcome } from "$lib/api/request.ts";
import { transportOutcome } from "$lib/api/request.ts";
import type {
  TrustBankReconciliationChange,
  TrustBankReconciliationDetail,
  TrustBankReconciliationEdit,
  TrustBankReconciliationItem,
  TrustBankReconciliationLine,
  TrustBankReconciliationList,
  TrustBankReconciliationSummary,
} from "./reconciliation-api.ts";
import type { ReconciliationService } from "./reconciliation-service.ts";
import { composeReportPdf } from "./reconciliation-report-pdf.ts";
import { openPdf } from "$lib/trust/checks/check-pdf.ts";
import { figuresOf, lineKey, linesNeedingReview } from "./reconciliation-model.ts";
import { interestTotalMinor } from "@magna-carta/trust/bank-reconciliation-figures";

export const GALLERY_ACCOUNT_ID = "tac_gallery";
export const GALLERY_ACCOUNT_NAME = "IOLTA Client Trust";
export const GALLERY_RECONCILIATION_ID = "tbr_gallery_open";
const ME = "usr_gallery_me";
const ME_NAME = "Eleanor Whitfield";
const COLLEAGUE = "usr_gallery_marco";
const COLLEAGUE_NAME = "Marco Ortega";

export const RECONCILIATION_GALLERY_STATES = [
  "working",
  "finished",
  "first",
  "loading",
  "failed",
] as const;
export type ReconciliationGalleryState = (typeof RECONCILIATION_GALLERY_STATES)[number];

type Item = TrustBankReconciliationItem;

function item(
  entryId: string,
  effectiveDate: string,
  type: Item["type"],
  number: string | null,
  payeeOrFrom: string,
  matter: [string, string] | null,
  amountMinor: number,
  cleared: boolean,
  extra: Partial<Item> = {},
): Item {
  return {
    entryId,
    effectiveDate,
    description: amountMinor >= 0 ? `Deposit from ${payeeOrFrom}` : `Payment to ${payeeOrFrom}`,
    amountMinor,
    type,
    number,
    payeeOrFrom,
    purpose: amountMinor >= 0 ? "Retainer" : "Disbursement",
    matterId: matter === null ? null : `mat_${matter[0]}`,
    matterNumber: matter?.[0] ?? null,
    matterTitle: matter?.[1] ?? null,
    firmFunds: false,
    movementId: `tmv_${entryId}`,
    transferId: null,
    recordedAt: `${effectiveDate}T17:10:00.000Z`,
    isNew: false,
    cleared,
    ...extra,
  };
}

const HARRINGTON: [string, string] = ["26-0141", "Harrington v. Coastline Marine"];
const OKAFOR: [string, string] = ["26-0155", "Estate of Okafor"];
const RENO: [string, string] = ["26-0172", "Reno Courier Contract"];
const CLARK: [string, string] = ["26-0098", "Clark County Land Use"];
const SMITH: [string, string] = ["26-0121", "Smith v. Lakeside HOA"];

function openItems(): Item[] {
  return [
    item(
      "ent_01",
      "2026-10-16",
      "check",
      "2207",
      "Harrington Holdings",
      HARRINGTON,
      2_500_000,
      true,
    ),
    item(
      "ent_02",
      "2026-10-17",
      "check",
      "10411",
      "Nevada Escrow Inc.",
      HARRINGTON,
      -480_000,
      true,
    ),
    item("ent_03", "2026-10-19", "electronic_transfer", null, "Lakeside HOA", SMITH, 150_000, true),
    item("ent_04", "2026-10-20", "cash", null, "Daniel Okafor", OKAFOR, 100_000, false),
    item("ent_05", "2026-10-21", "cash", null, "Amara Okafor", OKAFOR, 100_000, true),
    item("ent_06", "2026-10-22", "check", "10418", "Reno Courier LLC", RENO, -125_000, false),
    item("ent_07", "2026-10-23", "wire", null, "Coastline Marine", HARRINGTON, -1_200_000, true),
    item("ent_08", "2026-10-24", "check", "10416", "Clark County Recorder", CLARK, -330_000, true),
    item("ent_09", "2026-10-27", "wire", null, "Jordan Smith", SMITH, 100_000, false),
    item("ent_10", "2026-10-28", "card", null, "Priya Raman", CLARK, 11_240, true),
    item("ent_11", "2026-10-29", "check", "10419", "Desert Title Co.", HARRINGTON, -300_000, false),
    item(
      "ent_12",
      "2026-10-30",
      "check",
      "10420",
      "Clark County Recorder",
      CLARK,
      -125_000,
      false,
      {
        isNew: true,
        recordedAt: "2026-11-06T16:42:00.000Z",
      },
    ),
    item("ent_13", "2026-10-31", "bank_charge", null, "First Example Bank", null, -1_500, false, {
      firmFunds: true,
      movementId: null,
      purpose: null,
      description: "Monthly service charge",
    }),
    item(
      "ent_14",
      "2026-10-31",
      "electronic_transfer",
      null,
      "Harrington Holdings",
      HARRINGTON,
      -40_000,
      true,
      {
        type: "transfer",
        description: "Earned fees to operating",
        purpose: "Invoice 2026-0412",
      },
    ),
  ];
}

interface Store {
  detail: TrustBankReconciliationDetail;
  /** Who made each change, newest last; Undo and Redo walk the reader's own. */
  redo: TrustBankReconciliationChange[];
  serial: number;
}

function header(
  state: ReconciliationGalleryState,
): TrustBankReconciliationDetail["reconciliation"] {
  const finished = state === "finished";
  const first = state === "first";
  return {
    trustBankReconciliationId: GALLERY_RECONCILIATION_ID,
    trustAccountId: GALLERY_ACCOUNT_ID,
    currency: "USD",
    startDate: first ? "2026-05-01" : "2026-10-16",
    startBalanceMinor: first ? 30_000_000 : 40_514_055,
    startCarriedOver: !first,
    startedBy: COLLEAGUE,
    startedByName: COLLEAGUE_NAME,
    startedAt: "2026-11-05T17:02:00.000Z",
    finishedBy: finished ? ME : null,
    finishedByName: finished ? ME_NAME : null,
    finishedAt: finished ? "2026-11-07T22:15:00.000Z" : null,
  };
}

function initialStore(state: ReconciliationGalleryState): Store {
  const items = state === "first" ? [] : openItems();
  if (state === "finished") for (const one of items) one.cleared = one.entryId !== "ent_09";
  const interest =
    state === "first"
      ? []
      : [
          {
            interestId: "tbi_credit",
            kind: "credited" as const,
            postedOn: "2026-10-31",
            amountMinor: 1_000,
            description: "Interest credited by bank",
            cleared: true,
            recordedBy: COLLEAGUE,
            recordedAt: "2026-11-05T17:30:00.000Z",
          },
          {
            interestId: "tbi_sweep",
            kind: "swept" as const,
            postedOn: "2026-10-31",
            amountMinor: 1_000,
            description: "Swept to Nevada Bar Foundation",
            cleared: true,
            recordedBy: COLLEAGUE,
            recordedAt: "2026-11-05T17:30:00.000Z",
          },
        ];
  const reconciliation = header(state);
  const endBalanceMinor = state === "first" ? null : 41_280_619;
  const notes: TrustBankReconciliationDetail["notes"] =
    state === "first"
      ? []
      : [
          {
            noteId: "tbn_1",
            line: { kind: "entry", entryId: "ent_09" },
            kind: "needs_review",
            body: null,
            writtenBy: COLLEAGUE,
            writtenByName: COLLEAGUE_NAME,
            writtenAt: "2026-11-05T18:14:00.000Z",
          },
          {
            noteId: "tbn_2",
            line: { kind: "entry", entryId: "ent_09" },
            kind: "note",
            body: "Not on the October statement. Client says it was sent on the 27th.",
            writtenBy: COLLEAGUE,
            writtenByName: COLLEAGUE_NAME,
            writtenAt: "2026-11-05T18:14:30.000Z",
          },
          {
            noteId: "tbn_3",
            line: { kind: "entry", entryId: "ent_09" },
            kind: "note",
            body: "Bank shows it landing Nov 2. Leave it uncleared; it should clear on the next one.",
            writtenBy: ME,
            writtenByName: ME_NAME,
            writtenAt: "2026-11-06T23:02:00.000Z",
          },
          {
            noteId: "tbn_4",
            line: { kind: "entry", entryId: "ent_06" },
            kind: "note",
            body: "Check 10418 not cashed yet. Asked Reno Courier to deposit it.",
            writtenBy: ME,
            writtenByName: ME_NAME,
            writtenAt: "2026-11-06T23:10:00.000Z",
          },
        ];
  const files: TrustBankReconciliationDetail["files"] =
    state === "first"
      ? []
      : [
          {
            fileId: "tbf_1",
            name: "Statement Oct 2026.pdf",
            contentType: "application/pdf",
            sizeBytes: 482_113,
            recordedBy: COLLEAGUE,
            recordedAt: "2026-11-05T17:03:00.000Z",
          },
          {
            fileId: "tbf_2",
            name: "Deposit slip 0031.pdf",
            contentType: "application/pdf",
            sizeBytes: 88_002,
            recordedBy: ME,
            recordedAt: "2026-11-06T22:40:00.000Z",
          },
        ];
  const store: Store = {
    detail: {
      reconciliation,
      endDate: state === "first" ? "2026-05-31" : "2026-10-31",
      endBalanceMinor,
      figures: figuresOf(
        reconciliation.currency,
        reconciliation.startBalanceMinor,
        endBalanceMinor,
        items,
        interest,
      ),
      items,
      interest,
      notes,
      files,
      changes: [],
      restorePoints: [],
      undoChangeId: null,
      redoChangeId: null,
      version: 0,
    },
    redo: [],
    serial: 0,
  };
  // A history to read: the period's first changes, made by the two of them.
  if (state !== "first") {
    let at = Date.parse("2026-11-05T17:05:00.000Z");
    const record = (
      kind: TrustBankReconciliationChange["kind"],
      line: TrustBankReconciliationLine | null,
      by: string,
      byName: string,
    ): void => {
      store.serial += 1;
      at += 90_000;
      store.detail.changes.push({
        changeId: `tbc_${store.serial}`,
        sequence: store.serial,
        kind,
        line,
        endDate: kind === "end_date" ? store.detail.endDate : null,
        endBalanceMinor: kind === "end_balance" ? endBalanceMinor : null,
        cause: "edit",
        revertsChangeId: null,
        restorePointId: null,
        changedBy: by,
        changedByName: byName,
        changedAt: new Date(at).toISOString(),
        canRevert: kind !== "end_date",
      });
    };
    record("end_date", null, COLLEAGUE, COLLEAGUE_NAME);
    record("end_balance", null, COLLEAGUE, COLLEAGUE_NAME);
    for (const one of items.filter((candidate) => candidate.cleared)) {
      record(
        "cleared",
        { kind: "entry", entryId: one.entryId },
        one.entryId < "ent_06" ? COLLEAGUE : ME,
        one.entryId < "ent_06" ? COLLEAGUE_NAME : ME_NAME,
      );
    }
    store.detail.restorePoints.push({
      restorePointId: "tbp_1",
      name: "Deposits done",
      atSequence: 5,
      automatic: false,
      savedBy: COLLEAGUE,
      savedByName: COLLEAGUE_NAME,
      savedAt: "2026-11-05T17:20:00.000Z",
    });
  }
  settle(store);
  return store;
}

/** Work the figures, the version and the reader's own undo and redo out again. */
function settle(store: Store): void {
  const detail = store.detail;
  detail.figures = figuresOf(
    detail.reconciliation.currency,
    detail.reconciliation.startBalanceMinor,
    detail.endBalanceMinor,
    detail.items,
    detail.interest,
  );
  detail.version = detail.changes.length;
  const reverted = new Set(
    detail.changes.map((change) => change.revertsChangeId).filter((id) => id !== null),
  );
  const own = detail.changes.filter(
    (change) =>
      change.changedBy === ME && change.cause === "edit" && !reverted.has(change.changeId),
  );
  detail.undoChangeId = own.at(-1)?.changeId ?? null;
  detail.redoChangeId = store.redo.at(-1)?.changeId ?? null;
  detail.changes = detail.changes.map((change) => ({
    ...change,
    canRevert:
      change.kind !== "end_date" && change.cause !== "history" && !reverted.has(change.changeId),
  }));
}

function ok<T>(value: T): Promise<ApiOutcome<T>> {
  return Promise.resolve({ kind: "ok", value });
}

const done = (): Promise<ApiOutcome<unknown>> => ok({ ok: true });

function applyChange(
  store: Store,
  kind: TrustBankReconciliationChange["kind"],
  line: TrustBankReconciliationLine | null,
  values: { endDate?: string; endBalanceMinor?: number },
  cause: TrustBankReconciliationChange["cause"],
  revertsChangeId: string | null,
): TrustBankReconciliationChange {
  const detail = store.detail;
  if (kind === "cleared" || kind === "uncleared") {
    const cleared = kind === "cleared";
    if (line?.kind === "entry") {
      detail.items = detail.items.map((one) =>
        one.entryId === line.entryId ? { ...one, cleared } : one,
      );
    } else if (line?.kind === "interest") {
      detail.interest = detail.interest.map((one) =>
        one.interestId === line.interestId ? { ...one, cleared } : one,
      );
    }
  }
  if (kind === "end_balance" && values.endBalanceMinor !== undefined)
    detail.endBalanceMinor = values.endBalanceMinor;
  if (kind === "end_date" && values.endDate !== undefined) detail.endDate = values.endDate;
  store.serial += 1;
  const change: TrustBankReconciliationChange = {
    changeId: `tbc_${store.serial}`,
    sequence: store.serial,
    kind,
    line,
    endDate: kind === "end_date" ? (values.endDate ?? null) : null,
    endBalanceMinor: kind === "end_balance" ? (values.endBalanceMinor ?? null) : null,
    cause,
    revertsChangeId,
    restorePointId: null,
    changedBy: ME,
    changedByName: ME_NAME,
    changedAt: new Date().toISOString(),
    canRevert: true,
  };
  detail.changes = [...detail.changes, change];
  return change;
}

/** What undoing a change writes: the tick the other way, or the value before it. */
function inverse(
  store: Store,
  change: TrustBankReconciliationChange,
): {
  kind: TrustBankReconciliationChange["kind"];
  values: { endDate?: string; endBalanceMinor?: number };
} {
  if (change.kind === "cleared") return { kind: "uncleared", values: {} };
  if (change.kind === "uncleared") return { kind: "cleared", values: {} };
  const before = store.detail.changes
    .filter((one) => one.kind === change.kind && one.sequence < change.sequence)
    .at(-1);
  if (change.kind === "end_balance")
    return { kind: "end_balance", values: { endBalanceMinor: before?.endBalanceMinor ?? 0 } };
  return { kind: "end_date", values: { endDate: before?.endDate ?? store.detail.endDate } };
}

const SUMMARY_PERIODS: readonly [
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  string | null,
][] = [
  ["2026-10-01", "2026-10-15", 39_814_055, 6_600_000, 5_900_000, 0, 1, "2026-10-17T21:00:00.000Z"],
  ["2026-09-01", "2026-09-30", 37_190_210, 6_148_000, 3_524_155, 0, 2, "2026-10-06T21:00:00.000Z"],
  ["2026-08-01", "2026-08-31", 35_501_844, 4_011_000, 2_322_634, 0, 1, "2026-09-04T21:00:00.000Z"],
  [
    "2026-07-01",
    "2026-07-31",
    34_160_000,
    2_845_000,
    1_503_156,
    1_000,
    1,
    "2026-08-09T21:00:00.000Z",
  ],
  ["2026-06-01", "2026-06-30", 31_877_502, 3_590_000, 1_307_502, 0, 1, "2026-07-03T21:00:00.000Z"],
  ["2026-05-01", "2026-05-31", 30_000_000, 2_277_502, 400_000, 0, 1, "2026-06-05T21:00:00.000Z"],
];

function summaries(
  store: Store,
  state: ReconciliationGalleryState,
): TrustBankReconciliationSummary[] {
  const detail = store.detail;
  const review = linesNeedingReview(detail.notes);
  const open: TrustBankReconciliationSummary = {
    reconciliation: detail.reconciliation,
    endDate: detail.endDate,
    endBalanceMinor: detail.endBalanceMinor,
    depositedMinor: detail.figures.depositedMinor,
    withdrawnMinor: detail.figures.withdrawnMinor,
    clearedBalanceMinor: detail.figures.clearedBalanceMinor,
    differenceMinor: detail.figures.differenceMinor,
    fileCount: detail.files.length,
    noteCount: detail.notes.filter((note) => note.kind === "note").length,
    needsReviewCount: review.size,
    interestCreditedMinor: interestTotalMinor(
      detail.reconciliation.currency,
      detail.interest,
      "credited",
    ),
    interestSweptMinor: interestTotalMinor(
      detail.reconciliation.currency,
      detail.interest,
      "swept",
    ),
  };
  if (state === "first") return [open];
  const earlier = SUMMARY_PERIODS.map(
    (
      [startDate, endDate, start, deposited, withdrawn, difference, files, finishedAt],
      index,
    ): TrustBankReconciliationSummary => {
      const cleared = start + deposited - withdrawn;
      return {
        reconciliation: {
          trustBankReconciliationId: `tbr_gallery_${index}`,
          trustAccountId: GALLERY_ACCOUNT_ID,
          currency: "USD",
          startDate,
          startBalanceMinor: start,
          startCarriedOver: index !== SUMMARY_PERIODS.length - 1,
          startedBy: ME,
          startedByName: ME_NAME,
          startedAt: `${endDate}T20:00:00.000Z`,
          finishedBy: index === 3 ? COLLEAGUE : ME,
          finishedByName: index === 3 ? COLLEAGUE_NAME : ME_NAME,
          finishedAt,
        },
        endDate,
        endBalanceMinor: cleared + difference,
        depositedMinor: deposited,
        withdrawnMinor: withdrawn,
        clearedBalanceMinor: cleared,
        differenceMinor: difference,
        fileCount: files,
        noteCount: index === 3 ? 2 : 0,
        needsReviewCount: index === 3 ? 1 : 0,
        interestCreditedMinor: 900 + index * 25,
        interestSweptMinor: 900 + index * 25,
      };
    },
  );
  return [open, ...earlier];
}

export function galleryReconciliationService(
  state: ReconciliationGalleryState,
): ReconciliationService {
  const store = initialStore(state);
  const never = (): Promise<never> => new Promise(() => {});
  const failing = <T>(): Promise<ApiOutcome<T>> =>
    Promise.resolve(transportOutcome<T>("GET /api/v1/trust/bank-reconciliations"));

  const read = (): Promise<ApiOutcome<TrustBankReconciliationDetail>> => {
    if (state === "loading") return never();
    if (state === "failed") return failing();
    return ok(structuredClone(store.detail));
  };

  const readList = (): Promise<ApiOutcome<TrustBankReconciliationList>> => {
    if (state === "loading") return never();
    if (state === "failed") return failing();
    const finished = store.detail.reconciliation.finishedAt !== null;
    return ok({
      reconciliations: summaries(store, state),
      nextStart:
        finished && store.detail.endBalanceMinor !== null
          ? { startDate: "2026-11-01", startBalanceMinor: store.detail.endBalanceMinor }
          : null,
    });
  };

  const edit = (
    _id: string,
    edits: readonly TrustBankReconciliationEdit[],
  ): Promise<ApiOutcome<unknown>> => {
    for (const one of edits) {
      if (one.kind === "tick")
        applyChange(store, one.cleared ? "cleared" : "uncleared", one.line, {}, "edit", null);
      else if (one.kind === "end_date")
        applyChange(store, "end_date", null, { endDate: one.endDate }, "edit", null);
      else
        applyChange(
          store,
          "end_balance",
          null,
          { endBalanceMinor: one.endBalanceMinor },
          "edit",
          null,
        );
    }
    store.redo = [];
    settle(store);
    return done();
  };

  return {
    readList,
    read,
    start: () => ok({ trustBankReconciliationId: GALLERY_RECONCILIATION_ID }),
    edit,
    revert: (_id, body) => {
      const detail = store.detail;
      if (body.kind === "redo") {
        const target = store.redo.pop();
        if (target !== undefined) {
          const turn = inverse(store, target);
          applyChange(store, turn.kind, target.line, turn.values, "redo", target.changeId);
        }
      } else {
        const changeId = body.kind === "undo" ? detail.undoChangeId : body.changeId;
        const target = detail.changes.find((one) => one.changeId === changeId);
        if (target !== undefined) {
          const turn = inverse(store, target);
          const undone = applyChange(
            store,
            turn.kind,
            target.line,
            turn.values,
            body.kind === "undo" ? "undo" : "history",
            target.changeId,
          );
          if (body.kind === "undo") store.redo.push(undone);
        }
      }
      settle(store);
      return done();
    },
    save: (_id, name) => {
      store.detail.restorePoints = [
        ...store.detail.restorePoints,
        {
          restorePointId: `tbp_${store.detail.restorePoints.length + 1}`,
          name,
          atSequence: store.serial,
          automatic: false,
          savedBy: ME,
          savedByName: ME_NAME,
          savedAt: new Date().toISOString(),
        },
      ];
      return done();
    },
    restore: (_id, restorePointId) => {
      const point = store.detail.restorePoints.find((one) => one.restorePointId === restorePointId);
      if (point === undefined) return done();
      const atPoint = store.detail.changes.filter((one) => one.sequence <= point.atSequence);
      const marks = new Map<string, boolean>();
      for (const change of atPoint) {
        if (change.line !== null && (change.kind === "cleared" || change.kind === "uncleared")) {
          marks.set(lineKey(change.line), change.kind === "cleared");
        }
      }
      for (const one of store.detail.items) {
        const wanted = marks.get(`entry:${one.entryId}`) ?? false;
        if (wanted !== one.cleared) {
          const change = applyChange(
            store,
            wanted ? "cleared" : "uncleared",
            { kind: "entry", entryId: one.entryId },
            {},
            "restore",
            null,
          );
          change.restorePointId = restorePointId;
        }
      }
      settle(store);
      return done();
    },
    addInterest: (_id, body) => {
      const add = (kind: "credited" | "swept"): void => {
        const interestId = `tbi_${store.detail.interest.length + 1}_${kind}`;
        store.detail.interest = [
          ...store.detail.interest,
          {
            interestId,
            kind,
            postedOn: body.postedOn,
            amountMinor: body.amountMinor,
            description: kind === body.kind ? body.description : "Swept to Nevada Bar Foundation",
            cleared: false,
            recordedBy: ME,
            recordedAt: new Date().toISOString(),
          },
        ];
        applyChange(store, "cleared", { kind: "interest", interestId }, {}, "edit", null);
      };
      add(body.kind);
      if (body.kind === "credited" && body.alsoSweep === true) add("swept");
      settle(store);
      return done();
    },
    removeInterest: (_id, interestId) => {
      store.detail.interest = store.detail.interest.filter((one) => one.interestId !== interestId);
      settle(store);
      return done();
    },
    addNote: (_id, body) => {
      store.detail.notes = [
        ...store.detail.notes,
        {
          noteId: `tbn_${store.detail.notes.length + 10}`,
          line: body.line,
          kind: body.kind,
          body: body.body ?? null,
          writtenBy: ME,
          writtenByName: ME_NAME,
          writtenAt: new Date().toISOString(),
        },
      ];
      return done();
    },
    attachFile: (_id, file) => {
      store.detail.files = [
        ...store.detail.files,
        {
          fileId: `tbf_${store.detail.files.length + 10}`,
          name: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          recordedBy: ME,
          recordedAt: new Date().toISOString(),
        },
      ];
      return done();
    },
    removeFile: (_id, fileId) => {
      store.detail.files = store.detail.files.filter((one) => one.fileId !== fileId);
      return done();
    },
    finish: () => {
      store.detail.reconciliation = {
        ...store.detail.reconciliation,
        finishedAt: new Date().toISOString(),
        finishedBy: ME,
        finishedByName: ME_NAME,
      };
      return done();
    },
    fileUrl: () => Promise.resolve(null),
    composeReport: composeReportPdf,
    openPdf,
    openUrl: () => {},
  };
}
