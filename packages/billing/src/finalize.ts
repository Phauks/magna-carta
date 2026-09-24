import type { EffectWrite, EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { assertTransition, type BillableStatus } from "@magna-carta/billing-core/lifecycle";
import { IllegalTransitionError } from "@magna-carta/billing-core/lifecycle-error";
import type {
  InvoiceId,
  LedgerAccountId,
  LocationId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { MAX_BOUND_PARAMETERS } from "@magna-carta/ledger/statements";
import type { EntryLineInput } from "@magna-carta/ledger/types";
import { currencyFromCode, money } from "@magna-carta/money/money";
import {
  allocateCounterValueStatement,
  readCounterValue,
} from "@magna-carta/sequence-numbering/counter-statements";
import {
  planSchemeDraw,
  schemeDrawOpeningStatements,
} from "@magna-carta/sequence-numbering/scheme-draw";
import { NumberingRenderError } from "@magna-carta/sequence-numbering/render";
import { readAccountRoleMap, resolveAccountRole, type AccountRoleMap } from "./account-roles.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { aggregateMinor } from "./line-amounts.ts";
import { FIRM_WIDE_NUMBER_SCOPE, INVOICE_NUMBERING_TABLES } from "./numbering.ts";
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
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { multiMatterRenderShapeDefinition } from "./render-shape.ts";
import type {
  BillingServiceOptions,
  InvoiceLineSnapshot,
  InvoiceRenderShape,
  WorkInProgressKind,
} from "./types.ts";

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
  // Deliberate consent to START a sequence this firm has never used. Without it, a scope key with no
  // counter row is refused: the key is free text taken from the request, it selects which counter
  // the number is drawn from, and nothing else about it is checked — so `nyc` where the firm has
  // always sent `NYC` silently mints a second sequence and the next bill out the door is numbered
  // `nyc-00001` while `NYC-00042` was the real next number. Nothing objects: the rendered strings
  // differ, so the unique index is satisfied, and the gap-detection fitness query reports the new
  // scope as a perfectly gapless sequence of one. Gaplessness is the property an auditor asks
  // about, and a typo must not be able to redefine it.
  readonly createNumberScope?: boolean;
  // The presentation snapshot, resolved by the caller from the Location and the Directory: billing
  // does not own the firm's letterhead and reads none of it live after this moment.
  readonly locationId?: LocationId | null;
  readonly letterheadAddressBlock?: string | null;
  readonly letterheadFooter?: string | null;
  readonly remitTo?: string | null;
  readonly clientBillingName?: string | null;
  // How a bill spanning several matters is presented. Absent means the firm's configured default;
  // either way the answer is SNAPSHOT onto the invoice here, with the letterhead, for the same
  // reason: a later change to the default must not re-shape a document already given to a client.
  readonly renderShape?: InvoiceRenderShape;
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

// One read per CHUNK, never one per row: a wide invoice claims hundreds of entries, and a per-entry
// lookup would put hundreds of round-trips on the finalize path. Chunked at D1's bound-parameter
// cap, which an over-long IN-list commits fine against locally and throws on in production.
async function readByIdInChunks<Row extends { id: string }, Value>(
  database: SqlDatabase,
  select: (placeholders: string) => string,
  ids: readonly string[],
  valueOf: (row: Row) => Value,
): Promise<Map<string, Value>> {
  const byId = new Map<string, Value>();
  for (let start = 0; start < ids.length; start += MAX_BOUND_PARAMETERS) {
    const chunk = ids.slice(start, start + MAX_BOUND_PARAMETERS);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(select(placeholders))
      .bind(...chunk)
      .all<Row>();
    for (const row of results) byId.set(row.id, valueOf(row));
  }
  return byId;
}

interface CostDisbursementRow {
  id: string;
  disbursement_class: "hard" | "soft";
}

function readCostDisbursementClasses(
  database: SqlDatabase,
  costEntryIds: readonly string[],
): Promise<Map<string, "hard" | "soft">> {
  return readByIdInChunks<CostDisbursementRow, "hard" | "soft">(
    database,
    (placeholders) => `SELECT id, disbursement_class FROM cost_entry WHERE id IN (${placeholders})`,
    costEntryIds,
    (row) => row.disbursement_class,
  );
}

interface EntryStatusRow {
  id: string;
  status: BillableStatus;
}

function readWorkInProgressStatuses(
  database: SqlDatabase,
  table: string,
  ids: readonly string[],
): Promise<Map<string, BillableStatus>> {
  return readByIdInChunks<EntryStatusRow, BillableStatus>(
    database,
    (placeholders) => `SELECT id, status FROM ${table} WHERE id IN (${placeholders})`,
    ids,
    (row) => row.status,
  );
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
    const matterTotalMinor = aggregateMinor(amounts, currency);
    // Refused HERE, by name, rather than left to the balance CHECK. `invoice_matter_balance` carries
    // `applied_minor >= 0 AND applied_minor <= total_minor`, so a negative per-matter subtotal is a
    // balance nothing can ever be applied against — and the CHECK aborts the whole finalize batch as
    // a raw constraint error that names a column instead of the matter. A bill whose net is positive
    // can still owe a client money on one of its matters; that is a credit note on that matter, not
    // a receivable the platform can carry.
    if (matterTotalMinor < 0) {
      throw new BillingValidationError(
        "invoice-matter-total-negative",
        `invoice ${input.invoiceId} nets ${matterTotalMinor} on matter ${matterId}: a matter a bill owes money back on is a credit note, not a line on a receivable`,
      );
    }
    matterTotalsMinor.set(matterId, matterTotalMinor);
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
  const revenueLines: EntryLineInput[] = [];
  for (const [role, amounts] of amountsByRole) {
    const roleTotalMinor = aggregateMinor(amounts, currency);
    if (roleTotalMinor === 0) continue;
    const accountId = accounts.byRole.get(role);
    if (!accountId) throw new Error(`unreachable: resolved role missing ${role}`);
    // DIRECTION IS CHOSEN FROM THE SIGN, and the line carries the magnitude. A negative invoice line
    // is a first-class shape on a draft: `invoice_line.amount_minor` has no positivity CHECK,
    // `updateDraftLine` accepts any integer, `roundInvoiceLine` is half-away-from-zero precisely so
    // a negative line rounds symmetrically, and `postingRoleForLine` has explicit arms for
    // `discount` and `adjustment`. A courtesy credit written into bill review therefore aggregates
    // into a negative role subtotal on a bill whose net is still positive — and a ledger line is
    // always a positive amount plus a direction, never a signed amount, so a negative subtotal is a
    // DEBIT of its magnitude against that role rather than a credit of a negative number, which the
    // ledger refuses outright as `non-positive-amount`.
    revenueLines.push({
      accountId,
      direction: roleTotalMinor < 0 ? "debit" : "credit",
      amount: money(Math.abs(roleTotalMinor), currencyValue),
    });
  }

  const posting = await postEntry(
    database,
    {
      description: `Invoice — ${invoice.clientEntityId}`,
      effectiveDate: input.issueDate,
      lines: [
        {
          // The receivable leg follows the same rule, and needs no branch: `totalMinor` is proved
          // strictly positive above, so this is always a debit of a positive amount. A bill that
          // netted to zero or less is refused as `invoice-total-not-positive` before reaching here.
          accountId: accounts.accountsReceivable,
          direction: "debit" as const,
          amount: money(totalMinor, currencyValue),
        },
        ...revenueLines,
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
    //
    // Its refusal is translated rather than propagated. `IllegalTransitionError` is the state
    // machine's own vocabulary and belongs to no HTTP boundary — every consumer of that contract
    // catches it and re-throws its own domain error, which is how timekeeping and costs produce a
    // sentence instead of a 500. The ordinary way to land here is a firm running with the review
    // gate ON billing work that has not been through review: claiming a `draft` entry onto a bill is
    // legal and deliberate (bill review happens before approval), so the refusal belongs at
    // finalize, naming the entry and the state it is actually in.
    try {
      assertTransition(fromStatus, "billed", options.approvalRequired ?? false);
    } catch (caught) {
      if (!(caught instanceof IllegalTransitionError)) throw caught;
      throw new BillingValidationError(
        "work-in-progress-not-billable",
        `claimed ${claim.sourceKind} ${claim.sourceId} is ${fromStatus} and cannot be billed yet: this firm reviews work before it is billed, so it has to be submitted and approved first`,
      );
    }
    locks.push({ sourceKind: claim.sourceKind, sourceId: claim.sourceId, fromStatus });
  }

  // --- The number draw. ------------------------------------------------------------------------
  const scopeKey = input.numberScopeKey ?? FIRM_WIDE_NUMBER_SCOPE;
  const counterValue = await readCounterValue(database, INVOICE_NUMBERING_TABLES, scopeKey);
  // The firm-wide scope always exists by definition; any other one has to have been used before, or
  // be opened on purpose. The key is never normalized to rescue a near-miss — folding `nyc` into
  // `NYC` would merge two sequences a firm may have meant to keep apart, which is the same class of
  // silent decision in the other direction.
  if (
    counterValue === undefined &&
    scopeKey !== FIRM_WIDE_NUMBER_SCOPE &&
    !input.createNumberScope
  ) {
    throw new BillingValidationError(
      "unknown-number-scope",
      `this firm has never issued an invoice under the numbering scope "${scopeKey}": check the spelling against the scopes already in use, or say explicitly that a new sequence should be started`,
    );
  }
  // The SHAPE is the firm's, written on the numbering settings screen under the `invoice` purpose
  // and read by the shared draw planner; the SCOPE is this bill's letterhead, which is a choice
  // made at finalize and not a value the template renders, so the caller passes it.
  //
  // A second letterhead is where the two meet: one scope's count says nothing about another's, so
  // two letterheads under a scheme that does not render the office code would issue the same number
  // twice. The refusal belongs at the moment the second scope is opened — here — rather than on the
  // bill that collides with it.
  //
  // The other direction has its own refusal. Once the scheme prints the office code, a bill issued
  // under no letterhead has no code to print, and the one part the model will not do is render
  // empty — an empty office code would make "-00042" and a letterhead's "RENO-00042" two readings of
  // the same count. So that bill is refused by name, naming both ways out, rather than reaching the
  // renderer and failing as though something had broken.
  let plan: Awaited<ReturnType<typeof planSchemeDraw>>;
  try {
    plan = await planSchemeDraw(
      database,
      "invoice",
      INVOICE_NUMBERING_TABLES,
      { openedDate: input.issueDate, locationCode: scopeKey === "" ? undefined : scopeKey },
      { scopeKey },
    );
  } catch (caught) {
    if (scopeKey === FIRM_WIDE_NUMBER_SCOPE && caught instanceof NumberingRenderError) {
      throw new BillingValidationError(
        "invoice-numbering-needs-letterhead",
        "this firm's invoice numbering prints the office code of the letterhead a bill is issued under, and this bill names no letterhead: issue it under one, or take the office code part out of the invoice numbering scheme, under Settings, Numbering",
      );
    }
    throw caught;
  }
  if (
    scopeKey !== FIRM_WIDE_NUMBER_SCOPE &&
    !plan.segments.some((segment) => segment.kind === "location_code")
  ) {
    throw new BillingValidationError(
      "unknown-number-scope",
      `this firm's invoice numbering does not render the letterhead, so a bill drawn under "${scopeKey}" would carry a number the firm-wide run can issue as well: add the office code part to the invoice numbering scheme, under Settings, Numbering`,
    );
  }
  const observedValue = plan.observedValue;
  const invoiceNumber = plan.number;
  const now = options.clock.now();
  // The render shape: an explicit choice for THIS bill wins, otherwise the firm's default. Resolved
  // and snapshot here — the derivation reads the stored answer, never the live setting.
  const renderShape =
    input.renderShape ?? (await readFirmSetting(database, multiMatterRenderShapeDefinition));

  const statements: EffectStatement[] = [
    ...schemeDrawOpeningStatements(database, INVOICE_NUMBERING_TABLES, plan),
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
      renderShape,
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
