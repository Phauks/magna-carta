import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readEntityListingRows,
  type DirectoryEntityListingRow,
} from "@magna-carta/directory/entity-listing";
import { readMatterRegister } from "@magna-carta/matters/matter-register";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import { Counter, type MatterStatusCounts } from "./matters-list.ts";

// CLIENT LIST — every client of a matter the firm has opened, with the directory's default way to
// reach them and how many of their matters are open, on hold and closed.
//
// Who is a client is the matters package's answer (the client on each opened matter, the same read
// the Matters List lists); what a client is called and how to reach them is the directory's (the
// row its own index prints). This module joins the two and counts; nothing here is a second
// definition of either. test/operational-client-list.test.ts proves the clients' matter counts add
// up to the Matters List's totals, less the matters that have no client.
//
// A sealed identifier never appears: reading one is a permission-gated, audited decrypt.
//
// LIVE ONLY, for the reason the Matters List is.

export interface ClientListRow {
  readonly clientEntityId: string;
  // Null where the directory no longer holds the record live.
  readonly entityKind: "person" | "organization" | null;
  readonly displayName: string | null;
  readonly legalName: string | null;
  readonly emailAddress: string | null;
  readonly phoneNumber: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly counts: MatterStatusCounts;
  // The offices the client's matters are held in, by name, each once; null for no office.
  readonly locationNames: readonly (string | null)[];
}

export interface ClientListReport {
  readonly computedAt: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly completeness: ReportCompleteness;
  readonly clientCount: number;
  readonly totals: MatterStatusCounts;
  // Opened matters with no client recorded on them: counted here so the whole adds up, never listed.
  readonly mattersWithoutClient: number;
  // In name order, as the directory sorts its own index.
  readonly clients: readonly ClientListRow[];
}

export function clientListStatement(computedAt: string): string {
  return (
    `This report lists the firm's clients as they stood when it was produced, at ${computedAt}. ` +
    `A client's name and contact details can be changed, and a matter can be opened, moved or ` +
    `closed, so it is a live report: running it again later will reflect any change made in the ` +
    `meantime, and it is not claimed to reproduce.`
  );
}

export async function assembleClientList(
  database: SqlDatabase,
  input: { readonly locationId: string | null },
  options: { readonly computedAt: string },
): Promise<ClientListReport> {
  const register = await readMatterRegister(database, input);
  if (register.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "the firm has more matters than one report can list; choose an office to narrow it",
    );
  }

  const totals = new Counter();
  let mattersWithoutClient = 0;
  const clients = new Map<string, { counter: Counter; offices: Map<string, string | null> }>();
  for (const row of register.rows) {
    if (row.clientEntityId === null) {
      mattersWithoutClient += 1;
      continue;
    }
    totals.take(row);
    const client = clients.get(row.clientEntityId) ?? {
      counter: new Counter(),
      offices: new Map<string, string | null>(),
    };
    client.counter.take(row);
    client.offices.set(row.locationId ?? "", row.locationName);
    clients.set(row.clientEntityId, client);
  }

  const directory = await readEntityListingRows(database, [...clients.keys()]);
  const listed = new Set(directory.map((row) => row.entityId));
  // A client the directory no longer holds live (removed, or folded into another record) keeps its
  // row and its counts, under no name, rather than dropping out and leaving the counts short.
  const missing = [...clients.keys()].filter((entityId) => !listed.has(entityId)).sort();

  const rowOf = (
    clientEntityId: string,
    entity: DirectoryEntityListingRow | null,
  ): ClientListRow => {
    const client = clients.get(clientEntityId);
    return {
      clientEntityId,
      entityKind: entity?.entityKind ?? null,
      displayName: entity?.displayName ?? null,
      legalName: entity?.legalName ?? null,
      emailAddress: entity?.emailAddress ?? null,
      phoneNumber: entity?.phoneNumber ?? null,
      city: entity?.city ?? null,
      region: entity?.region ?? null,
      country: entity?.country ?? null,
      counts: (client?.counter ?? new Counter()).counts(),
      locationNames: [...(client?.offices.values() ?? [])],
    };
  };

  return {
    computedAt: options.computedAt,
    reproducible: false,
    statement: clientListStatement(options.computedAt),
    locationId: input.locationId,
    completeness: completeScope(),
    clientCount: clients.size,
    totals: totals.counts(),
    mattersWithoutClient,
    clients: [
      ...directory.map((entity) => rowOf(entity.entityId, entity)),
      ...missing.map((entityId) => rowOf(entityId, null)),
    ],
  };
}
