/*
 * Everything the Banking screen asks of the outside world, as one object handed in. The route hands
 * in the live one; the developer-console gallery hands in one over fixtures, so the screen a
 * reviewer looks at there is this screen and not a second rendering of it.
 */
import * as api from "./banking-api.ts";
import { openBankSignIn } from "./plaid-link.ts";

export type BankingService = {
  readonly readOverview: typeof api.readBankingOverview;
  readonly readTransactions: typeof api.readBankTransactions;
  readonly readSignInToken: typeof api.readBankSignInToken;
  readonly connect: typeof api.connectBank;
  readonly link: typeof api.linkBankAccount;
  readonly disconnect: typeof api.disconnectBank;
  /** Open the bank's own sign-in window with a token, and resolve when it closes. */
  readonly openSignIn: typeof openBankSignIn;
};

export const liveBankingService: BankingService = {
  readOverview: api.readBankingOverview,
  readTransactions: api.readBankTransactions,
  readSignInToken: api.readBankSignInToken,
  connect: api.connectBank,
  link: api.linkBankAccount,
  disconnect: api.disconnectBank,
  openSignIn: openBankSignIn,
};
