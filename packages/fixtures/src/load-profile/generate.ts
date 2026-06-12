import {
  commitEffectBatch,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { LedgerAccountId, LedgerEntryId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import type { EntryLineInput } from "@magna-carta/ledger/types";
import { money, USD } from "@magna-carta/money/money";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { ArchetypeWeights, LedgerVolumeProfile } from "./profile.ts";

// Probe identifiers the measurement layer binds real queries to (recorded in the snapshot
// manifest): deterministic for a given profile + seed.
export interface VolumeProbes {
  readonly operatingBankAccountId: LedgerAccountId;
  readonly trustBankAccountId: LedgerAccountId;
  readonly clientTrustLiabilityAccountId: LedgerAccountId;
  readonly feeIncomeAccountId: LedgerAccountId;
  readonly busySubledgerAccountId: LedgerAccountId; // most postings — the hot balance row
  readonly sampleEntryId: LedgerEntryId;
}

export interface VolumeGenerationResult {
  readonly entryCount: number; // total ledger_entry rows written (archetypes + opening + reversals)
  readonly probes: VolumeProbes;
}

interface CoreChart {
  readonly operatingBank: LedgerAccountId;
  readonly trustBank: LedgerAccountId;
  readonly accountsReceivable: LedgerAccountId;
  readonly clientCostsAdvanced: LedgerAccountId;
  readonly clientTrustLiability: LedgerAccountId;
  readonly ownersEquity: LedgerAccountId;
  readonly feeIncome: LedgerAccountId;
  readonly costRecoveryIncome: LedgerAccountId;
}

const EXPENSE_NAMES = [
  "Rent Expense",
  "Salaries Expense",
  "Office Supplies Expense",
  "Bar Dues Expense",
  "Continuing Education Expense",
] as const;

type ArchetypeName = keyof ArchetypeWeights;

// Volume generation: the load-profile entry point (ADR-0083). Every write rides the real domain
// services — valid at any scale by construction.
export async function generateLedgerVolume(
  database: BatchDatabase,
  context: FixtureContext,
  profile: LedgerVolumeProfile,
  options: SeedingOptions,
): Promise<VolumeGenerationResult> {
  assertSeedingAllowed(options);
  const serviceOptions = { clock: context.clock, randomSource: context.randomSource };
  const commit = (effect: EffectWrite) =>
    commitEffectBatch(database, effect, { now: () => context.clock.now() });

  const newAccount = async (
    name: string,
    type: "asset" | "liability" | "equity" | "income" | "expense",
    parentAccountId?: LedgerAccountId,
  ): Promise<LedgerAccountId> => {
    const { accountId, effect } = await createAccount(
      database,
      { name, type, currency: "USD", parentAccountId },
      serviceOptions,
    );
    await commit(effect);
    return accountId;
  };

  // --- The volume chart: core accounts + N trust subledgers under one parent. ---
  const chart: CoreChart = {
    operatingBank: await newAccount("Operating Bank Account", "asset"),
    trustBank: await newAccount("Trust Bank Account (IOLTA)", "asset"),
    accountsReceivable: await newAccount("Accounts Receivable", "asset"),
    clientCostsAdvanced: await newAccount("Client Costs Advanced", "asset"),
    clientTrustLiability: await newAccount("Client Trust Liability", "liability"),
    ownersEquity: await newAccount("Owner's Equity", "equity"),
    feeIncome: await newAccount("Fee Income", "income"),
    costRecoveryIncome: await newAccount("Cost Recovery Income", "income"),
  };
  const expenseAccounts: LedgerAccountId[] = [];
  for (const name of EXPENSE_NAMES) {
    expenseAccounts.push(await newAccount(name, "expense"));
  }
  const subledgers: LedgerAccountId[] = [];
  for (let index = 0; index < profile.trustSubledgerCount; index += 1) {
    subledgers.push(
      await newAccount(
        `Trust — ${context.faker.person.fullName()}`,
        "liability",
        chart.clientTrustLiability,
      ),
    );
  }

  // --- In-memory realism tracking (generator-side only; the ledger enforces nothing here in v1 —
  // trust bounds are Phase 3). Subledgers never overdraw; payments never exceed receivables;
  // settlements never recover costs that were not advanced. ---
  const trustHeldMinor = subledgers.map(() => 0);
  const subledgerPostings = subledgers.map(() => 0);
  let receivableMinor = 0;
  let costsAdvancedMinor = 0;
  let totalEntries = 0;

  const post = async (description: string, lines: EntryLineInput[]): Promise<LedgerEntryId> => {
    const posted = await postEntry(
      database,
      { description, effectiveDate: context.clock.today(), lines },
      serviceOptions,
    );
    await commit(posted.effect);
    totalEntries += 1;
    return posted.entryId;
  };

  // Opening capital sized to the volume so the operating account plausibly funds the expense
  // stream (heuristic; nothing enforces operating-balance sign in v1).
  await post("Owner capital contribution", [
    {
      accountId: chart.operatingBank,
      direction: "debit",
      amount: money(profile.entryCount * 25_000, USD),
    },
    {
      accountId: chart.ownersEquity,
      direction: "credit",
      amount: money(profile.entryCount * 25_000, USD),
    },
  ]);

  // Effective dates disperse across the posting span: a fixed advance per entry.
  const minutesPerEntry = Math.max(
    1,
    Math.floor((profile.postingSpanDays * 24 * 60) / profile.entryCount),
  );

  const weighted = (Object.entries(profile.archetypeWeights) as [ArchetypeName, number][]).map(
    ([value, weight]) => ({ value, weight }),
  );
  const amount = (minimum: number, maximum: number) =>
    context.faker.number.int({ min: minimum, max: maximum });
  const pickSubledger = (): number =>
    context.faker.number.int({ min: 0, max: subledgers.length - 1 });

  let sampleEntryId: LedgerEntryId | null = null;

  for (let index = 0; index < profile.entryCount; index += 1) {
    let archetype = context.faker.helpers.weightedArrayElement(weighted);
    // Fallbacks keep the stream realistic when a bounded archetype has no headroom.
    if (archetype === "trustDisbursement" && !trustHeldMinor.some((held) => held > 0)) {
      archetype = "trustDeposit";
    }
    if (archetype === "paymentReceived" && receivableMinor === 0) {
      archetype = "feeBilled";
    }

    let entryId: LedgerEntryId;
    switch (archetype) {
      case "trustDeposit": {
        const subledger = pickSubledger();
        const depositMinor = amount(50_000, 2_000_000);
        entryId = await post(`Trust deposit — ${context.faker.company.buzzPhrase()}`, [
          { accountId: chart.trustBank, direction: "debit", amount: money(depositMinor, USD) },
          {
            accountId: subledgers[subledger]!,
            direction: "credit",
            amount: money(depositMinor, USD),
          },
        ]);
        trustHeldMinor[subledger]! += depositMinor;
        subledgerPostings[subledger]! += 1;
        break;
      }
      case "trustDisbursement": {
        // Deterministic pick among FUNDED subledgers only.
        const funded = trustHeldMinor
          .map((held, subledgerIndex) => ({ held, subledgerIndex }))
          .filter((candidate) => candidate.held > 0);
        const choice = funded[context.faker.number.int({ min: 0, max: funded.length - 1 })]!;
        const disbursementMinor = amount(1, choice.held); // min 1: a barely-funded subledger must still disburse validly
        entryId = await post("Trust disbursement to client", [
          {
            accountId: subledgers[choice.subledgerIndex]!,
            direction: "debit",
            amount: money(disbursementMinor, USD),
          },
          {
            accountId: chart.trustBank,
            direction: "credit",
            amount: money(disbursementMinor, USD),
          },
        ]);
        trustHeldMinor[choice.subledgerIndex]! -= disbursementMinor;
        subledgerPostings[choice.subledgerIndex]! += 1;
        break;
      }
      case "feeBilled": {
        const feeMinor = amount(50_000, 3_000_000);
        entryId = await post("Fee billed — hourly matter", [
          {
            accountId: chart.accountsReceivable,
            direction: "debit",
            amount: money(feeMinor, USD),
          },
          { accountId: chart.feeIncome, direction: "credit", amount: money(feeMinor, USD) },
        ]);
        receivableMinor += feeMinor;
        break;
      }
      case "paymentReceived": {
        const paymentMinor = Math.min(amount(50_000, 3_000_000), receivableMinor);
        entryId = await post("Client payment on account", [
          { accountId: chart.operatingBank, direction: "debit", amount: money(paymentMinor, USD) },
          {
            accountId: chart.accountsReceivable,
            direction: "credit",
            amount: money(paymentMinor, USD),
          },
        ]);
        receivableMinor -= paymentMinor;
        break;
      }
      case "operatingExpense": {
        // One in five expense entries advances client costs instead (feeds the settlement
        // archetype's recovery line so it never recovers money that was not advanced).
        const advancesCosts = context.faker.number.int({ min: 1, max: 5 }) === 1;
        const expenseMinor = amount(5_000, 1_500_000);
        const debitAccount = advancesCosts
          ? chart.clientCostsAdvanced
          : expenseAccounts[context.faker.number.int({ min: 0, max: expenseAccounts.length - 1 })]!;
        entryId = await post(
          advancesCosts ? "Costs advanced — client matters" : "Operating expense",
          [
            { accountId: debitAccount, direction: "debit", amount: money(expenseMinor, USD) },
            {
              accountId: chart.operatingBank,
              direction: "credit",
              amount: money(expenseMinor, USD),
            },
          ],
        );
        if (advancesCosts) {
          costsAdvancedMinor += expenseMinor;
        } else if (context.faker.number.float({ min: 0, max: 1 }) < profile.reversalRate) {
          // Reversals exercise the reverse path at volume. Only plain operating expenses are
          // reversed: trust and receivable archetypes would need their in-memory tracking unwound.
          const reversal = await reverseEntry(
            database,
            {
              entryId,
              description: "Posted in error — reversed",
              effectiveDate: context.clock.today(),
            },
            serviceOptions,
          );
          await commit(reversal.effect);
          totalEntries += 1;
        }
        break;
      }
      case "settlement": {
        // The multi-line tail: operating bank receives; fee income, cost recovery, and (when
        // costs are outstanding) the costs-advanced receivable make 3-4 credit lines.
        const feePartMinor = amount(100_000, 2_000_000);
        const recoveryPartMinor = amount(10_000, 200_000);
        const costsPartMinor = Math.min(amount(10_000, 300_000), costsAdvancedMinor);
        const lines: EntryLineInput[] = [
          {
            accountId: chart.operatingBank,
            direction: "debit",
            amount: money(feePartMinor + recoveryPartMinor + costsPartMinor, USD),
          },
          { accountId: chart.feeIncome, direction: "credit", amount: money(feePartMinor, USD) },
          {
            accountId: chart.costRecoveryIncome,
            direction: "credit",
            amount: money(recoveryPartMinor, USD),
          },
        ];
        if (costsPartMinor > 0) {
          lines.push({
            accountId: chart.clientCostsAdvanced,
            direction: "credit",
            amount: money(costsPartMinor, USD),
          });
          costsAdvancedMinor -= costsPartMinor;
        }
        entryId = await post("Settlement received — fees and recovered costs", lines);
        break;
      }
      default: {
        // Exhaustiveness: every ArchetypeWeights key has a case above; a new archetype without a
        // case must fail loudly, not skip an entry.
        throw new Error(`load-profile: unhandled archetype ${String(archetype)}`);
      }
    }
    sampleEntryId ??= entryId;
    context.clock.advanceMinutes(minutesPerEntry);
  }

  if (sampleEntryId === null) throw new Error("load-profile: profile generated no entries");
  let busyIndex = 0;
  for (let index = 1; index < subledgerPostings.length; index += 1) {
    if (subledgerPostings[index]! > subledgerPostings[busyIndex]!) busyIndex = index;
  }

  return {
    entryCount: totalEntries,
    probes: {
      operatingBankAccountId: chart.operatingBank,
      trustBankAccountId: chart.trustBank,
      clientTrustLiabilityAccountId: chart.clientTrustLiability,
      feeIncomeAccountId: chart.feeIncome,
      busySubledgerAccountId: subledgers[busyIndex]!,
      sampleEntryId,
    },
  };
}
