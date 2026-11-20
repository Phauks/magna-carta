import { z } from "zod";

// What the Banking API accepts and answers, as plain zod named with `.meta({ id })`, which the
// contract emitter reads as the component's name (docs/conventions/api.md, _Where a contract shape
// lives_). The route modules in apps/api-worker declare their routes over these.
//
// NO SECRET CROSSES THIS CONTRACT. The browser sees a short-lived sign-in token (which only opens
// the provider's window) and hands back a one-time public token; the access token that reads the
// bank never leaves the Worker.

const CivilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const BankBookAccountKind = z
  .enum(["operating", "trust"])
  .meta({ id: "BankBookAccountKind" });

export const BankBookAccount = z
  .object({
    ledgerAccountId: z.string(),
    name: z.string(),
    kind: BankBookAccountKind,
    trustAccountId: z.string().nullable(),
    /** The feed account tied to this book account, if one is. */
    feedAccountId: z.string().nullable(),
  })
  .meta({ id: "BankBookAccount" });

export const BankConnection = z
  .object({
    id: z.string(),
    institutionName: z.string(),
    institutionLogo: z.string().nullable().meta({
      description: "The bank's logo as a base64 PNG. Null when the bank feed has none for it.",
    }),
    signInNeeded: z.boolean().meta({
      description: "The bank asked the firm to sign in again before it shares anything more.",
    }),
    connectedAt: z.string(),
    connectedBy: z.string().meta({ description: "The member who connected it, by name." }),
    lastSyncedAt: z.string().nullable(),
  })
  .meta({ id: "BankConnection" });

export const BankFeedAccount = z
  .object({
    id: z.string(),
    connectionId: z.string(),
    institutionName: z.string(),
    institutionLogo: z.string().nullable().meta({
      description: "The bank's logo as a base64 PNG. Null when the bank feed has none for it.",
    }),
    name: z.string(),
    mask: z.string().nullable(),
    subtype: z.string().nullable(),
    currency: z.string(),
    bankBalanceMinor: z.number().int().nullable().meta({
      description: "The bank's current balance, in minor units, as of balanceAsOf.",
    }),
    availableBalanceMinor: z.number().int().nullable(),
    balanceAsOf: z.string().nullable(),
    bookAccount: BankBookAccount.nullable().meta({
      description: "The bank account in the books this is. Null: the firm chose not to use it.",
    }),
    booksBalanceMinor: z.number().int().nullable().meta({
      description: "The books' balance of the tied account. Null when it is not tied.",
    }),
    notInBooksCount: z.number().int().nonnegative(),
  })
  .meta({ id: "BankFeedAccount" });

export const BankingOverviewResponse = z
  .object({
    providerConfigured: z.boolean().meta({
      description:
        "Whether this deployment has bank feed keys set. False: Connect Bank cannot work.",
    }),
    connections: z.array(BankConnection),
    accounts: z.array(BankFeedAccount),
    bookAccounts: z.array(BankBookAccount).meta({
      description: "Every bank account in the books a feed account can be tied to.",
    }),
  })
  .meta({ id: "BankingOverviewResponse" });

export const BankSignInTokenRequest = z
  .object({
    connectionId: z.string().optional().meta({
      description: "Present to sign in again to a connection the bank asked about.",
    }),
  })
  .meta({ id: "BankSignInTokenRequest" });

export const BankSignInTokenResponse = z
  .object({ token: z.string(), expiresAt: z.string() })
  .meta({ id: "BankSignInTokenResponse" });

export const ConnectBankRequest = z
  .object({ publicToken: z.string().min(1).max(512) })
  .meta({ id: "ConnectBankRequest" });

export const ConnectBankResponse = z
  .object({ connectionId: z.string() })
  .meta({ id: "ConnectBankResponse" });

export const LinkBankFeedAccountRequest = z
  .object({
    ledgerAccountId: z.string().nullable().meta({
      description: "The bank account in the books this feed account is. Null: don't use it.",
    }),
  })
  .meta({ id: "LinkBankFeedAccountRequest" });

export const BankLineStatusName = z
  .enum(["inBooks", "notInBooks", "pending"])
  .meta({ id: "BankLineStatusName" });

export const BankFeedTransaction = z
  .object({
    id: z.string(),
    postedOn: CivilDate,
    description: z.string(),
    amountMinor: z.number().int().meta({ description: "Positive is money in." }),
    checkNumber: z.string().nullable(),
    status: BankLineStatusName,
  })
  .meta({ id: "BankFeedTransaction" });

export const BankFeedTransactionsResponse = z
  .object({
    accountId: z.string(),
    from: CivilDate,
    to: CivilDate,
    transactions: z.array(BankFeedTransaction).meta({ description: "Newest first." }),
  })
  .meta({ id: "BankFeedTransactionsResponse" });

/** How far back the Banking screen lists a feed account's lines. */
export const TRANSACTION_WINDOW_DAYS = 90;
