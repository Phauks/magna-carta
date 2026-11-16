import { newIdentifier } from "@magna-carta/identifiers/generate";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, subtract, sum, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { assembleAccountsReceivableAging } from "../src/financial/accounts-receivable-aging.ts";
import { assembleClientStatement } from "../src/financial/client-statement.ts";
import { reportingFixture, seedMatter, type ReportingFixture } from "./support.ts";

// THE CLIENT STATEMENT'S AGREEMENT. Its opening and closing balances are the as-of aging's for the
// client, its lines the two registers' rows; the statement must (a) close at the client's total in the
// Accounts Receivable Aging report at the period's last day, and (b) move from its opening balance to
// that closing balance by exactly its own lines, a reversal adding back. Billing proves the same
// identity over rows its real composers wrote, every kind with a write path included, in
// packages/billing/test/client-statement.test.ts; this suite proves the report keeps it.

const COMPUTED_AT = "2026-09-05T15:00:00.000Z";
const AUGUST = { periodStart: "2026-08-01", periodEnd: "2026-08-31", knownAsOf: null };
const ALDER = "entity_alder";
const usdOf = (minor: number) => fromMinor(minor, USD);
const totalOf = (minors: readonly number[]): number =>
  minors.length === 0 ? 0 : toMinor(sum(minors.map((minor) => fromMinor(minor, USD))));

// Rows written directly: this suite is about the statement, not about how billing composes them.
async function ledgerEntry(fixture: ReportingFixture, effectiveDate: string): Promise<string> {
  const entryId = newIdentifier("ledgerEntry");
  await fixture.database
    .prepare(
      "INSERT INTO ledger_entry (id, description, effective_date, recorded_at) VALUES (?1, 'Posting', ?2, ?3)",
    )
    .bind(entryId, effectiveDate, `${effectiveDate}T12:00:00.000Z`)
    .run();
  return entryId;
}

async function bill(
  fixture: ReportingFixture,
  input: {
    readonly client: string;
    readonly number: string;
    readonly matters: readonly { readonly matterId: string; readonly totalMinor: number }[];
    readonly issueDate: string;
    readonly dueDate: string;
  },
): Promise<string> {
  const invoiceId = newIdentifier("invoice");
  const at = `${input.issueDate}T09:00:00.000Z`;
  await fixture.database
    .prepare(
      "INSERT INTO invoice (id, client_entity_id, currency, status, invoice_number, number_scope_key, number_drawn_value, issue_date, due_date, finalized_at, created_at, updated_at) VALUES (?1, ?2, 'USD', 'final', ?3, '', 1, ?4, ?5, ?6, ?6, ?6)",
    )
    .bind(invoiceId, input.client, input.number, input.issueDate, input.dueDate, at)
    .run();
  for (const matter of input.matters) {
    await fixture.database
      .prepare(
        "INSERT INTO invoice_matter_balance (invoice_id, matter_id, total_minor, applied_minor, currency, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 'USD', ?4, ?4)",
      )
      .bind(invoiceId, matter.matterId, matter.totalMinor, at)
      .run();
  }
  return invoiceId;
}

type Kind = "payment" | "write_off" | "credit_note" | "client_credit" | "reversal";

async function apply(
  fixture: ReportingFixture,
  input: {
    readonly kind: Kind;
    readonly invoiceId: string;
    readonly matterId: string;
    readonly amountMinor: number;
    readonly effectiveDate: string;
    readonly reverses?: string;
    readonly creditNoteId?: string;
    readonly clientCreditId?: string;
  },
): Promise<string> {
  const applicationId = newIdentifier("invoiceApplication");
  const entryId =
    input.kind === "credit_note" ? null : await ledgerEntry(fixture, input.effectiveDate);
  const reason = input.kind === "write_off" || input.kind === "reversal" ? "Agreed" : null;
  await fixture.database
    .prepare(
      "INSERT INTO invoice_application (id, invoice_id, matter_id, kind, amount_minor, currency, entry_id, effective_date, applied_at, reverses_application_id, credit_note_id, client_credit_id, reason) VALUES (?1, ?2, ?3, ?4, ?5, 'USD', ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
    )
    .bind(
      applicationId,
      input.invoiceId,
      input.matterId,
      input.kind,
      input.amountMinor,
      entryId,
      input.effectiveDate,
      `${input.effectiveDate}T12:00:00.000Z`,
      input.reverses ?? null,
      input.creditNoteId ?? null,
      input.clientCreditId ?? null,
      reason,
    )
    .run();
  return applicationId;
}

async function creditNote(
  fixture: ReportingFixture,
  invoiceId: string,
  effectiveDate: string,
): Promise<string> {
  const creditNoteId = newIdentifier("creditNote");
  await fixture.database
    .prepare(
      "INSERT INTO credit_note (id, invoice_id, currency, reason, effective_date, entry_id, issued_at) VALUES (?1, ?2, 'USD', 'Wrong rate', ?3, ?4, ?5)",
    )
    .bind(
      creditNoteId,
      invoiceId,
      effectiveDate,
      await ledgerEntry(fixture, effectiveDate),
      `${effectiveDate}T12:00:00.000Z`,
    )
    .run();
  return creditNoteId;
}

async function book() {
  const fixture = await reportingFixture();
  const at = "2026-02-01T09:00:00.000Z";
  const alderOne = await seedMatter(fixture, "Alder one", ALDER, at);
  const alderTwo = await seedMatter(fixture, "Alder two", ALDER, at);
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", at);

  // Owed before August: 60,000 on one bill, less 10,000 paid in July.
  const july = await bill(fixture, {
    client: ALDER,
    number: "00041",
    matters: [{ matterId: alderOne, totalMinor: 60_000 }],
    issueDate: "2026-07-10",
    dueDate: "2026-08-09",
  });
  await apply(fixture, {
    kind: "payment",
    invoiceId: july,
    matterId: alderOne,
    amountMinor: 10_000,
    effectiveDate: "2026-07-20",
  });

  // Billed in August: one bill charging two matters, which is one line.
  const august = await bill(fixture, {
    client: ALDER,
    number: "00042",
    matters: [
      { matterId: alderOne, totalMinor: 30_000 },
      { matterId: alderTwo, totalMinor: 20_000 },
    ],
    issueDate: "2026-08-03",
    dueDate: "2026-09-02",
  });
  // Another client's bill on the same day, which the statement never shows.
  await bill(fixture, {
    client: "entity_washoe",
    number: "00043",
    matters: [{ matterId: washoe, totalMinor: 90_000 }],
    issueDate: "2026-08-03",
    dueDate: "2026-09-02",
  });

  // Applied in August, every kind, two of them reversed.
  const payment = await apply(fixture, {
    kind: "payment",
    invoiceId: july,
    matterId: alderOne,
    amountMinor: 20_000,
    effectiveDate: "2026-08-03",
  });
  await apply(fixture, {
    kind: "reversal",
    invoiceId: july,
    matterId: alderOne,
    amountMinor: 20_000,
    effectiveDate: "2026-08-05",
    reverses: payment,
  });
  const noteId = await creditNote(fixture, august, "2026-08-06");
  await apply(fixture, {
    kind: "credit_note",
    invoiceId: august,
    matterId: alderTwo,
    amountMinor: 5_000,
    effectiveDate: "2026-08-06",
    creditNoteId: noteId,
  });
  const clientCreditId = newIdentifier("clientCredit");
  await fixture.database
    .prepare(
      "INSERT INTO client_credit (id, client_entity_id, matter_id, credit_note_id, amount_minor, discharged_minor, currency, opened_at, updated_at) VALUES (?1, ?2, ?3, ?4, 4000, 0, 'USD', ?5, ?5)",
    )
    .bind(clientCreditId, ALDER, alderTwo, noteId, "2026-08-06T12:00:00.000Z")
    .run();
  await apply(fixture, {
    kind: "client_credit",
    invoiceId: august,
    matterId: alderOne,
    amountMinor: 4_000,
    effectiveDate: "2026-08-10",
    clientCreditId,
  });
  const writeOff = await apply(fixture, {
    kind: "write_off",
    invoiceId: july,
    matterId: alderOne,
    amountMinor: 3_000,
    effectiveDate: "2026-08-12",
  });
  await apply(fixture, {
    kind: "reversal",
    invoiceId: july,
    matterId: alderOne,
    amountMinor: 3_000,
    effectiveDate: "2026-08-13",
    reverses: writeOff,
  });
  await apply(fixture, {
    kind: "payment",
    invoiceId: july,
    matterId: alderOne,
    amountMinor: 15_000,
    effectiveDate: "2026-08-20",
  });
  // After the period: in no August figure.
  await apply(fixture, {
    kind: "payment",
    invoiceId: august,
    matterId: alderOne,
    amountMinor: 1_000,
    effectiveDate: "2026-09-01",
  });
  return { fixture, july, august };
}

describe("the client statement", () => {
  it("closes at the client's total in the Accounts Receivable Aging report", async () => {
    const { fixture } = await book();
    const statement = await assembleClientStatement(
      fixture.database,
      { ...AUGUST, clientEntityId: ALDER },
      { computedAt: COMPUTED_AT },
    );
    const aging = await assembleAccountsReceivableAging(
      fixture.database,
      { asOfDate: "2026-08-31", knownAsOf: null, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const alderInAging = aging.clients.find((client) => client.clientEntityId === ALDER);
    expect(statement.totals.closingMinor).toBe(alderInAging?.totalMinor);
    // And the opening balance is that report's figure the day before the period.
    const before = await assembleAccountsReceivableAging(
      fixture.database,
      { asOfDate: "2026-07-31", knownAsOf: null, locationId: null },
      { computedAt: COMPUTED_AT },
    );
    expect(statement.totals.openingMinor).toBe(
      before.clients.find((client) => client.clientEntityId === ALDER)?.totalMinor,
    );
  });

  it("moves from opening to closing by exactly its own lines", async () => {
    const { fixture } = await book();
    const statement = await assembleClientStatement(
      fixture.database,
      { ...AUGUST, clientEntityId: ALDER },
      { computedAt: COMPUTED_AT },
    );
    const { openingMinor, billedMinor, appliedMinor, closingMinor } = statement.totals;
    // 50,000 owed; 50,000 billed; 20,000 - 20,000 + 5,000 + 4,000 + 3,000 - 3,000 + 15,000 applied.
    expect([openingMinor, billedMinor, appliedMinor, closingMinor]).toEqual([
      50_000, 50_000, 24_000, 76_000,
    ]);
    expect(
      toMinor(subtract(add(usdOf(openingMinor), usdOf(billedMinor)), usdOf(appliedMinor))),
    ).toBe(closingMinor);
    expect(statement.activity.at(-1)?.balanceMinor).toBe(closingMinor);
    expect(totalOf(statement.activity.map((line) => line.chargedMinor ?? 0))).toBe(billedMinor);
    expect(totalOf(statement.activity.map((line) => line.appliedMinor ?? 0))).toBe(appliedMinor);
    expect([statement.totals.invoiceCount, statement.totals.applicationCount]).toEqual([1, 7]);
    expect(totalOf(statement.unpaidInvoices.map((unpaid) => unpaid.unpaidMinor))).toBe(
      closingMinor,
    );
  });

  it("prints every bill and application oldest first, a reversal as its own line", async () => {
    const { fixture, july, august } = await book();
    const statement = await assembleClientStatement(
      fixture.database,
      { ...AUGUST, clientEntityId: ALDER },
      { computedAt: COMPUTED_AT },
    );
    expect(
      statement.activity.map((line) => [
        line.date,
        line.kind,
        line.reversesKind,
        line.invoiceNumber,
        line.chargedMinor,
        line.appliedMinor,
        line.balanceMinor,
      ]),
    ).toEqual([
      // The bill comes before what was applied on the same day.
      ["2026-08-03", "invoice", null, "00042", 50_000, null, 100_000],
      ["2026-08-03", "payment", null, "00041", null, 20_000, 80_000],
      ["2026-08-05", "reversal", "payment", "00041", null, -20_000, 100_000],
      ["2026-08-06", "credit_note", null, "00042", null, 5_000, 95_000],
      ["2026-08-10", "client_credit", null, "00042", null, 4_000, 91_000],
      ["2026-08-12", "write_off", null, "00041", null, 3_000, 88_000],
      ["2026-08-13", "reversal", "write_off", "00041", null, -3_000, 91_000],
      ["2026-08-20", "payment", null, "00041", null, 15_000, 76_000],
    ]);
    // One line for the bill however many matters it charges, naming them all.
    expect(statement.activity[0]?.matters.map((matter) => matter.matterTitle).toSorted()).toEqual([
      "Alder one matter",
      "Alder two matter",
    ]);
    expect(
      statement.unpaidInvoices.map((unpaid) => ({ ...unpaid, matters: unpaid.matters.length })),
    ).toEqual([
      {
        invoiceId: july,
        invoiceNumber: "00041",
        issueDate: "2026-07-10",
        dueDate: "2026-08-09",
        matters: 1,
        agingBucket: "1-30",
        billedMinor: 60_000,
        paidAndCreditedMinor: 25_000,
        unpaidMinor: 35_000,
      },
      {
        invoiceId: august,
        invoiceNumber: "00042",
        issueDate: "2026-08-03",
        dueDate: "2026-09-02",
        matters: 2,
        agingBucket: "current",
        billedMinor: 50_000,
        paidAndCreditedMinor: 9_000,
        unpaidMinor: 41_000,
      },
    ]);
    expect(statement.clientEntityId).toBe(ALDER);
  });

  it("reproduces under a knowledge instant and leaves out what was recorded after it", async () => {
    const { fixture } = await book();
    const known = await assembleClientStatement(
      fixture.database,
      { ...AUGUST, knownAsOf: "2026-08-10T23:00:00.000Z", clientEntityId: ALDER },
      { computedAt: COMPUTED_AT },
    );
    expect(known.reproducibility.reproducible).toBe(true);
    expect(known.activity.map((line) => line.date).at(-1)).toBe("2026-08-10");
    expect(known.activity.at(-1)?.balanceMinor).toBe(known.totals.closingMinor);
  });

  it("is an empty statement for a client with no bills", async () => {
    const { fixture } = await book();
    const statement = await assembleClientStatement(
      fixture.database,
      { ...AUGUST, clientEntityId: "entity_nobody" },
      { computedAt: COMPUTED_AT },
    );
    expect(statement.totals).toEqual({
      openingMinor: 0,
      billedMinor: 0,
      invoiceCount: 0,
      appliedMinor: 0,
      applicationCount: 0,
      closingMinor: 0,
    });
    expect(statement.clientName).toBeNull();
    expect(statement.activity).toEqual([]);
  });
});
