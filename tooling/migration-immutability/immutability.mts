/*
 * A migration that is on `main` has deployed, and a deployed migration never changes — the rules
 * half, with no git and no filesystem in it.
 *
 * `main` IS production in this repository: a merge deploys within minutes, with no second gesture.
 * So `main`'s copy of a lineage is the copy the fleet is running, and every tag in it is a tag some
 * database has written into its applied-ledger. That ledger records the TAG, not the SQL behind it,
 * which is what makes both failures below silent and permanent rather than merely wrong:
 *
 *   * EDIT a deployed migration and the databases that already applied it never see the change.
 *     Their schema and the repository's disagree from then on, and no amount of deploying fixes it,
 *     because as far as every one of them is concerned that migration has already run.
 *   * REMOVE or RENAME one and those databases hold an applied tag this code does not recognize.
 *     The runner refuses the whole lineage rather than guess — correctly, since it cannot tell an
 *     old ledger from a newer schema — which blocks every later migration for the life of the
 *     database. `packages/database/src/legacy-baselines.ts` is what undoing one of those costs.
 *
 * The deliberate exceptions are ./allowed-changes.mts. Two cases are NOT exceptions, because the
 * runtime reconciles them itself and the gate reads its lists rather than asking for the same fact
 * twice: a baseline collapse (`LEGACY_BASELINES`) and a re-stamped tag (`RE_STAMPED_MIGRATIONS`).
 * Both arrive here through `reconciledByRuntime`.
 */

import type { AllowedChange } from "./allowed-changes.mts";

export interface LineageState {
  /** Every migration's tag mapped to its SQL, as `main` has them. */
  readonly deployed: ReadonlyMap<string, string>;
  /** The same, as the working tree has them. */
  readonly current: ReadonlyMap<string, string>;
  /** Tags the runtime reconciles to a later baseline, so their absence is expected. */
  readonly reconciledByRuntime: ReadonlySet<string>;
}

/**
 * Line endings are normalized before SQL is compared. The repository pins LF (.gitattributes,
 * .editorconfig), but a checkout on a machine configured otherwise would otherwise report every
 * migration as edited — an alarm that is never right is an alarm people learn to ignore.
 */
function normalize(sql: string): string {
  return sql.replace(/\r\n/gu, "\n");
}

/** Every way this lineage's working tree disagrees with the deployed one, as sentences. */
export function immutabilityViolations(
  lineage: string,
  { deployed, current, reconciledByRuntime }: LineageState,
  allowances: readonly AllowedChange[],
): string[] {
  const allowed = new Map(
    allowances.filter((change) => change.lineage === lineage).map((change) => [change.tag, change]),
  );
  const violations: string[] = [];

  for (const [tag, deployedSql] of deployed) {
    if (allowed.has(tag)) continue;

    const currentSql = current.get(tag);
    if (currentSql === undefined) {
      if (reconciledByRuntime.has(tag)) continue;
      violations.push(
        `${tag} is on main — which is production — but this lineage no longer contains it. Every ` +
          "database that applied it holds a tag this code cannot recognize, and the runner then " +
          "refuses the whole lineage for the life of that database. If this is a pure rename — the " +
          "same SQL under a new tag — record it in " +
          "packages/database/src/re-stamped-migrations.ts, which is what teaches the runner to " +
          "rewrite those ledgers instead of refusing them. Record it in " +
          "tooling/migration-immutability/allowed-changes.mts only when the tag is going away for " +
          "good, with the reason no database can have applied it.",
      );
      continue;
    }

    if (normalize(currentSql) !== normalize(deployedSql)) {
      violations.push(
        `the SQL behind ${tag} has changed, and ${tag} is on main — which is production. The ` +
          "applied-ledger records the tag, not its contents, so every database that already ran " +
          "this migration will never see the edit and its schema will disagree with this " +
          "repository permanently. Append a NEW migration instead; if the edit is provably safe, " +
          "record it in tooling/migration-immutability/allowed-changes.mts.",
      );
    }
  }

  return violations;
}
