/*
 * Which bank feed a request gets.
 *
 * ONE PROVIDER TODAY, SWITCHED ON BY ITS KEYS. With PLAID_CLIENT_ID and PLAID_SECRET set (from the
 * Secrets Store, or per-Worker secrets of the same names), the Banking screen connects banks through
 * Plaid and Plaid bills for each connected account. Without them the port answers `not-configured`
 * and the screen says connecting a bank is not set up. Deleting the keys switches it off with
 * nothing else changed, the shape the translation engine takes (translation/translation-engine.ts).
 *
 * PLAID_ENVIRONMENT picks Plaid's host: `production` unless it says `sandbox`. Plaid's keys are
 * different for each, so the variable sits beside the keys in the dashboard rather than in
 * wrangler.jsonc.
 */
import { plaidBankFeedPort, type PlaidEnvironment } from "@magna-carta/bank-feeds/plaid";
import { unconfiguredBankFeedPort, type BankFeedPort } from "@magna-carta/bank-feeds/port";
import type { Bindings } from "../bindings.ts";

type BankFeedBindings = Pick<Bindings, "PLAID_CLIENT_ID" | "PLAID_SECRET" | "PLAID_ENVIRONMENT">;

export function bankFeedConfigured(env: BankFeedBindings): boolean {
  return (env.PLAID_CLIENT_ID?.trim() ?? "") !== "" && (env.PLAID_SECRET?.trim() ?? "") !== "";
}

export function plaidEnvironment(env: BankFeedBindings): PlaidEnvironment {
  return env.PLAID_ENVIRONMENT?.trim() === "sandbox" ? "sandbox" : "production";
}

export function resolveBankFeedPort(env: BankFeedBindings): BankFeedPort {
  if (!bankFeedConfigured(env)) return unconfiguredBankFeedPort();
  return plaidBankFeedPort({
    clientId: env.PLAID_CLIENT_ID!.trim(),
    secret: env.PLAID_SECRET!.trim(),
    environment: plaidEnvironment(env),
  });
}
