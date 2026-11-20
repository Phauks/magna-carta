import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { selectAccountHasLinesStatement } from "@magna-carta/ledger/statements";
import { ACCOUNT_TYPES, type AccountType } from "@magna-carta/ledger/types";
import { readAccountRoleMap, type AccountRole } from "@magna-carta/account-roles/account-roles";
import { GeneralLedgerValidationError } from "./general-ledger-validation.ts";
import { isSectionOfType, type StatementSection } from "./sections.ts";
import { readTrustRegistrations, type TrustRegistration } from "./trust-refusal.ts";
import type { GeneralLedgerServiceOptions } from "./types.ts";

// THE CHART OF ACCOUNTS. A classification laid over ledger_account, never a second ledger: the
// number, the statement section, the system-account marker and a description are columns on the
// one account table, and an entry names its accounts by handle, so renaming or renumbering an
// account restates no figure. Accounts are created through the ledger's createAccount, never a raw
// INSERT, so its leaf-only and parent-match guards run and the balance row lands in the same batch.

export interface ChartAccount {
  readonly ledgerAccountId: LedgerAccountId;
  readonly code: string | null;
  readonly name: string;
  readonly type: AccountType;
  readonly statementSection: string | null;
  readonly description: string | null;
  readonly systemAccount: boolean;
  readonly active: boolean;
  readonly parentAccountId: LedgerAccountId | null;
  readonly hasChildren: boolean;
  readonly balanceMinor: number;
  readonly currency: string;
  // A trust-registered account is shown and never edited here; the reason is a value, not prose.
  readonly trustRegistration: TrustRegistration | null;
  readonly operatingBankAccountId: string | null;
  readonly roles: readonly AccountRole[];
}

interface ChartRow {
  id: string;
  code: string | null;
  name: string;
  type: AccountType;
  statement_section: string | null;
  description: string | null;
  system_account: number;
  active: number;
  parent_account_id: string | null;
  has_children: number;
  balance_minor: number | null;
  currency: string;
  operating_bank_account_id: string | null;
}

// Trust's matter and client leaves are ledger accounts too, one per matter, and a firm can hold
// thousands. The chart shows trust's bank leaf and liability root and leaves the per-client and
// per-matter tree to the Trust screen, so the read skips any account below a trust liability root.
export async function readChartOfAccounts(database: SqlDatabase): Promise<ChartAccount[]> {
  const { results } = await database
    .prepare(
      `SELECT a.id, a.code, a.name, a.type, a.statement_section, a.description, a.system_account,
              a.active, a.parent_account_id, a.currency,
              EXISTS(SELECT 1 FROM ledger_account c WHERE c.parent_account_id = a.id) AS has_children,
              b.balance_minor, o.id AS operating_bank_account_id
         FROM ledger_account a
         LEFT JOIN account_balance b ON b.account_id = a.id
         LEFT JOIN operating_bank_account o ON o.ledger_account_id = a.id
        WHERE a.parent_account_id IS NULL OR a.parent_account_id NOT IN (
                SELECT client_liability_account_id FROM trust_account
                UNION SELECT l.id FROM ledger_account l
                       JOIN trust_account t ON l.parent_account_id = t.client_liability_account_id)
        ORDER BY (a.code IS NULL), a.code, a.name`,
    )
    .all<ChartRow>();
  const ids = results.map((row) => row.id as LedgerAccountId);
  const registrations = await readTrustRegistrations(database, ids);
  const roleMap = await readAccountRoleMap(database);
  const rolesByAccount = new Map<string, AccountRole[]>();
  for (const [role, accountId] of roleMap) {
    rolesByAccount.set(accountId, [...(rolesByAccount.get(accountId) ?? []), role]);
  }
  return results
    .filter((row) => {
      const registration = registrations.get(row.id);
      return registration !== "client" && registration !== "matter" && registration !== "firmFunds";
    })
    .map((row) => ({
      ledgerAccountId: row.id as LedgerAccountId,
      code: row.code,
      name: row.name,
      type: row.type,
      statementSection: derivedSection(row, registrations.get(row.id)),
      description: row.description,
      systemAccount: row.system_account === 1,
      active: row.active === 1,
      parentAccountId: row.parent_account_id as LedgerAccountId | null,
      hasChildren: row.has_children === 1,
      balanceMinor: row.balance_minor ?? 0,
      currency: row.currency,
      trustRegistration: registrations.get(row.id) ?? null,
      operatingBankAccountId: row.operating_bank_account_id,
      roles: rolesByAccount.get(row.id) ?? [],
    }));
}

// Trust's accounts are placed by derivation from trust's registration; the firm's stored value on
// such an account is ignored. An operating bank account is cash whatever its stored section says.
function derivedSection(row: ChartRow, registration: TrustRegistration | undefined): string | null {
  if (registration === "bank") return "trustAssets";
  if (registration === "liabilityRoot") return "clientTrustLiability";
  if (row.operating_bank_account_id !== null) return "cash";
  return row.statement_section;
}

export interface AccountClassification {
  readonly code?: string | null;
  readonly statementSection?: StatementSection | null;
  readonly description?: string | null;
}

function normalizeCode(code: string | null | undefined): string | null {
  if (code === undefined || code === null) return null;
  const trimmed = code.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function refuseTakenCode(
  database: SqlDatabase,
  code: string | null,
  exceptAccountId: LedgerAccountId | null,
): Promise<void> {
  if (code === null) return;
  const { results } = await database
    .prepare(`SELECT id FROM ledger_account WHERE code = ?1 AND id IS NOT ?2`)
    .bind(code, exceptAccountId)
    .all<{ id: string }>();
  if (results.length > 0) {
    throw new GeneralLedgerValidationError(
      "account-code-taken",
      `account number ${code} is already used by another account`,
    );
  }
}

export function setAccountClassificationStatement(
  database: SqlDatabase,
  accountId: LedgerAccountId,
  input: {
    readonly name?: string;
    readonly code: string | null;
    readonly statementSection: string | null;
    readonly description: string | null;
    readonly systemAccount?: boolean;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ledger_account
          SET name = COALESCE(?2, name), code = ?3, statement_section = ?4, description = ?5,
              system_account = COALESCE(?6, system_account)
        WHERE id = ?1`,
    )
    .bind(
      accountId,
      input.name ?? null,
      input.code,
      input.statementSection,
      input.description,
      input.systemAccount === undefined ? null : input.systemAccount ? 1 : 0,
    );
}

export interface CreateChartAccountInput extends AccountClassification {
  readonly name: string;
  readonly type: AccountType;
  readonly parentAccountId?: LedgerAccountId;
}

export async function createChartAccount(
  database: SqlDatabase,
  input: CreateChartAccountInput,
  options: GeneralLedgerServiceOptions,
  systemAccount = false,
): Promise<{ accountId: LedgerAccountId; effect: EffectWrite }> {
  if (!ACCOUNT_TYPES.includes(input.type)) {
    throw new GeneralLedgerValidationError(
      "section-not-of-type",
      `not an account type: ${String(input.type)}`,
    );
  }
  const statementSection = input.statementSection ?? null;
  if (statementSection !== null && !isSectionOfType(input.type, statementSection)) {
    throw new GeneralLedgerValidationError(
      "section-not-of-type",
      `a ${input.type} account cannot be placed in ${statementSection}`,
    );
  }
  if (statementSection === "trustAssets" || statementSection === "clientTrustLiability") {
    throw new GeneralLedgerValidationError(
      "account-is-trust-registered",
      "trust accounts are opened on the Trust screen",
    );
  }
  if (input.name.trim().length === 0) {
    throw new GeneralLedgerValidationError("empty-name", "an account needs a name");
  }
  const code = normalizeCode(input.code);
  await refuseTakenCode(database, code, null);
  if (input.parentAccountId) {
    const registrations = await readTrustRegistrations(database, [input.parentAccountId]);
    if (registrations.size > 0) {
      throw new GeneralLedgerValidationError(
        "account-is-trust-registered",
        "an account under a trust account is opened on the Trust screen",
      );
    }
  }
  const created = await createAccount(
    database,
    {
      name: input.name.trim(),
      type: input.type,
      currency: "USD",
      parentAccountId: input.parentAccountId,
    },
    { clock: options.clock, randomSource: options.randomSource },
  );
  return {
    accountId: created.accountId,
    effect: {
      statements: [
        ...created.effect.statements,
        setAccountClassificationStatement(database, created.accountId, {
          code,
          statementSection,
          description: input.description?.trim() || null,
          systemAccount,
        }),
      ],
      outboxMessages: created.effect.outboxMessages,
    },
  };
}

export interface UpdateChartAccountInput extends AccountClassification {
  readonly ledgerAccountId: LedgerAccountId;
  readonly name?: string;
  readonly type?: AccountType;
}

interface StoredAccountRow {
  id: string;
  type: AccountType;
  code: string | null;
  name: string;
  statement_section: string | null;
  description: string | null;
  system_account: number;
}

// Rename, renumber, re-section or describe an account. A trust-registered account is read-only
// here. `type` is never changed on an account that carries lines: type drives normal balance, and
// changing it would silently invert every historical figure on the account.
export async function updateChartAccount(
  database: SqlDatabase,
  input: UpdateChartAccountInput,
): Promise<EffectWrite> {
  const { results } = await database
    .prepare(
      `SELECT id, type, code, name, statement_section, description, system_account FROM ledger_account WHERE id = ?1`,
    )
    .bind(input.ledgerAccountId)
    .all<StoredAccountRow>();
  const stored = results[0];
  if (!stored) {
    throw new GeneralLedgerValidationError(
      "unknown-account",
      `no such account: ${input.ledgerAccountId}`,
    );
  }
  const registrations = await readTrustRegistrations(database, [input.ledgerAccountId]);
  if (registrations.size > 0) {
    throw new GeneralLedgerValidationError(
      "account-is-trust-registered",
      "this account belongs to a trust account and is changed only on the Trust screen",
    );
  }
  if (input.type !== undefined && input.type !== stored.type) {
    if (stored.system_account === 1) {
      throw new GeneralLedgerValidationError(
        "account-is-a-system-account",
        `${stored.name} is a standard account and keeps its type`,
      );
    }
    const { results: lines } = await selectAccountHasLinesStatement(
      database,
      input.ledgerAccountId,
    ).all<{ has_lines: number }>();
    if (lines[0]?.has_lines === 1) {
      throw new GeneralLedgerValidationError(
        "account-type-is-fixed",
        `${stored.name} already has entries, so its type cannot change`,
      );
    }
    throw new GeneralLedgerValidationError(
      "account-type-is-fixed",
      "an account's type is set when it is made; make a new account instead",
    );
  }
  const name = input.name === undefined ? undefined : input.name.trim();
  if (name !== undefined && name.length === 0) {
    throw new GeneralLedgerValidationError("empty-name", "an account needs a name");
  }
  const code = input.code === undefined ? stored.code : normalizeCode(input.code);
  if (code !== stored.code) await refuseTakenCode(database, code, input.ledgerAccountId);
  const statementSection =
    input.statementSection === undefined ? stored.statement_section : input.statementSection;
  if (statementSection !== null && !isSectionOfType(stored.type, statementSection)) {
    throw new GeneralLedgerValidationError(
      "section-not-of-type",
      `a ${stored.type} account cannot be placed in ${statementSection}`,
    );
  }
  const description =
    input.description === undefined ? stored.description : input.description?.trim() || null;
  return {
    statements: [
      setAccountClassificationStatement(database, input.ledgerAccountId, {
        name,
        code,
        statementSection,
        description,
      }),
    ],
    outboxMessages: [],
  };
}
