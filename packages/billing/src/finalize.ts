import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { assertTransition, type BillableStatus } from "@magna-carta/billing-core/lifecycle";
import type {
  InvoiceId,
  LedgerAccountId,
  LocationId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { postEntry } from "@magna-carta/ledger/post-entry";
import type { EntryLineInput } from "@magna-carta/ledger/types";
import { currencyFromCode, money } from "@magna-carta/money/money";
import {
  ensureCounterRowStatement,
  guardedIncrementStatement,
  readCounterValue,
} from "@magna-carta/sequence-numbering/counter-statements";
import { allocateCounterValueStatement } from "@magna-carta/sequence-numbering/counter-statements";
import { readAccountRoleMap, resolveAccountRole, type AccountRoleMap } from "./account-roles.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { aggregateMinor } from "./line-amounts.ts";
import {
  FIRM_WIDE_NUMBER_SCOPE,
  INVOICE_NUMBER_START_VALUE,
  INVOICE_NUMBERING_TABLES,
  renderInvoiceNumber,
} from "./numbering.ts";
import {
  finalizeInvoiceStatement,
  insertInvoiceMatterBalanceStatement,
  markWorkInProgressBilledStatement,
  readActiveInvoiceClaims,
  readInvoice,
  readInvoiceLines,
  refuseFinalizeOnFrozenWorkInProgressStatements,
} from "./statements.ts";
import { BILLING_AGGREGATE_KEY } from "./draft.ts";
import type { BillingServiceOptions, InvoiceLineSnapshot, WorkInProgressKind } from "./types.ts";

export const INVOICE_FINALIZED_TOPIC = "billing.invoice.finalized";

// Finalization is the only interesting moment in the subsystem, and it is ONE composed effect
// because its whole content is atomicity. In one batch: the number draw, the presentation snapshot,
// the status transition to `final`, the per-matter balance rows, the `billed` lock on every claimed
// entry, and the accounts-receivable posting. A failure at any point leaves no number consumed, no
// entry locked, and no posting — which is what makes the invoice sequence gapless by construction
// rather than by care.

export interface FinalizeInvoiceInput {
  readonly invoiceId: InvoiceId;
  readonly issueDate: string; // civil PlainDate
  readonly dueDate: string;
  readonly finalizedBy: UserId | null;
  // Firm-wide unless the firm issues on more than one letterhead, in which case the caller passes
  // the office's scope and gets an independent sequence.
  readonly numberScopeKey?: string;
  // The presentation snapshot, resolved by the caller from the Location and the Directory: billing
  // does not own the firm's letterhead and reads none of it live after this moment.
  readonly locationId?: LocationId | null;
  readonly letterheadAddressBlock?: string | null;
  readonly letterheadFooter?: string | null;
  readonly remitTo?: string | null;
  readonly clientBillingName?: string | null;
}

export interface FinalizedInvoice {
  readonly invoiceId: InvoiceId;
  readonly invoiceNumber: string;
  readonly numberScopeKey: string;
  readonly drawnValue: number;
  readonly totalMinor: number;
  readonly matterTotalsMinor: ReadonlyMap<MatterId, number>;
  readonly ledgerEntryId: string;
  readonly effect: EffectWrite;
}

// How each line kind lands on the firm's books. Hard costs credit CLIENT COSTS ADVANCED, an asset,
// because the firm advanced that money on the client's behalf and is being repaid rather than
// earning; soft costs are genuine firm expenses and their recovery is income. The distinction is the
// industry one, and cost_entry.disbursement_class already carries it.
type PostingRole =
  | "fee_income"
  | "client_costs_advanced"
  | "cost_recovery_income"
  | "tax_payable"
  | "fee_adjustments";

interface ClaimedEntryLock {
  readonly sourceKind: WorkInProgressKind;
  readonly sourceId: string;
  readonly fromStatus: BillableStatus;
}

interface CostDisbursementRow {
  id: string;
  disbursement_class: "hard" | "soft";
}

async function readCostDisbursementClasses(
  database: SqlDatabase,
  costEntryIds: readonly string[],
): Promise<Map<string, "hard" | "soft">> {
  const classes = new Map<string, "hard" | "soft">();
  for (const costEntryId of costEntryIds) {
    const { results } = await database
      .prepare(`SELECT id, disbursement_class FROM cost_entry WHERE id = ?1`)
      .bind(costEntryId)
      .all<CostDisbursementRow>();
    const row = results[0];
    if (row) classes.set(row.id, row.disbursement_class);
  }
  return classes;
}

interface EntryStatusRow {
  id: string;
  status: BillableStatus;
}

async function readWorkInProgressStatuses(
  database: SqlDatabase,
  table: string,
  ids: readonly string[],
): Promise<Map<string, BillableStatus>> {
  const statuses = new Map<string, BillableStatus>();
  for (const id of ids) {
    const { results } = await database
      .prepare(`SELECT id, status FROM ${table} WHERE id = ?1`)
      .bind(id)
      .all<EntryStatusRow>();
    const row = results[0];
    if (row) statuses.set(row.id, row.status);
  }
  return statuses;
}

// Which posting role a line's value credits. A discount or adjustment nets against fee income
// through the same role rather than becoming its own contra line, because the design's posting has a
// handful of lines regardless of whether the invoice has ten lines or a thousand — which is what
// keeps the ledger entry off the batch-size budget.
function postingRoleForLine(
  line: InvoiceLineSnapshot,
  costClasses: ReadonlyMap<string, "hard" | "soft">,
  costEntryIdsByLine: ReadonlyMap<string, string>,
): PostingRole {
  switch (line.kind) {
    case "cost": {
      const costEntryId = costEntryIdsByLine.get(line.id);
      const disbursementClass = costEntryId ? costClasses.get(costEntryId) : undefined;
      return disbursementClass === "hard" ? "client_costs_advanced" : "cost_recovery_income";
    }
    case "tax":
      return "tax_payable";
    case "discount":
    case "adjustment":
      return "fee_adjustments";
    default:
      return "fee_income";
  }
}

interface ResolvedPostingAccounts {
  readonly accountsReceivable: LedgerAccountId;
  readonly byRole: ReadonlyMap<PostingRole, LedgerAccountId>;
}

// An unmapped role refuses finalization by name, BEFORE anything is composed. Only the roles this
// invoice's lines actually need are resolved, so a firm that never bills a hard cost is not made to
// map client_costs_advanced to finalize a fee-only bill.
function resolvePostingAccounts(
  map: AccountRoleMap,
  rolesInUse: ReadonlySet<PostingRole>,
): ResolvedPostingAccounts {
  const byRole = new Map<PostingRole, LedgerAccountId>();
  for (const role of rolesInUse) byRole.set(role, resolveAccountRole(map, role));
  return { accountsReceivable: resolveAccountRole(map, "accounts_receivable"), byRole };
}

export async function finalizeInvoice(
  database: SqlDatabase,
  input: FinalizeInvoiceInput,
  options: BillingServiceOptions & { readonly approvalRequired?: boolean },
): Promise<FinalizedInvoice> {
  const invoice = await readInvoice(database, input.invoiceId);
  if (!invoice) {
    throw new BillingValidationError("unknown-invoice", `no such invoice: ${input.invoiceId}`);
  }
  if (invoice.status !== "draft") {
    throw new BillingValidationError(
      "invoice-not-draft",
      `invoice ${input.invoiceId} is already ${invoice.status}: there is no un-finalize, and a finalized invoice is corrected by a credit note`,
    );
  }

  const lines = await readInvoiceLines(database, input.invoiceId);
  if (lines.length === 0) {
    throw new BillingValidationError(
      "invoice-has-no-lines",
      `invoice ${input.invoiceId} has no lines: an empty bill asserts nothing and cannot become a financial record`,
    );
  }

  const claims = await readActiveInvoiceClaims(database, input.invoiceId);
  const currency = invoice.currency;

  // --- The per-matter totals, and the invoice total as their sum. -----------------------------
  const matterTotalsMinor = new Map<MatterId, number>();
  const amountsByMatter = new Map<MatterId, number[]>();
  for (const line of lines) {
    const matterId = line.matterId as MatterId;
    const bucket = amountsByMatter.get(matterId) ?? [];
    bucket.push(line.amountMinor);
    amountsByMatter.set(matterId, bucket);
  }
  for (const [matterId, amounts] of amountsByMatter) {
    matterTotalsMinor.set(matterId, aggregateMinor(amounts, currency));
  }
  const totalMinor = aggregateMinor([...matterTotalsMinor.values()], currency);
  if (totalMinor <= 0) {
    // The balance CHECK is `applied_minor >= 0 AND applied_minor <= total_minor`, so a zero or
    // negative total is a balance nothing could ever be applied against. A bill that nets to nothing
    // is a credit note, which is a later slice's record and a different one.
    throw new BillingValidationError(
      "invoice-total-not-positive",
      `invoice ${input.invoiceId} totals ${totalMinor}: an invoice that charges nothing is not a receivable, and a net credit is recorded as a credit note`,
    );
  }

  // --- The postings, resolved through the role map or refused by name. ------------------------
  const costEntryIdsByLine = new Map<string, string>();
  for (const claim of claims) {
    if (claim.sourceKind === "cost_entry" && claim.invoiceLineId) {
      costEntryIdsByLine.set(claim.invoiceLineId, claim.sourceId);
    }
  }
  const costClasses = await readCostDisbursementClasses(database, [
    ...new Set(costEntryIdsByLine.values()),
  ]);
  const amountsByRole = new Map<PostingRole, number[]>();
  for (const line of lines) {
    const role = postingRoleForLine(line, costClasses, costEntryIdsByLine);
    const bucket = amountsByRole.get(role) ?? [];
    bucket.push(line.amountMinor);
    amountsByRole.set(role, bucket);
  }
  const accounts = resolvePostingAccounts(
    await readAccountRoleMap(database),
    new Set(amountsByRole.keys()),
  );

  const currencyValue = currencyFromCode(currency);
  const creditLines: EntryLineInput[] = [];
  for (const [role, amounts] of amountsByRole) {
    const roleTotalMinor = aggregateMinor(amounts, currency);
    if (roleTotalMinor === 0) continue;
    const accountId = accounts.byRole.get(role);
    if (!accountId) throw new Error(`unreachable: resolved role missing ${role}`);
    creditLines.push({
      accountId,
      direction: "credit",
      amount: money(roleTotalMinor, currencyValue),
    });
  }

  const posting = await postEntry(
    database,
    {
      description: `Invoice — ${invoice.clientEntityId}`,
      effectiveDate: input.issueDate,
      lines: [
        {
          accountId: accounts.accountsReceivable,
          direction: "debit" as const,
          amount: money(totalMinor, currencyValue),
        },
        ...creditLines,
      ],
    },
    options,
  );

  // --- The lock on every claimed entry, asserted in memory then guarded in the batch. ----------
  const locks: ClaimedEntryLock[] = [];
  const timeEntryIds = claims.filter((c) => c.sourceKind === "time_entry").map((c) => c.sourceId);
  const costEntryIds = claims.filter((c) => c.sourceKind === "cost_entry").map((c) => c.sourceId);
  const timeStatuses = await readWorkInProgressStatuses(database, "time_entry", timeEntryIds);
  const costStatuses = await readWorkInProgressStatuses(database, "cost_entry", costEntryIds);
  for (const claim of claims) {
    const statuses = claim.sourceKind === "time_entry" ? timeStatuses : costStatuses;
    const fromStatus = statuses.get(claim.sourceId);
    if (!fromStatus) {
      throw new BillingValidationError(
        "work-in-progress-not-billable",
        `claimed ${claim.sourceKind} ${claim.sourceId} no longer exists`,
      );
    }
    // The shared freeze contract decides the legal move, not this package: `billed` and `void` are
    // terminal there, and billing may drive an entry INTO `billed` but never back out.
    assertTransition(fromStatus, "billed", options.approvalRequired ?? false);
    locks.push({ sourceKind: claim.sourceKind, sourceId: claim.sourceId, fromStatus });
  }

  // --- The number draw. ------------------------------------------------------------------------
  const scopeKey = input.numberScopeKey ?? FIRM_WIDE_NUMBER_SCOPE;
  const observedValue =
    (await readCounterValue(database, INVOICE_NUMBERING_TABLES, scopeKey)) ??
    INVOICE_NUMBER_START_VALUE;
  const invoiceNumber = renderInvoiceNumber(scopeKey, observedValue);
  const now = options.clock.now();

  const statements: SqlStatement[] = [
    ensureCounterRowStatement(
      database,
      INVOICE_NUMBERING_TABLES,
      scopeKey,
      INVOICE_NUMBER_START_VALUE,
    ),
    guardedIncrementStatement(database, INVOICE_NUMBERING_TABLES, scopeKey, observedValue),
    finalizeInvoiceStatement(database, {
      id: input.invoiceId,
      invoiceNumber,
      numberScopeKey: scopeKey,
      numberDrawnValue: observedValue,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      locationId: input.locationId ?? null,
      letterheadAddressBlock: input.letterheadAddressBlock ?? null,
      letterheadFooter: input.letterheadFooter ?? null,
      remitTo: input.remitTo ?? null,
      clientBillingName: input.clientBillingName ?? null,
      finalizedBy: input.finalizedBy,
      now,
    }),
  ];

  for (const [matterId, matterTotalMinor] of matterTotalsMinor) {
    statements.push(
      insertInvoiceMatterBalanceStatement(
        database,
        input.invoiceId,
        matterId,
        matterTotalMinor,
        currency,
        now,
      ),
    );
  }

  // The commit guards ride ahead of the locks: an entry that reached `billed` or `void` between the
  // read above and this commit aborts the WHOLE batch on the status CHECK rather than being quietly
  // relocked. A guarded UPDATE matching zero rows would instead leave the invoice finalized, the
  // number consumed, and the receivable posted against work that had been voided.
  statements.push(
    ...refuseFinalizeOnFrozenWorkInProgressStatements(database, "time_entry", timeEntryIds),
    ...refuseFinalizeOnFrozenWorkInProgressStatements(database, "cost_entry", costEntryIds),
  );
  for (const lock of locks) {
    statements.push(
      markWorkInProgressBilledStatement(
        database,
        lock.sourceKind,
        lock.sourceId,
        lock.fromStatus,
        now,
      ),
    );
  }

  statements.push(...posting.effect.statements);
  // LAST: invoice_id is a foreign key on the allocation, and the invoice row has to carry its drawn
  // number by the time this lands. The composite primary key {scope_key, drawn_value} is the
  // load-bearing backstop — a losing concurrent draw aborts here, and the caller's bounded retry
  // re-reads the advanced counter.
  statements.push(
    allocateCounterValueStatement(
      database,
      INVOICE_NUMBERING_TABLES,
      scopeKey,
      observedValue,
      input.invoiceId,
      now,
    ),
  );

  return {
    invoiceId: input.invoiceId,
    invoiceNumber,
    numberScopeKey: scopeKey,
    drawnValue: observedValue,
    totalMinor,
    matterTotalsMinor,
    ledgerEntryId: posting.entryId,
    effect: {
      statements,
      outboxMessages: [
        ...posting.effect.outboxMessages,
        {
          topic: INVOICE_FINALIZED_TOPIC,
          payload: {
            invoiceId: input.invoiceId,
            invoiceNumber,
            clientEntityId: invoice.clientEntityId,
            totalMinor,
            currency,
          },
          aggregateKey: BILLING_AGGREGATE_KEY,
        },
      ],
    },
  };
}
