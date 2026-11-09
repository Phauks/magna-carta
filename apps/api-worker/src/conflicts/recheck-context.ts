import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { Bindings } from "../bindings.ts";
import { firmKeyProviderForEnv } from "../firm-key-provider-wiring.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";

// The context an automated conflicts run executes under. One home, because the queue consumer and the
// cron backstop must run under identical terms — two drains with different contexts would be two
// different searches wearing one name.
//
// TWO THINGS ARE DELIBERATELY DIFFERENT FROM A REQUEST-DRIVEN RUN:
//
//   * `actorUserId` is null. Nobody asked for this run, and putting a member's handle on it would
//     attribute a search to a person who did not make it — the check row's whole value as a record is
//     that it says who did what.
//   * `effectivePermissions` is EMPTY. An automated run has no member behind it and therefore holds
//     no capability. That is not a limitation to work around: the matching channels this run uses
//     compare sealed identifiers by blind index, which needs no permission and writes no decrypt
//     audit precisely because matching reveals nothing. A path that needed a real decrypt would fail
//     here, loudly, which is the correct outcome for machinery running under nobody's authority.
export function automatedConflictsContext(
  env: Bindings,
  firmId: string,
  firmDatabase: ProxyBatchDatabase,
): DirectoryIdentifierContext {
  return {
    firmId: assertIdentifier(firmId, "firm"),
    firmKeyVersion: 1,
    firmKeyProvider: firmKeyProviderForEnv(env),
    database: firmDatabase,
    effectivePermissions: new Set(),
    actorUserId: null,
    clock: { now: () => new Date().toISOString() },
    randomSource: cryptoRandomSource,
  };
}
