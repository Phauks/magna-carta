import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  LedgerAccountId,
  MatterId,
  TrustAccountId,
  TrustLedgerNodeId,
} from "@magna-carta/identifiers/types";
import { postEntry, type PostEntryOptions, type PostedEntry } from "@magna-carta/ledger/post-entry";
import type { PostEntryInput } from "@magna-carta/ledger/types";
import { selectTrustAccountRolesStatement } from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type { TrustAccountRole } from "./types.ts";

// THE only supported way to compose a ledger entry that touches trust money. Everything downstream —
// the apply-funds path billing will call, the card rail payments will build — inherits the rules by
// calling this rather than by remembering them, which is what keeps a single owner for
// "fees never touch trust" instead of a rule restated in three places that will disagree.
//
// The ledger primitive underneath is account-agnostic by design: it enforces balanced, leaf-only,
// single-currency, positive-amount, not-future-dated, and the account_balance bounds. It has no
// concept of "trust" and cannot acquire one without becoming the trust engine. Everything trust-
// specific therefore lives here, in front of it.

interface RoleRow {
  ledger_account_id: string;
  role: "node" | "bank" | "liability_root";
  trust_account_id: string;
  node_id: string | null;
  node_kind: "client" | "matter" | "firm_funds" | null;
  client_entity_id: string | null;
  matter_id: string | null;
}

// Resolves every account on a proposed entry to what it IS to trust. An account absent from the
// result is "outside" — belonging to no trust account — and that is the load-bearing case: an
// operating bank, a fee expense, or an income account all land there, so an entry mixing one of them
// with a trust leaf is a detected condition rather than an assumed-absent one.
export async function loadTrustAccountRoles(
  database: SqlDatabase,
  ledgerAccountIds: readonly LedgerAccountId[],
): Promise<Map<string, TrustAccountRole>> {
  const roles = new Map<string, TrustAccountRole>();
  for (const accountId of ledgerAccountIds) roles.set(accountId, { kind: "outside" });
  if (ledgerAccountIds.length === 0) return roles;
  const { results } = await selectTrustAccountRolesStatement(
    database,
    ledgerAccountIds,
  ).all<RoleRow>();
  for (const row of results) {
    const trustAccountId = row.trust_account_id as TrustAccountId;
    if (row.role === "bank") {
      roles.set(row.ledger_account_id, { kind: "bank", trustAccountId });
      continue;
    }
    if (row.role === "liability_root") {
      roles.set(row.ledger_account_id, { kind: "liabilityRoot", trustAccountId });
      continue;
    }
    // A `node` row always carries its node columns — the shape CHECK on trust_ledger_node makes a
    // half-attributed node unstorable, so the coalesce is a type narrowing, not a fallback.
    const nodeId = (row.node_id ?? "") as TrustLedgerNodeId;
    if (row.node_kind === "firm_funds") {
      roles.set(row.ledger_account_id, { kind: "firmFunds", trustAccountId, nodeId });
      continue;
    }
    if (row.node_kind === "client") {
      roles.set(row.ledger_account_id, {
        kind: "client",
        trustAccountId,
        nodeId,
        clientEntityId: row.client_entity_id ?? "",
      });
      continue;
    }
    roles.set(row.ledger_account_id, {
      kind: "matter",
      trustAccountId,
      nodeId,
      clientEntityId: row.client_entity_id ?? "",
      matterId: (row.matter_id ?? "") as MatterId,
    });
  }
  return roles;
}

// The structural guards, stated once. Pure: roles arrive pre-loaded, exactly as the ledger's
// validateEntry takes pre-loaded account snapshots — nothing here reads the database, so nothing
// here can be planned "between" statements of a batch that D1 will not let us interleave with.
export function assertTrustComposition(
  input: PostEntryInput,
  roles: ReadonlyMap<string, TrustAccountRole>,
): void {
  const lineRoles = input.lines.map((line) => {
    const role = roles.get(line.accountId);
    if (!role) {
      throw new Error(`unreachable: no trust role resolved for ${line.accountId}`);
    }
    return role;
  });

  // Which trust account is this entry about? Exactly one, or it is not an entry this guard can
  // reason about: two trust accounts on one entry would move client money between two banks in a
  // single unreconcilable movement, and zero means the caller reached the trust door by mistake.
  const trustAccountIds = new Set<string>();
  for (const role of lineRoles) {
    if (role.kind !== "outside") trustAccountIds.add(role.trustAccountId);
  }
  if (trustAccountIds.size === 0) {
    throw new TrustValidationError(
      "not-a-trust-entry",
      "no line touches a trust account — compose this through the ledger, not the trust guard",
    );
  }
  if (trustAccountIds.size > 1) {
    throw new TrustValidationError(
      "crosses-trust-accounts",
      "one entry may touch only one trust account; the two sides clear on different bank statements",
    );
  }

  // NO COMMINGLING, and with it FEES NEVER TOUCH TRUST. Once a line touches a trust account, every
  // other line on the entry must belong to the same trust account. That single rule refuses firm
  // money landing in a client ledger, client money landing in an operating account, and a processor
  // or bank fee netted out of a trust deposit — the fee has nowhere to sit on this entry at all, so
  // the deposit lands gross and the fee is a separate operating entry by construction rather than
  // by a caller choosing well.
  for (const [index, role] of lineRoles.entries()) {
    if (role.kind === "outside") {
      throw new TrustValidationError(
        "commingled-entry",
        `line ${index} posts to an account outside this trust account; trust money and firm money never share an entry`,
      );
    }
  }

  // Postings land on matter leaves. The other tiers are roll-ups: a line on the liability root or on
  // a client node would sit outside every roll-up beneath it and make the client-side total
  // disagree with the sum of the leaves it is supposed to be.
  for (const role of lineRoles) {
    if (role.kind === "liabilityRoot") {
      throw new TrustValidationError(
        "posting-to-liability-root",
        "the client-liability root is a roll-up over its client nodes and takes no postings",
      );
    }
    if (role.kind === "client") {
      throw new TrustValidationError(
        "posting-to-client-node",
        "postings land on matter leaves; a client node is the roll-up over that client's matters",
      );
    }
    if (role.kind === "firmFunds") {
      throw new TrustValidationError(
        "firm-funds-node-not-enabled",
        "the firm-funds carve-out is not enabled; firm money cannot enter a trust account",
      );
    }
  }

  // CLIENT-TO-CLIENT IS REFUSED, and this is checked FIRST so the refusal names the real problem
  // rather than the shape violation that follows from it. Moving funds between two clients' ledgers
  // is the classic misappropriation pattern, and at the entry level it is indistinguishable from
  // one. Refusing more than one client per entry rules it out structurally rather than by inspecting
  // directions: two matters of the SAME client remain expressible (one of the reasons the tree
  // carries a client tier at all), and a genuine movement between two clients has to be a
  // disbursement and a separate receipt, each with its own authorization and its own trail.
  const matterRoles = lineRoles.filter((role) => role.kind === "matter");
  const clients = new Set(matterRoles.map((role) => role.clientEntityId));
  if (clients.size > 1) {
    throw new TrustValidationError(
      "multiple-clients-on-entry",
      "one entry may touch only one client's trust funds; a movement between clients is a disbursement and a separate receipt",
    );
  }

  // Every trust entry touches the client side. Without a matter leaf there is no client ledger for
  // the movement to appear on, and the entry is a bank-only movement the trust door cannot explain.
  if (matterRoles.length === 0) {
    throw new TrustValidationError(
      "missing-client-line",
      "a trust entry must touch a matter leaf — the client side of the reconciliation",
    );
  }

  // Two shapes are legitimate, and every other kind of line has already been refused above, so the
  // remaining lines are matter leaves and the trust bank leaf, nothing else.
  //
  // MONEY MOVED AT THE BANK: the entry touches the trust bank leaf and at least one matter leaf.
  // That pairing is what makes the book side and the client side agree BY CONSTRUCTION instead of by
  // a nightly job — the bank leaf's balance and the sum of the matter leaves under the same root
  // move together on every such entry.
  //
  // MONEY DID NOT MOVE AT THE BANK: a reallocation between matter leaves, which is the movement a
  // firm makes when funds were received against the wrong matter of the same client, or when one
  // matter of a client funds another. The bank balance is unchanged because no bank movement
  // happened, and the client-side total is unchanged because the debit and the credit are both
  // inside it — so the two sides still agree, and posting a matching pair of offsetting bank lines
  // instead would invent two items that would sit uncleared on a reconciliation forever.
  if (!lineRoles.some((role) => role.kind === "bank")) {
    const nodeIds = new Set(matterRoles.map((role) => role.nodeId));
    if (nodeIds.size < 2) {
      throw new TrustValidationError(
        "single-node-reallocation",
        "an entry that never touches the trust bank must move funds BETWEEN matter leaves; debiting and crediting one leaf moves nothing",
      );
    }
  }
}

export interface ComposeTrustEntryResult extends PostedEntry {
  readonly trustAccountId: TrustAccountId;
}

export interface ComposeTrustEntryOptions extends PostEntryOptions {
  // Trust nodes THIS SAME effect creates, which the role read cannot see yet — the trust-side twin
  // of the ledger's pendingAccounts. A matter leaf built lazily at its first deposit would otherwise
  // resolve to "outside" and the deposit would be refused as commingled, which is the guard doing
  // its job on incomplete information rather than a real violation. It is a declaration a composer
  // makes about a row it is itself writing in this batch, so it is only ever as true as that
  // composer; commingledTrustEntriesStatement (fitness.ts) re-proves the rule over stored lines
  // afterwards, which is what makes a wrong declaration detectable rather than permanent.
  readonly pendingRoles?: ReadonlyMap<string, TrustAccountRole>;
}

// Read the roles, assert the trust rules, then hand off to the ledger — which independently
// re-enforces balanced, leaf-only, one currency, positive amounts, and no future dating, and whose
// account_balance bounds CHECK is what actually aborts the batch when a client leaf would go
// negative. The guard never duplicates those; it adds only what the ledger cannot know.
export async function composeTrustEntry(
  database: SqlDatabase,
  input: PostEntryInput,
  options: ComposeTrustEntryOptions,
): Promise<ComposeTrustEntryResult> {
  const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
  const roles = await loadTrustAccountRoles(database, accountIds);
  // A stored role always wins over a declared one: an account the read found is registered, and a
  // caller claiming otherwise must not be able to talk the guard out of what the database says.
  for (const [accountId, role] of options.pendingRoles ?? []) {
    if (roles.get(accountId)?.kind === "outside") roles.set(accountId, role);
  }
  assertTrustComposition(input, roles);
  const owningRole = accountIds
    .map((accountId) => roles.get(accountId))
    .find((role) => role !== undefined && role.kind !== "outside");
  if (owningRole === undefined) {
    throw new Error("unreachable: assertTrustComposition proved a trust account is present");
  }
  const posted = await postEntry(database, input, options);
  return { ...posted, trustAccountId: owningRole.trustAccountId };
}
