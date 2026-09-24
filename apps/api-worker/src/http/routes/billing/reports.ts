import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { CANONICAL_INSTANT_PATTERN } from "@magna-carta/civil-time/instant";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { isValidCalendarDate } from "@magna-carta/ledger/validate";
import { ReportingValidationError } from "@magna-carta/reporting/reporting-validation";
import { resolveReportingPeriod } from "@magna-carta/reporting/temporal";
import { assembleTrustCompliancePack } from "@magna-carta/reporting/trust-compliance/pack";
import { refusingTrustJurisdictions } from "@magna-carta/trust/jurisdiction";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierField } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { readTrustComplianceReportPolicy } from "../../../reporting/trust-compliance-report-policy.ts";

// REPORTING — projections over records the firm already holds, and nothing else.
//
// Every route in this module is a GET. The reporting package composes nothing, holds no binding, and
// a fitness function over its sources proves it cannot write; this surface is the other half of that
// guarantee, and the conformance suite asserts that every `reports:` route is a read.
//
// The capability is its own namespace rather than a corner of `trust:read`: an aggregate across every
// matter and client in a firm is a different exposure from a per-matter read, and it is gated
// accordingly — seeded to Owner/Admin, and widened by a direct grant that leaves a record.

const TRUST_COMPLIANCE = "reports:trustCompliance" as const;

// A real calendar date, not a shape: a bare pattern accepts 2026-02-30, which the reporting package
// refuses anyway but which a member should never have had to travel that far to hear about.
const civilDate = z
  .string()
  .regex(CIVIL_DATE_PATTERN)
  .refine(isValidCalendarDate, { message: "not a calendar date" });

// The knowledge instant, in exactly the shape `recorded_at` is written in. Strict rather than
// permissive: the value is compared lexicographically against stored instants, so a different shape
// would filter wrong rather than fail — quietly dropping rows the caller meant to include.
const knowledgeInstant = z.string().regex(CANONICAL_INSTANT_PATTERN);

const trustCompliancePackQuery = z.object({
  periodStart: civilDate,
  periodEnd: civilDate,
  // Omitting it means "everything known now", which produces a live report — stamped, and explicitly
  // not claimed to reproduce. The distinction is carried in the response because a reader cannot
  // tell the two apart from the figures.
  knownAsOf: knowledgeInstant.optional(),
  // Whether a matter ledger that was at zero throughout the period appears, and whether the ledgers
  // and the journal name the member who authorized money leaving a client ledger. Both are the
  // firm's POLICY (Settings, Reports) and default from it when absent, so the firm's document reads
  // the same every time it is produced; a caller may still state either, and the provenance section
  // records what was used.
  zeroBalanceLedgers: z.enum(["include", "omit"]).optional(),
  authorizers: z.enum(["include", "omit"]).optional(),
});

const trustAccountPath = z.object({ trustAccountId: identifierField("trustAccount") });

const ReportCompleteness = z
  .discriminatedUnion("scope", [
    z.object({ scope: z.literal("complete") }),
    z.object({
      scope: z.literal("complete-not-itemized"),
      notItemizedMatterCount: z.number().int(),
    }),
    z.object({ scope: z.literal("screened"), excludedMatterCount: z.number().int() }),
  ])
  .openapi("ReportCompleteness");

const ReportReproducibility = z
  .discriminatedUnion("reproducible", [
    z.object({
      reproducible: z.literal(true),
      periodStart: z.string(),
      periodEnd: z.string(),
      knownAsOf: z.string(),
    }),
    z.object({
      reproducible: z.literal(false),
      periodStart: z.string(),
      periodEnd: z.string(),
      computedAt: z.string(),
    }),
  ])
  .openapi("ReportReproducibility");

const TrustComplianceJurisdiction = z
  .discriminatedUnion("available", [
    z.object({
      available: z.literal(true),
      jurisdiction: z.string(),
      requirement: z.string(),
      citation: z.string(),
      binding: z.boolean(),
    }),
    z.object({
      available: z.literal(false),
      jurisdiction: z.string().nullable(),
      refusalCode: z.string(),
      refusalDetail: z.string(),
    }),
  ])
  .openapi("TrustComplianceJurisdiction");

const TrustComplianceCover = z
  .object({
    trustAccountId: z.string(),
    trustAccountName: z.string(),
    locationId: z.string(),
    currency: z.string(),
    pooledInterestBearing: z.boolean(),
    accountStatus: z.enum(["open", "closed"]),
    bankName: z.string().nullable(),
    accountNumberLastFour: z.string().nullable(),
    jurisdiction: TrustComplianceJurisdiction,
    bankChargeCarveOutOpen: z.boolean(),
    reproducibility: ReportReproducibility,
    reproducibilityStatement: z.string(),
    completeness: ReportCompleteness,
  })
  .openapi("TrustComplianceCover");

const FrozenProof = z
  .object({
    statementClosingMinor: z.number().int(),
    outstandingDepositsMinor: z.number().int(),
    outstandingDisbursementsMinor: z.number().int(),
    adjustedBankMinor: z.number().int(),
    bookBalanceMinor: z.number().int(),
    clientLedgerTotalMinor: z.number().int(),
    firmFundsMinor: z.number().int(),
    unmatchedLineCount: z.number().int(),
    unmatchedItemCount: z.number().int(),
    balanced: z.boolean(),
  })
  .openapi("TrustComplianceFrozenProof");

const BankItem = z
  .object({
    entryId: z.string(),
    effectiveDate: z.string(),
    description: z.string(),
    bankDeltaMinor: z.number().int(),
    movementId: z.string().nullable(),
    movementKind: z.string().nullable(),
    transferId: z.string().nullable(),
    reference: z.string().nullable(),
    counterpartyName: z.string().nullable(),
  })
  .openapi("TrustComplianceBankItem");

const StatementLine = z
  .object({
    id: z.string(),
    statementId: z.string(),
    postedOn: z.string(),
    direction: z.string(),
    amountMinor: z.number().int(),
    description: z.string(),
    reference: z.string().nullable(),
    counterpartyName: z.string().nullable(),
    sourceRowNumber: z.number().int().nullable(),
  })
  .openapi("TrustComplianceStatementLine");

const LiveProof = z
  .object({
    trustAccountId: z.string(),
    statementId: z.string(),
    asOfDate: z.string(),
    currency: z.string(),
    statementClosingMinor: z.number().int(),
    outstandingDeposits: z.array(BankItem),
    outstandingDepositsMinor: z.number().int(),
    outstandingDisbursements: z.array(BankItem),
    outstandingDisbursementsMinor: z.number().int(),
    adjustedBankMinor: z.number().int(),
    bookBalanceMinor: z.number().int(),
    clientLedgerTotalMinor: z.number().int(),
    firmFundsMinor: z.number().int(),
    unmatchedStatementLines: z.array(StatementLine),
    balanced: z.boolean(),
    disagreements: z.array(z.object({ leg: z.string(), differenceMinor: z.number().int() })),
  })
  .openapi("TrustComplianceLiveProof");

const ProofDifference = z
  .object({
    leg: z.string(),
    attestedMinor: z.number().int(),
    liveMinor: z.number().int(),
    differenceMinor: z.number().int(),
  })
  .openapi("TrustComplianceProofDifference");

const Reconciliation = z
  .object({
    reconciliationId: z.string(),
    statementId: z.string(),
    statementPeriodStart: z.string(),
    statementPeriodEnd: z.string(),
    statementReference: z.string().nullable(),
    openedBy: z.string(),
    openedAt: z.string(),
    statusAsKnown: z.enum(["open", "closed"]),
    closedBy: z.string().nullable(),
    closedAt: z.string().nullable(),
    frozenProof: FrozenProof.nullable(),
    proofAtProduction: z.object({
      computedAt: z.string(),
      boundedByKnowledgeInstant: z.literal(false),
      proof: LiveProof,
      differencesFromAttestation: z.array(ProofDifference),
    }),
  })
  .openapi("TrustComplianceReconciliation");

const LedgerEntry = z
  .object({
    entryId: z.string(),
    effectiveDate: z.string(),
    recordedAt: z.string(),
    description: z.string(),
    reversesEntryId: z.string().nullable(),
    direction: z.enum(["debit", "credit"]),
    amountMinor: z.number().int(),
    deltaMinor: z.number().int(),
    runningBalanceMinor: z.number().int(),
    movementId: z.string().nullable(),
    movementKind: z.string().nullable(),
    method: z.string().nullable(),
    reference: z.string().nullable(),
    counterpartyName: z.string().nullable(),
    purpose: z.string().nullable(),
    transferId: z.string().nullable(),
    authorizedBy: z.string().nullable(),
    recordedBy: z.string().nullable(),
  })
  .openapi("TrustComplianceLedgerEntry");

const MatterLedger = z
  .object({
    nodeId: z.string(),
    matterId: z.string().nullable(),
    ledgerAccountId: z.string(),
    openingBalanceMinor: z.number().int(),
    closingBalanceMinor: z.number().int(),
    entries: z.array(LedgerEntry),
  })
  .openapi("TrustComplianceMatterLedger");

const ClientLedger = z
  .object({
    clientEntityId: z.string().nullable(),
    openingBalanceMinor: z.number().int(),
    closingBalanceMinor: z.number().int(),
    matters: z.array(MatterLedger),
  })
  .openapi("TrustComplianceClientLedger");

const JournalEntry = z
  .object({
    entryId: z.string(),
    effectiveDate: z.string(),
    recordedAt: z.string(),
    description: z.string(),
    reversesEntryId: z.string().nullable(),
    bankDeltaMinor: z.number().int(),
    runningBalanceMinor: z.number().int(),
    movementId: z.string().nullable(),
    movementKind: z.string().nullable(),
    transferId: z.string().nullable(),
    firmFundsMovementId: z.string().nullable(),
    firmFundsMovementKind: z.string().nullable(),
    method: z.string().nullable(),
    reference: z.string().nullable(),
    counterpartyName: z.string().nullable(),
    purpose: z.string().nullable(),
    nodeId: z.string().nullable(),
    counterpartyNodeId: z.string().nullable(),
    authorizedBy: z.string().nullable(),
    recordedBy: z.string().nullable(),
  })
  .openapi("TrustComplianceJournalEntry");

const Cushion = z
  .object({
    nodeId: z.string(),
    openingBalanceMinor: z.number().int(),
    closingBalanceMinor: z.number().int(),
    movements: z.array(
      z.object({
        firmFundsMovementId: z.string(),
        kind: z.enum(["firm_funds_deposit", "bank_charge"]),
        effectiveDate: z.string(),
        recordedAt: z.string(),
        amountMinor: z.number().int(),
        method: z.string(),
        reference: z.string().nullable(),
        description: z.string(),
        recordedBy: z.string(),
      }),
    ),
  })
  .openapi("TrustComplianceCushion");

const Exceptions = z
  .object({
    holdsInForceAtKnowledgeInstant: z.array(
      z.object({
        holdId: z.string(),
        nodeId: z.string(),
        matterId: z.string().nullable(),
        clientEntityId: z.string().nullable(),
        amountMinor: z.number().int(),
        reason: z.string(),
        placedAt: z.string(),
        placedBy: z.string().nullable(),
      }),
    ),
    atProduction: z.object({
      computedAt: z.string(),
      boundedByKnowledgeInstant: z.literal(false),
      outstandingBankItems: z.array(BankItem),
      unmatchedStatementLines: z.array(
        z.object({ reconciliationId: z.string(), line: StatementLine }),
      ),
      storedBalanceDisagreements: z.array(
        z.object({
          ledgerAccountId: z.string(),
          storedBalanceMinor: z.number().int(),
          computedBalanceMinor: z.number().int(),
        }),
      ),
    }),
  })
  .openapi("TrustComplianceExceptions");

const TrustCompliancePackResponse = z
  .object({
    cover: TrustComplianceCover,
    reconciliations: z.array(Reconciliation),
    reconciliationNote: z.string().nullable(),
    proofAtProductionNote: z.string(),
    clientLedgers: z.array(ClientLedger),
    journal: z.object({
      openingBalanceMinor: z.number().int(),
      closingBalanceMinor: z.number().int(),
      entries: z.array(JournalEntry),
    }),
    cushion: Cushion.nullable(),
    exceptions: Exceptions,
    provenance: z.object({
      requestedBy: z.string().nullable(),
      computedAt: z.string(),
      periodStart: z.string(),
      periodEnd: z.string(),
      knownAsOf: z.string().nullable(),
      packShapeVersion: z.number().int(),
      options: z.object({
        zeroBalanceLedgers: z.enum(["include", "omit"]),
        authorizers: z.enum(["include", "omit"]),
      }),
    }),
  })
  .openapi("TrustCompliancePack");

const trustCompliancePackMeta: RouteMeta = {
  operationId: "reports.trustCompliancePack",
  surface: "app",
  authenticated: true,
  permission: TRUST_COMPLIANCE,
  // A trust account belongs to an office and its ledger spans every matter a client has, so the
  // capability is firm-scoped — the same binding every trust route carries.
  resource: "firm",
  // A read audits nothing: the chokepoint's audit record exists for mutations, and this route
  // changes nothing a firm could later need to reconstruct.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const trustCompliancePackRoute = defineOpenAPIRoute(trustCompliancePackMeta, {
  method: "get",
  path: "/api/v1/reports/trust-compliance/{trustAccountId}",
  description:
    "The trust-compliance pack for one trust account over one period: every movement of client money, each client's and each matter's ledger, what the firm attested to at each reconciliation, and every item that did not tie out. Give it a period and a knowledge instant and every figure re-derives from records that can never change, so the same request answers identically however much has been recorded since; omit the knowledge instant and the answer covers everything known now, which is stamped and is not claimed to reproduce. Two blocks are labelled as outside that claim and carry their own instant: the three-way proof shown beside each attestation, and the outstanding items, unmatched statement lines and stored-balance checks in the exceptions section — each is read through the one definition the trust and ledger records already have, and none of those definitions is taken as at a past moment. A period too large to return in one document is refused by name rather than answered short.",
  request: { params: trustAccountPath, query: trustCompliancePackQuery },
  responses: {
    200: {
      description: "The pack for this trust account and period",
      content: { "application/json": { schema: TrustCompliancePackResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks reports:trustCompliance",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The firm is unreachable, the member is deactivated, or the trust account is unknown",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The period is not two calendar dates, it ends before it starts, the knowledge instant is not a UTC instant or is in the future, the period holds more of this account's activity than one document can carry, or the account's outstanding items are more than one reconciliation can account for",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// A refusal's status is a property of what the refusal MEANS, so the mapping lives in one place.
// The reporting package's own refusals and the trust package's are mapped side by side because a
// caller cannot tell which layer said no and does not need to: what they need is the remedy, which
// is in the message the refusing package wrote.
function reportingErrorResponse(
  c: Context,
  error: ReportingValidationError | TrustValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (error instanceof TrustValidationError && error.code === "unknown-trust-account") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  // The period asked for more than one document can carry. A shorter period is a real answer and the
  // message names it, which is why this is not a 500 and not a truncated 200.
  if (
    error instanceof ReportingValidationError &&
    error.code !== "reporting-period-not-a-calendar-date" &&
    error.code !== "reporting-period-inverted" &&
    error.code !== "reporting-knowledge-instant-not-an-instant" &&
    error.code !== "reporting-knowledge-instant-in-the-future"
  ) {
    return problemJson(c, {
      type: "report-period-too-large",
      title: "This period holds more than one document can carry",
      status: 422,
      detail: error.message,
    });
  }
  if (error instanceof ReportingValidationError) {
    return problemJson(c, {
      type: "report-period-invalid",
      title: "The period this report was asked for is not one that can be answered",
      status: 422,
      detail: error.message,
    });
  }
  // The four jurisdiction refusals and the truncated-outstanding-items refusal keep their own
  // problem type: each is fixed by a person doing something other than retrying — recording the
  // office's state, researching a jurisdiction, having an attorney review one, or reconciling the
  // earlier periods so the cleared items leave the outstanding list.
  return problemJson(c, {
    type: "report-cannot-be-produced",
    title: "This report cannot be produced for this account",
    status: 422,
    detail: error.message,
  });
}

type ReportsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerReportsRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...trustCompliancePackRoute,
      middleware: chokepointMiddleware(chokepoint, trustCompliancePackRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { trustAccountId } = c.req.valid("param");
      const query = c.req.valid("query");
      // The Worker has no user time zone on a request, so UTC is the resolution — the same one the
      // rest of the platform uses for a server-side "now". Read per request rather than once at
      // module scope, so a long-lived isolate cannot freeze it.
      const computedAt = new Date().toISOString();
      try {
        const period = resolveReportingPeriod(
          {
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            knownAsOf: query.knownAsOf ?? null,
          },
          computedAt,
        );
        const policy = await readTrustComplianceReportPolicy(firm.firmDatabase);
        const pack = await assembleTrustCompliancePack(
          firm.firmDatabase,
          {
            trustAccountId,
            period,
            requestedBy: null,
            options: {
              zeroBalanceLedgers: query.zeroBalanceLedgers ?? policy.zeroBalanceLedgers,
              authorizers: query.authorizers ?? policy.authorizers,
            },
          },
          {
            // The platform-wide default: nothing here binds a rules corpus, so every governing-rule
            // citation refuses and the pack states that on its cover rather than printing one. A
            // corpus reaches this surface when it is bound for the whole trust subsystem, which is a
            // decision about every trust surface rather than about reporting.
            jurisdictions: refusingTrustJurisdictions,
            computedAt,
          },
        );
        // The pack's arrays are `readonly` all the way down — the assembly hands back a value
        // nothing downstream may mutate — and the zod contract describes the same shapes without
        // that modifier. The cast crosses exactly that difference; the response schema above is what
        // the contract asserts, and the conformance suite checks it against the emitted document.
        return c.json(pack as unknown as z.infer<typeof TrustCompliancePackResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError || caught instanceof TrustValidationError) {
          return reportingErrorResponse(c, caught);
        }
        throw caught;
      }
    },
  );
}
