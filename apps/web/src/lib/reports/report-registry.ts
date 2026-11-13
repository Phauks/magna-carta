/*
 * THE REPORT REGISTRY — every report the platform offers, declared once as data.
 *
 * The screens render from this. `/reports` lists it grouped by family; `/reports/<id>` draws the
 * report's controls from its declaration, reads through its `read` port and arranges the answer
 * through its `present` port. Adding a report is one entry here plus a presenter; a second screen
 * per report is what this file exists to make unnecessary, on the same reasoning as the sidebar's
 * destinations registry: one shape, decided once, corrected once.
 *
 * ONLY REAL THINGS. A report whose backend is built carries both ports and opens. A report the
 * reporting design named and nobody has built yet is still declared — at stage `soon`, with what
 * it waits on, and with no ports, by type: a report that cannot be read cannot be presented, and
 * the union makes that combination unrepresentable rather than remembered. It renders in the
 * catalogue visible and disabled, which is the standing rule for a designed-but-unwired surface.
 *
 * THE TEMPORAL CONTRACT IS DECLARED, NOT INFERRED. A bitemporal report takes a knowledge instant
 * and the run screen draws the control; a live-only report does not accept one and the control is
 * absent, because a read that cannot honor an instant must never be offered one.
 */
import type { Component } from "svelte";
import Landmark from "@lucide/svelte/icons/landmark";
import ReceiptText from "@lucide/svelte/icons/receipt-text";
import Clock from "@lucide/svelte/icons/clock";
import ChartColumn from "@lucide/svelte/icons/chart-column";
import type { ApiOutcome } from "$lib/api/request.ts";
// Type-only: elided at build, so the plugin-less test config never resolves the alias.
import type { MaturityStage } from "@magna-carta/design-system/maturity";
import type { ReportPresentation } from "./report-presentation.ts";
import type { ReportScope } from "./report-scope.ts";
import {
  readTrustCompliancePack,
  TRUST_COMPLIANCE_PERMISSION,
  type TrustCompliancePack,
} from "./reports-api.ts";
import { sampleTrustCompliancePack } from "./trust-compliance-fixture.ts";
import { presentTrustCompliancePack, type ReportCaptions } from "./trust-compliance-presenter.ts";

export type ReportFamily = "trust-compliance" | "financial" | "productivity" | "operational";

/** The families in the order the catalogue shows them, each with its heading and its glyph. */
export const REPORT_FAMILIES: ReadonlyArray<{
  readonly id: ReportFamily;
  readonly label: string;
  readonly icon: Component;
}> = [
  { id: "trust-compliance", label: "Trust Compliance", icon: Landmark },
  { id: "financial", label: "Financial", icon: ReceiptText },
  { id: "productivity", label: "Productivity", icon: Clock },
  { id: "operational", label: "Operational", icon: ChartColumn },
];

/**
 * Whether the report takes a knowledge instant. `bitemporal` reads re-derive for a stated period
 * and instant; `live-only` reads are over mutable stores and are stamped with the instant they were
 * computed at instead.
 */
export type ReportTemporal = "bitemporal" | "live-only";

/** Which controls the run screen draws beside the period. */
export interface ReportScopeControls {
  /** The report is about one trust account, picked from the firm's roster. */
  readonly trustAccount: boolean;
}

/** The port that fetches a report over a scope. */
export type ReportReader<Payload> = (
  fetchImpl: typeof fetch,
  scope: ReportScope,
) => Promise<ApiOutcome<Payload>>;

/** The port that arranges a payload for the screen and the file. */
export type ReportPresenter<Payload> = (
  payload: Payload,
  captions: ReportCaptions,
) => ReportPresentation;

interface ReportDeclarationBase {
  /** The route segment: `/reports/<id>`. Kebab-case, spelled in full. */
  readonly id: string;
  readonly family: ReportFamily;
  /** The screen's title, taken from here and nowhere else. */
  readonly name: string;
  /** One line: the question the report answers. On the catalogue row. */
  readonly answers: string;
  /** The `reports:*` key the server enforces on the read. */
  readonly permission: string;
  readonly temporal: ReportTemporal;
}

/** A report the platform can run today. */
export interface BuiltReportDeclaration extends ReportDeclarationBase {
  readonly stage: Exclude<MaturityStage, "soon">;
  readonly scope: ReportScopeControls;
  /** Runs the read and the presenter together, so the payload type never leaves the declaration. */
  readonly run: (
    fetchImpl: typeof fetch,
    scope: ReportScope,
    captions: ReportCaptions,
  ) => Promise<ApiOutcome<ReportPresentation>>;
  /** The presentation over sample words, for the run screen's fixture. */
  readonly fixture: (captions: ReportCaptions) => ReportPresentation;
}

/** A report the design named and nobody has built. */
export interface SoonReportDeclaration extends ReportDeclarationBase {
  readonly stage: "soon";
  /** What it waits on, as a noun phrase the Soon composition completes into a sentence. */
  readonly waitsOn: string;
}

export type ReportDeclaration = BuiltReportDeclaration | SoonReportDeclaration;

/**
 * Pairs a reader with its presenter under one payload type, so a declaration cannot present a
 * payload it did not read.
 */
function built<Payload>(
  declaration: Omit<BuiltReportDeclaration, "run" | "fixture"> & {
    readonly read: ReportReader<Payload>;
    readonly present: ReportPresenter<Payload>;
    readonly samplePayload: () => Payload;
  },
): BuiltReportDeclaration {
  const { read, present, samplePayload, ...rest } = declaration;
  return {
    ...rest,
    run: async (fetchImpl, scope, captions) => {
      const outcome = await read(fetchImpl, scope);
      if (outcome.kind !== "ok") return outcome;
      return { kind: "ok", value: present(outcome.value, captions) };
    },
    fixture: (captions) => present(samplePayload(), captions),
  };
}

const trustCompliance = built<TrustCompliancePack>({
  id: "trust-compliance",
  family: "trust-compliance",
  name: "Trust Compliance Report",
  answers:
    "For one trust account over one period: every movement of client money, each client and matter ledger, each reconciliation, and anything that didn't balance.",
  permission: TRUST_COMPLIANCE_PERMISSION,
  temporal: "bitemporal",
  stage: "alpha",
  scope: { trustAccount: true },
  read: (fetchImpl, scope) => {
    // A scope with no subject never reaches here: the run screen reads only when the scope is
    // complete. The check stands so a caller that skips the screen gets a typed refusal, not a 404
    // for an account named "null".
    if (scope.subject === null) {
      throw new Error("the trust-compliance report is about one trust account, and none was named");
    }
    // What the pack lists (ledgers at zero, the authorizers) is the firm's report policy, applied
    // on the server and recorded on the provenance section; the screen states neither, so the
    // firm's document reads the same every time it is produced.
    return readTrustCompliancePack(fetchImpl, {
      trustAccountId: scope.subject,
      periodStart: scope.period.from,
      periodEnd: scope.period.to,
      ...(scope.knownAsOf === null ? {} : { knownAsOf: scope.knownAsOf }),
    });
  },
  present: presentTrustCompliancePack,
  samplePayload: () => sampleTrustCompliancePack(),
});

const REPORT_LIST = [
  trustCompliance,
  {
    id: "accounts-receivable-aging",
    family: "financial",
    name: "Accounts Receivable Aging",
    answers:
      "What the firm is owed, by how long it has been owed, per client, matter and office, at a stated date.",
    permission: "reports:financial",
    temporal: "bitemporal",
    stage: "soon",
    waitsOn: "the as-of receivables read in the billing package",
  },
  {
    id: "work-in-progress",
    family: "financial",
    name: "Work in Progress",
    answers:
      "Unbilled time and costs, by matter, client, timekeeper and office, as they stand now.",
    permission: "reports:financial",
    temporal: "live-only",
    stage: "soon",
    waitsOn: "the work-in-progress report over the time and cost records",
  },
  {
    id: "realization",
    family: "financial",
    name: "Realization",
    answers:
      "For a period: the standard value of time recorded, what was billed, what was credited or written off, and what was applied.",
    permission: "reports:financial",
    temporal: "bitemporal",
    stage: "soon",
    waitsOn: "the realization read over invoice line snapshots and applications",
  },
  {
    id: "timekeeper-productivity",
    family: "productivity",
    name: "Timekeeper Productivity",
    answers:
      "Hours recorded by each timekeeper in a period, billable against non-billable, by matter, client, task code and office.",
    permission: "reports:productivity",
    temporal: "live-only",
    stage: "soon",
    waitsOn: "the productivity read over the time records",
  },
  {
    id: "operational-volumes",
    family: "operational",
    name: "Operational Volumes",
    answers:
      "How much the firm did in a period: matters opened and closed, bills drafted and finalized, trust movements, disbursement requests, reconciliations.",
    permission: "reports:operational",
    temporal: "bitemporal",
    stage: "soon",
    waitsOn: "the operational counts over the matter, invoice, trust and cost records",
  },
] as const satisfies readonly ReportDeclaration[];

/** Every report, in catalogue order. */
export const REPORTS: readonly ReportDeclaration[] = REPORT_LIST;

/** The literal union of report ids, so a link to a report is a type error when it names none. */
export type ReportId = (typeof REPORT_LIST)[number]["id"];

export function reportById(id: string): ReportDeclaration | null {
  return REPORTS.find((report) => report.id === id) ?? null;
}

/** The reports in one family, in catalogue order. */
export function reportsInFamily(family: ReportFamily): readonly ReportDeclaration[] {
  return REPORTS.filter((report) => report.family === family);
}

export function reportHref(report: ReportDeclaration): string {
  return `/reports/${report.id}`;
}

/** Whether a declaration is one the platform can run today. */
export function isBuiltReport(report: ReportDeclaration): report is BuiltReportDeclaration {
  return report.stage !== "soon";
}
