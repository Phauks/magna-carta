/*
 * The Banking screen's reads and writes, through the generated client. Every write carries the key
 * its gesture minted, so a retried press lands once.
 */
import {
  bankingConnect,
  bankingDisconnect,
  bankingLinkAccount,
  bankingOverview,
  bankingSignInToken,
  bankingTransactions,
  type BankFeedTransactionsResponse,
  type BankSignInTokenResponse,
  type BankingOverviewResponse,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type {
  BankBookAccount,
  BankBookAccountKind,
  BankConnection,
  BankFeedAccount,
  BankFeedTransaction,
  BankFeedTransactionsResponse,
  BankLineStatusName,
  BankSignInTokenResponse,
  BankingOverviewResponse,
} from "@magna-carta/api-client";

async function attempt<T>(run: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await run();
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

const key = (idempotencyKey: string) => ({ "idempotency-key": idempotencyKey });

export const readBankingOverview = (): Promise<ApiOutcome<BankingOverviewResponse>> =>
  attempt(() => bankingOverview({ throwOnError: true }));

export const readBankTransactions = (
  accountId: string,
): Promise<ApiOutcome<BankFeedTransactionsResponse>> =>
  attempt(() => bankingTransactions({ path: { accountId }, throwOnError: true }));

/** A token that opens the bank's sign-in window: for a new bank, or again for `connectionId`. */
export const readBankSignInToken = (
  connectionId?: string,
): Promise<ApiOutcome<BankSignInTokenResponse>> =>
  attempt(() =>
    bankingSignInToken({
      body: connectionId === undefined ? {} : { connectionId },
      throwOnError: true,
    }),
  );

export const connectBank = (
  publicToken: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ connectionId: string }>> =>
  attempt(() =>
    bankingConnect({ body: { publicToken }, headers: key(idempotencyKey), throwOnError: true }),
  );

/** Tie a bank account to an account in the books, or untie it with null. */
export const linkBankAccount = (
  accountId: string,
  ledgerAccountId: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<unknown>> =>
  attempt(() =>
    bankingLinkAccount({
      path: { accountId },
      body: { ledgerAccountId },
      headers: key(idempotencyKey),
      throwOnError: true,
    }),
  );

export const disconnectBank = (
  connectionId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<unknown>> =>
  attempt(() =>
    bankingDisconnect({ path: { connectionId }, headers: key(idempotencyKey), throwOnError: true }),
  );
