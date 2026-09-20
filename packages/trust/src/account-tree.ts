import type { EffectWrite, EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  LocationId,
  MatterId,
  TrustAccountId,
  TrustLedgerNodeId,
} from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { setAccountBoundsStatement } from "@magna-carta/ledger/statements";
import type { ClockPort } from "@magna-carta/ledger/types";
import { readMatterClientEntityId } from "@magna-carta/matters/matter-party";
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
import {
  insertTrustAccountStatement,
  insertTrustLedgerNodeStatement,
  selectTrustAccountStatement,
  selectTrustAccountTimeZoneStatement,
  selectTrustAccountsPageStatement,
  selectTrustClientNodeStatement,
  selectTrustMatterNodeStatement,
  selectTrustNodeStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type { TrustAccountSnapshot, TrustLedgerNodeSnapshot } from "./types.ts";

// The floor. Every matter leaf carries min_balance_minor = 0, and the account_balance bounds CHECK
// is what enforces it: a disbursement that would overdraw fails the CHECK, and because the whole
// posting is one D1 batch, the entire batch rolls back — the idempotency record, the entry, the
// lines, the balances, and the outbox row together. This is the ONLY enforcement. There is no
// application-level balance comparison anywhere in this package that could be forgotten, bypassed by
// a future caller, or lose a race with a concurrent disbursement, because a pre-check that reads a
// balance and then writes cannot be atomic on a platform with no interactive transactions.
export const TRUST_LEAF_MINIMUM_BALANCE_MINOR = 0;

export interface TrustServiceOptions {
  readonly clock: ClockPort;
  readonly randomSource?: RandomSource;
}

interface TrustAccountRow {
  id: string;
  currency: string;
  status: "open" | "closed";
  jurisdiction: string | null;
  iolta: number;
  bank_ledger_account_id: string;
  client_liability_account_id: string;
}

interface TrustNodeRow {
  id: string;
  trust_account_id: string;
  ledger_account_id: string;
  kind: "client" | "matter" | "firm_funds";
  client_entity_id: string | null;
  matter_id: string | null;
  parent_node_id: string | null;
}

function toNodeSnapshot(row: TrustNodeRow): TrustLedgerNodeSnapshot {
  return {
    id: row.id as TrustLedgerNodeId,
    trustAccountId: row.trust_account_id as TrustAccountId,
    ledgerAccountId: row.ledger_account_id as TrustLedgerNodeSnapshot["ledgerAccountId"],
    kind: row.kind,
    clientEntityId: row.client_entity_id,
    matterId: row.matter_id as MatterId | null,
    parentNodeId: row.parent_node_id as TrustLedgerNodeId | null,
  };
}

// `.all()` + `results[0]`, never `.first()` — the one-row read convention (one sentinel for
// "no row"), stated in packages/data-access/src/idempotency-statements.ts.
export async function loadTrustAccount(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<TrustAccountSnapshot> {
  const { results } = await selectTrustAccountStatement(
    database,
    trustAccountId,
  ).all<TrustAccountRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-account",
      `no such trust account: ${trustAccountId}`,
    );
  }
  return {
    id: row.id as TrustAccountId,
    currency: row.currency,
    status: row.status,
    jurisdiction: row.jurisdiction,
    // SQLite has no boolean; the column is the 0/1 integer the schema declares.
    iolta: row.iolta !== 0,
    bankLedgerAccountId: row.bank_ledger_account_id as TrustAccountSnapshot["bankLedgerAccountId"],
    clientLiabilityAccountId:
      row.client_liability_account_id as TrustAccountSnapshot["clientLiabilityAccountId"],
  };
}

interface TrustAccountListingRow {
  id: string;
  name: string;
  location_id: string;
  jurisdiction: string | null;
  bank_name: string | null;
  account_number_last_four: string | null;
  currency: string;
  iolta: number;
  status: "open" | "closed";
  opened_on: string;
  closed_at: string | null;
  created_at: string;
  location_time_zone: string | null;
}

/**
 * One of the firm's trust accounts as a listing names it: the identity a person picks an account
 * by, and nothing a movement needs. The full account number is not a column anywhere, so the last
 * four is the whole of what can be shown.
 */
export interface TrustAccountListing {
  readonly id: TrustAccountId;
  readonly name: string;
  readonly locationId: LocationId;
  readonly jurisdiction: string | null;
  readonly bankName: string | null;
  readonly accountNumberLastFour: string | null;
  readonly currency: string;
  readonly iolta: boolean;
  readonly status: "open" | "closed";
  readonly openedOn: string;
  readonly closedAt: string | null;
  /**
   * The holding office's IANA time zone as recorded, or null for an office recorded before the
   * column existed. Resolved to a zone by the caller through the one resolver the platform has
   * (timeZoneForLocation), never here, so a null falls back in exactly one place.
   */
  readonly locationTimeZone: string | null;
}

/**
 * The firm's trust accounts, oldest first, one page at a time. Closed accounts are listed beside
 * open ones on purpose: a compliance report is asked about the period an account was live, which
 * is more often than not after it closed, and a picker that hid closed accounts would make the one
 * report an examiner asks for impossible to run.
 */
export async function listTrustAccounts(
  database: SqlDatabase,
  page: { readonly cursor?: string; readonly limit?: number } = {},
): Promise<Page<TrustAccountListing>> {
  const limit = page.limit ?? DEFAULT_PAGE_SIZE;
  const after = decodeCursor(page.cursor);
  // One row past the page tells a full page from a final one without a second count query.
  const { results } = await selectTrustAccountsPageStatement(database, {
    afterCreatedAt: after?.createdAt ?? null,
    afterId: after?.id ?? null,
    limit: limit + 1,
  }).all<TrustAccountListingRow>();
  const rows = results.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    data: rows.map((row) => ({
      id: row.id as TrustAccountId,
      name: row.name,
      locationId: row.location_id as LocationId,
      jurisdiction: row.jurisdiction,
      bankName: row.bank_name,
      accountNumberLastFour: row.account_number_last_four,
      currency: row.currency,
      iolta: row.iolta !== 0,
      status: row.status,
      openedOn: row.opened_on,
      closedAt: row.closed_at,
      locationTimeZone: row.location_time_zone,
    })),
    nextCursor: results.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

/**
 * The IANA zone RECORDED on one account's holding office, or null where the office recorded none.
 * Resolved to a zone by the caller through the platform's one resolver, exactly as the listing's
 * `locationTimeZone` is — this read exists for the caller holding an account identifier and no
 * listing, which is any surface asked for a figure "as at today" on one account.
 *
 * `.all()` + `results[0]`, never `.first()` — the one-row read convention. No row means the firm has
 * no such trust account, which is the same refusal every other read of an unknown account raises.
 */
export async function readTrustAccountOfficeTimeZone(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<string | null> {
  const { results } = await selectTrustAccountTimeZoneStatement(database, trustAccountId).all<{
    location_time_zone: string | null;
  }>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-account",
      `no such trust account: ${trustAccountId}`,
    );
  }
  return row.location_time_zone;
}

export function assertTrustAccountOpen(account: TrustAccountSnapshot): void {
  if (account.status !== "open") {
    throw new TrustValidationError(
      "trust-account-closed",
      `trust account ${account.id} is closed and takes no further activity`,
    );
  }
}

export interface OpenTrustAccountInput {
  readonly name: string;
  readonly locationId: LocationId;
  // Derived from the office rather than chosen: the rules require a trust account to sit in the
  // state of the lawyer's office, so a user-picked jurisdiction would be a user-picked answer to a
  // question the law already settles. Null when the office has none recorded — and a null REFUSES to
  // resolve later rather than falling back to any baseline.
  readonly jurisdiction: string | null;
  readonly currency: string;
  readonly bankName?: string | null;
  readonly accountNumberLastFour?: string | null;
  readonly iolta?: boolean;
  readonly openedOn: string; // YYYY-MM-DD civil date
  readonly bankAccountName?: string;
  readonly liabilityAccountName?: string;
}

export interface OpenedTrustAccount {
  readonly trustAccountId: TrustAccountId;
  readonly bankLedgerAccountId: TrustAccountSnapshot["bankLedgerAccountId"];
  readonly clientLiabilityAccountId: TrustAccountSnapshot["clientLiabilityAccountId"];
  readonly effect: EffectWrite;
}

// Opens a trust account: the asset leaf holding the bank's money, the liability root the client
// tree hangs under, and the row binding them to an office. All in one effect, so a trust account
// whose two sides do not both exist is not a state the database can be in.
//
// No chart-of-accounts numbering is invented here. The accounts are created through the ledger's own
// createAccount and carry no classification the operating general ledger has not designed yet — a
// numbering scheme guessed now is a scheme the real chart would have to migrate away from.
export async function openTrustAccount(
  database: SqlDatabase,
  input: OpenTrustAccountInput,
  options: TrustServiceOptions,
): Promise<OpenedTrustAccount> {
  const createdAt = options.clock.now();
  const bank = await createAccount(
    database,
    {
      name: input.bankAccountName ?? `${input.name} — bank`,
      type: "asset",
      currency: input.currency,
    },
    options,
  );
  const liabilityRoot = await createAccount(
    database,
    {
      name: input.liabilityAccountName ?? `${input.name} — client trust liability`,
      type: "liability",
      currency: input.currency,
    },
    options,
  );
  const trustAccountId = newIdentifier("trustAccount", options.randomSource);
  return {
    trustAccountId,
    bankLedgerAccountId: bank.accountId,
    clientLiabilityAccountId: liabilityRoot.accountId,
    effect: {
      statements: [
        ...bank.effect.statements,
        ...liabilityRoot.effect.statements,
        insertTrustAccountStatement(database, {
          id: trustAccountId,
          name: input.name,
          locationId: input.locationId,
          jurisdiction: input.jurisdiction,
          bankName: input.bankName ?? null,
          accountNumberLastFour: input.accountNumberLastFour ?? null,
          currency: input.currency,
          iolta: input.iolta === false ? 0 : 1,
          bankLedgerAccountId: bank.accountId,
          clientLiabilityAccountId: liabilityRoot.accountId,
          openedOn: input.openedOn,
          createdAt,
        }),
      ],
      outboxMessages: [...bank.effect.outboxMessages, ...liabilityRoot.effect.outboxMessages],
    },
  };
}

export interface EnsureMatterLeafInput {
  readonly trustAccountId: TrustAccountId;
  readonly matterId: MatterId;
  readonly clientNodeName: string;
  readonly matterLeafName: string;
}

export interface EnsuredMatterLeaf {
  readonly nodeId: TrustLedgerNodeId;
  readonly ledgerAccountId: TrustLedgerNodeSnapshot["ledgerAccountId"];
  readonly clientNodeId: TrustLedgerNodeId;
  // The client this ledger belongs to, DERIVED from the matter's own client party — never something
  // a caller told us. Returned so the caller declares the same value to the composition guard that
  // was written to the node row.
  readonly clientEntityId: string;
  readonly created: boolean;
  readonly effect: EffectWrite;
}

// WHOSE MONEY THIS IS, RESOLVED RATHER THAN ACCEPTED. A trust ledger's client attribution is the one
// fact the whole sub-ledger tree exists to get right: it decides which client node the leaf hangs
// under, which client the composition guard sees on the entry, whose ledger the money is readable
// and disbursable from, and whose matter it blocks from closing. A caller-asserted attribution is
// therefore not an input — it is the answer to the question being asked, and a caller that names
// another client's handle beside this matter would be re-attributing the matter's ledger by saying
// so. It comes from `matter_party`, the same link billing resolves an invoice's client through
// (`packages/matters/src/matter-party.ts`), so the platform has exactly one answer to "whose matter
// is this" rather than one per subsystem.
//
// A matter with no client party REFUSES. There is nobody to attribute the money to, and inventing an
// attribution is precisely the failure this replaces.
async function resolveMatterClient(database: SqlDatabase, matterId: MatterId): Promise<string> {
  const clientEntityId = await readMatterClientEntityId(database, matterId);
  if (clientEntityId === null) {
    throw new TrustValidationError(
      "matter-has-no-client",
      `matter ${matterId} has no client party, so there is nobody to attribute this client ledger to: record the client on the matter first`,
    );
  }
  return clientEntityId;
}

// Lazy creation: a matter's trust leaf is built at its first trust receipt, not at matter open, so
// the majority of matters that never hold client money never get an account. The caller CONCATENATES
// this effect with the posting effect and commits both in one batch — which is the whole point.
// Creating the account, its balance row, and its zero floor in the same batch as the first posting
// means a trust leaf that exists without its floor is not a state that exists even for an instant,
// and a leaf without a floor is a leaf that can be overdrawn.
export async function ensureMatterTrustLeaf(
  database: SqlDatabase,
  input: EnsureMatterLeafInput,
  options: TrustServiceOptions,
): Promise<EnsuredMatterLeaf> {
  const account = await loadTrustAccount(database, input.trustAccountId);
  assertTrustAccountOpen(account);
  const clientEntityId = await resolveMatterClient(database, input.matterId);

  const existingLeaf = await selectTrustMatterNodeStatement(
    database,
    input.trustAccountId,
    input.matterId,
  ).all<TrustNodeRow>();
  const leafRow = existingLeaf.results[0];
  if (leafRow) {
    const snapshot = toNodeSnapshot(leafRow);
    // The stored attribution is checked against the derived one on every use, not only at creation.
    // A leaf written before the attribution was derived — or one whose matter has since been
    // re-attributed to a different client — is a ledger whose money is filed under the wrong client,
    // and posting further movements onto it would deepen the error rather than surface it. The
    // fitness suite finds these over stored rows; this refuses to add to one.
    if (snapshot.clientEntityId !== clientEntityId) {
      throw new TrustValidationError(
        "trust-leaf-client-mismatch",
        `trust ledger ${snapshot.id} is attributed to client ${snapshot.clientEntityId}, but matter ${input.matterId} belongs to client ${clientEntityId}: a client ledger filed under the wrong client has to be corrected before it takes further movements`,
      );
    }
    return {
      nodeId: snapshot.id,
      ledgerAccountId: snapshot.ledgerAccountId,
      clientNodeId: snapshot.parentNodeId as TrustLedgerNodeId,
      clientEntityId,
      created: false,
      effect: { statements: [], outboxMessages: [] },
    };
  }

  const createdAt = options.clock.now();
  const statements: EffectStatement[] = [];
  const outboxMessages: OutboxMessage[] = [];

  const existingClient = await selectTrustClientNodeStatement(
    database,
    input.trustAccountId,
    clientEntityId,
  ).all<TrustNodeRow>();
  const clientRow = existingClient.results[0];
  let clientNodeId: TrustLedgerNodeId;
  let clientLedgerAccountId: TrustLedgerNodeSnapshot["ledgerAccountId"];
  // A brand-new client needs two tiers built in ONE batch — the client node and the matter leaf
  // under it — and the leaf's parent check cannot read a row this same batch has not committed yet.
  // Declaring the pending parent is what lets the whole tree, its floor, and the first posting be
  // one atomic write instead of a sequence with a half-built tree in the middle.
  const pendingParents = new Map<string, { type: "liability"; currency: string }>();
  if (clientRow) {
    const snapshot = toNodeSnapshot(clientRow);
    clientNodeId = snapshot.id;
    clientLedgerAccountId = snapshot.ledgerAccountId;
  } else {
    // The client node is a roll-up and carries no bounds: it never holds a posting, so its stored
    // balance stays at zero and a floor on it would guard nothing. The client-level no-negative rule
    // follows from the leaves instead — a sum of accounts that cannot go negative cannot go negative.
    const clientAccount = await createAccount(
      database,
      {
        name: input.clientNodeName,
        type: "liability",
        currency: account.currency,
        parentAccountId: account.clientLiabilityAccountId,
      },
      options,
    );
    clientNodeId = newIdentifier("trustLedgerNode", options.randomSource);
    clientLedgerAccountId = clientAccount.accountId;
    pendingParents.set(clientAccount.accountId, {
      type: "liability",
      currency: account.currency,
    });
    statements.push(
      ...clientAccount.effect.statements,
      insertTrustLedgerNodeStatement(database, {
        id: clientNodeId,
        trustAccountId: input.trustAccountId,
        ledgerAccountId: clientAccount.accountId,
        kind: "client",
        clientEntityId,
        matterId: null,
        parentNodeId: null,
        createdAt,
      }),
    );
    outboxMessages.push(...clientAccount.effect.outboxMessages);
  }

  const leafAccount = await createAccount(
    database,
    {
      name: input.matterLeafName,
      type: "liability",
      currency: account.currency,
      parentAccountId: clientLedgerAccountId,
    },
    { ...options, pendingParents },
  );
  const nodeId = newIdentifier("trustLedgerNode", options.randomSource);
  statements.push(
    ...leafAccount.effect.statements,
    // The floor, written in the SAME batch that creates the account and its balance row — never as a
    // follow-up write. setAccountBoundsStatement runs after insertBalanceRowStatement in this
    // ordered batch, so it addresses a row that exists; a fresh balance of zero satisfies a floor of
    // zero, so the bound can never be born already violated.
    setAccountBoundsStatement(
      database,
      leafAccount.accountId,
      TRUST_LEAF_MINIMUM_BALANCE_MINOR,
      null,
      createdAt,
    ),
    insertTrustLedgerNodeStatement(database, {
      id: nodeId,
      trustAccountId: input.trustAccountId,
      ledgerAccountId: leafAccount.accountId,
      kind: "matter",
      clientEntityId,
      matterId: input.matterId,
      parentNodeId: clientNodeId,
      createdAt,
    }),
  );
  outboxMessages.push(...leafAccount.effect.outboxMessages);

  return {
    nodeId,
    ledgerAccountId: leafAccount.accountId,
    clientNodeId,
    clientEntityId,
    created: true,
    effect: { statements, outboxMessages },
  };
}

export async function loadTrustNode(
  database: SqlDatabase,
  nodeId: TrustLedgerNodeId,
): Promise<TrustLedgerNodeSnapshot> {
  const { results } = await selectTrustNodeStatement(database, nodeId).all<TrustNodeRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError("unknown-trust-node", `no such trust ledger node: ${nodeId}`);
  }
  return toNodeSnapshot(row);
}

// A matter's existing leaf, refusing rather than creating one. Money can only leave a ledger that
// already holds some, so a payout path that lazily created its own source leaf would be composing a
// refusal out of an empty account it had just invented.
export async function loadMatterTrustLeaf(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  matterId: MatterId,
): Promise<TrustLedgerNodeSnapshot> {
  const { results } = await selectTrustMatterNodeStatement(
    database,
    trustAccountId,
    matterId,
  ).all<TrustNodeRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-node",
      `matter ${matterId} holds no trust ledger under trust account ${trustAccountId}`,
    );
  }
  return toNodeSnapshot(row);
}
