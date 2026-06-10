import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import type { CreateAccountInput } from "@magna-carta/ledger/create-account";
import type { PostEntryInput } from "@magna-carta/ledger/types";
import { money, USD } from "@magna-carta/money/money";
import type { FixtureContext } from "./context.ts";

// Primitive factory: a plausible single account input. Faker supplies the name; overrides win.
// Callers pass the result to createAccount — the factory builds INPUTS, never rows (the
// real-write-paths-only invariant).
export function anAccountInput(
  context: FixtureContext,
  overrides: Partial<CreateAccountInput> = {},
): CreateAccountInput {
  return {
    name: `${context.faker.company.name()} Account`,
    type: "asset",
    currency: "USD",
    ...overrides,
  };
}

// Primitive factory: a plausible balanced two-line entry. Faker supplies the narrative; the fixed
// clock supplies the date; the amount defaults to a faker-drawn realistic figure. Overrides win.
export function aBalancedEntryInput(
  context: FixtureContext,
  input: {
    debitAccountId: LedgerAccountId;
    creditAccountId: LedgerAccountId;
    amountMinor?: number;
    description?: string;
  },
): PostEntryInput {
  const amountMinor = input.amountMinor ?? context.faker.number.int({ min: 5000, max: 2_000_000 });
  return {
    description: input.description ?? context.faker.company.buzzPhrase(),
    effectiveDate: context.clock.today(),
    lines: [
      { accountId: input.debitAccountId, direction: "debit", amount: money(amountMinor, USD) },
      { accountId: input.creditAccountId, direction: "credit", amount: money(amountMinor, USD) },
    ],
  };
}
