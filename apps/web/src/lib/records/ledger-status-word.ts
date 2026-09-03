/*
 * The chain's word for a ledger record's status, from the one register the ledgers speak.
 *
 * Time, fees and costs all move through the same chain — draft, submitted, approved, billed, void —
 * and every surface that names a step must say it the way the chip on the row says it. Shared here
 * so no ledger's presentation reaches into another's.
 */
import {
  STATUS_VOCABULARIES,
  statusEntry,
  type StatusKey,
} from "@magna-carta/design-system/status-register";

/** The register's label for a status past draft, or undefined for draft and for a word it does not know. */
export function ledgerStatusWord(status: string | null): string | undefined {
  if (status === null || status === "draft") return undefined;
  const chain: readonly string[] = STATUS_VOCABULARIES.workflowChain;
  return chain.includes(status) ? statusEntry(status as StatusKey).label : undefined;
}
