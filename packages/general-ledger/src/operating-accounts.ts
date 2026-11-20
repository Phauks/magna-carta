import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { LedgerAccountId, OperatingBankAccountId } from "@magna-carta/identifiers/types";
import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import {
  readAccountRoleMap,
  setAccountRoleStatement,
} from "@magna-carta/account-roles/account-roles";
import { createChartAccount } from "./chart.ts";
import { GeneralLedgerValidationError } from "./general-ledger-validation.ts";
import type { GeneralLedgerServiceOptions } from "./types.ts";

// THE FIRM'S OWN BANK ACCOUNTS. A firm may hold several operating accounts and pay a vendor bill
// from any of them. Each is an asset leaf in the chart, placed in the cash section, plus this
// registration, which is what the payment composer checks: a bill is paid only from a registered,
// open operating account, and a trust bank leaf can never be one (it is registered on trust's own
// table, and opening an operating account always mints a fresh leaf, so the two never share one).
// The `operating_bank` role names the default the payment window offers first.

export interface OperatingBankAccount {
  readonly operatingBankAccountId: OperatingBankAccountId;
  readonly name: string;
  readonly bankName: string | null;
  readonly accountNumberLastFour: string | null;
  readonly ledgerAccountId: LedgerAccountId;
  readonly code: string | null;
  readonly currency: string;
  readonly openedOn: string;
  readonly closedAt: string | null;
  readonly balanceMinor: number;
  readonly isDefault: boolean;
}

interface OperatingRow {
  id: string;
  name: string;
  bank_name: string | null;
  account_number_last_four: string | null;
  ledger_account_id: string;
  code: string | null;
  currency: string;
  opened_on: string;
  closed_at: string | null;
  balance_minor: number | null;
}

export async function readOperatingBankAccounts(
  database: SqlDatabase,
): Promise<OperatingBankAccount[]> {
  const { results } = await database
    .prepare(
      `SELECT o.id, o.name, o.bank_name, o.account_number_last_four, o.ledger_account_id, a.code,
              o.currency, o.opened_on, o.closed_at, b.balance_minor
         FROM operating_bank_account o
         JOIN ledger_account a ON a.id = o.ledger_account_id
         LEFT JOIN account_balance b ON b.account_id = o.ledger_account_id
        ORDER BY (o.closed_at IS NOT NULL), (a.code IS NULL), a.code, o.name`,
    )
    .all<OperatingRow>();
  const roles = await readAccountRoleMap(database);
  const defaultAccountId = roles.get("operating_bank");
  return results.map((row) => ({
    operatingBankAccountId: row.id as OperatingBankAccountId,
    name: row.name,
    bankName: row.bank_name,
    accountNumberLastFour: row.account_number_last_four,
    ledgerAccountId: row.ledger_account_id as LedgerAccountId,
    code: row.code,
    currency: row.currency,
    openedOn: row.opened_on,
    closedAt: row.closed_at,
    balanceMinor: row.balance_minor ?? 0,
    isDefault: row.ledger_account_id === defaultAccountId,
  }));
}

export async function readOperatingBankAccount(
  database: SqlDatabase,
  operatingBankAccountId: OperatingBankAccountId,
): Promise<OperatingBankAccount> {
  const account = (await readOperatingBankAccounts(database)).find(
    (candidate) => candidate.operatingBankAccountId === operatingBankAccountId,
  );
  if (!account) {
    throw new GeneralLedgerValidationError(
      "unknown-operating-account",
      `no such operating account: ${operatingBankAccountId}`,
    );
  }
  return account;
}

export interface OpenOperatingBankAccountInput {
  readonly name: string;
  readonly bankName?: string | null;
  readonly accountNumberLastFour?: string | null;
  readonly code?: string | null;
  readonly openedOn: string;
  readonly makeDefault?: boolean;
}

function normalizeLastFour(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const trimmed = value.trim();
  if (!/^[0-9]{4}$/.test(trimmed)) {
    throw new GeneralLedgerValidationError(
      "last-four-malformed",
      "the last four digits of the account number are four digits",
    );
  }
  return trimmed;
}

// Opens a new operating account: a fresh cash leaf in the chart plus its registration, in one
// batch. The first operating account a firm opens becomes the default when no default is set yet,
// because a firm with one bank account has nothing else it could mean; the person opening it sees
// it marked Default and can move the mark at any time.
export async function openOperatingBankAccount(
  database: SqlDatabase,
  input: OpenOperatingBankAccountInput,
  options: GeneralLedgerServiceOptions,
): Promise<{ operatingBankAccountId: OperatingBankAccountId; effect: EffectWrite }> {
  if (input.name.trim().length === 0) {
    throw new GeneralLedgerValidationError("empty-name", "an account needs a name");
  }
  if (!isCivilDate(input.openedOn)) {
    throw new GeneralLedgerValidationError("date-malformed", `not a date: ${input.openedOn}`);
  }
  const lastFour = normalizeLastFour(input.accountNumberLastFour);
  const leaf = await createChartAccount(
    database,
    {
      name: input.name.trim(),
      type: "asset",
      code: input.code ?? null,
      statementSection: "cash",
      description: null,
    },
    options,
  );
  const operatingBankAccountId = newIdentifier("operatingBankAccount", options.randomSource);
  const now = options.clock.now();
  const roles = await readAccountRoleMap(database);
  const makeDefault = input.makeDefault === true || !roles.has("operating_bank");
  return {
    operatingBankAccountId,
    effect: {
      statements: [
        ...leaf.effect.statements,
        database
          .prepare(
            `INSERT INTO operating_bank_account (id, name, bank_name, account_number_last_four, ledger_account_id, currency, opened_on, closed_at, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'USD', ?6, NULL, ?7, ?8)`,
          )
          .bind(
            operatingBankAccountId,
            input.name.trim(),
            input.bankName?.trim() || null,
            lastFour,
            leaf.accountId,
            input.openedOn,
            options.actorUserId,
            now,
          ),
        ...(makeDefault
          ? [setAccountRoleStatement(database, "operating_bank", leaf.accountId, now)]
          : []),
      ],
      outboxMessages: leaf.effect.outboxMessages,
    },
  };
}

export interface EditOperatingBankAccountInput {
  readonly operatingBankAccountId: OperatingBankAccountId;
  readonly name?: string;
  readonly bankName?: string | null;
  readonly accountNumberLastFour?: string | null;
}

export async function editOperatingBankAccount(
  database: SqlDatabase,
  input: EditOperatingBankAccountInput,
): Promise<EffectWrite> {
  const current = await readOperatingBankAccount(database, input.operatingBankAccountId);
  const name = input.name === undefined ? current.name : input.name.trim();
  if (name.length === 0) {
    throw new GeneralLedgerValidationError("empty-name", "an account needs a name");
  }
  const bankName = input.bankName === undefined ? current.bankName : input.bankName?.trim() || null;
  const lastFour =
    input.accountNumberLastFour === undefined
      ? current.accountNumberLastFour
      : normalizeLastFour(input.accountNumberLastFour);
  return {
    statements: [
      database
        .prepare(
          `UPDATE operating_bank_account SET name = ?2, bank_name = ?3, account_number_last_four = ?4 WHERE id = ?1`,
        )
        .bind(input.operatingBankAccountId, name, bankName, lastFour),
      database
        .prepare(`UPDATE ledger_account SET name = ?2 WHERE id = ?1`)
        .bind(current.ledgerAccountId, name),
    ],
    outboxMessages: [],
  };
}

// The default is the `operating_bank` role. Moving it changes which account the payment window
// offers first and which account billing's postings name from now on; no posting already made moves.
export async function setDefaultOperatingBankAccount(
  database: SqlDatabase,
  operatingBankAccountId: OperatingBankAccountId,
  options: GeneralLedgerServiceOptions,
): Promise<EffectWrite> {
  const account = await readOperatingBankAccount(database, operatingBankAccountId);
  if (account.closedAt !== null) {
    throw new GeneralLedgerValidationError(
      "operating-account-closed",
      `${account.name} is closed and cannot be the default`,
    );
  }
  return {
    statements: [
      setAccountRoleStatement(
        database,
        "operating_bank",
        account.ledgerAccountId,
        options.clock.now(),
      ),
    ],
    outboxMessages: [],
  };
}

// A paying account must be a registered, open operating account. Returns the ledger leaf it pays
// from. Anything else, a trust bank leaf above all, is refused by name.
export async function resolvePayingAccount(
  database: SqlDatabase,
  operatingBankAccountId: OperatingBankAccountId,
): Promise<OperatingBankAccount> {
  const account = await readOperatingBankAccount(database, operatingBankAccountId);
  if (account.closedAt !== null) {
    throw new GeneralLedgerValidationError(
      "operating-account-closed",
      `${account.name} is closed and pays nothing`,
    );
  }
  return account;
}
