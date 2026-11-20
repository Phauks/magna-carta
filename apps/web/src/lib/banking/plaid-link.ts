/*
 * The bank's own sign-in window, which belongs to the bank feed provider (Plaid Link). Magna Carta
 * never sees the bank password: the window takes a short-lived token from the server, and on
 * success hands back a one-time public token the server exchanges.
 *
 * The provider's script is loaded the first time somebody presses Connect Bank, from the provider's
 * own address, and never bundled: the provider requires it be loaded from there so it can update
 * the window without a release of ours. One script tag, however many times the window opens.
 */

const PLAID_LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

/** The bits of Plaid Link's success metadata the Banking screen reads. */
export interface BankSignInSuccess {
  readonly publicToken: string;
  readonly institutionName: string | null;
}

/** How a sign-in window ended. */
export type BankSignInResult =
  | { readonly kind: "signedIn"; readonly success: BankSignInSuccess }
  | { readonly kind: "closed"; readonly errorMessage: string | null };

interface PlaidLinkError {
  readonly error_message?: string;
  readonly display_message?: string | null;
}

interface PlaidLinkMetadata {
  readonly institution?: { readonly name?: string } | null;
}

interface PlaidLinkHandler {
  open(): void;
  destroy(): void;
}

interface PlaidLinkOptions {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
  onExit: (error: PlaidLinkError | null, metadata: PlaidLinkMetadata) => void;
}

interface PlaidGlobal {
  create(options: PlaidLinkOptions): PlaidLinkHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

let loading: Promise<PlaidGlobal> | null = null;

/** Load the provider's script once, and resolve with its global. */
function loadPlaid(): Promise<PlaidGlobal> {
  if (window.Plaid !== undefined) return Promise.resolve(window.Plaid);
  if (loading !== null) return loading;
  loading = new Promise<PlaidGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PLAID_LINK_SCRIPT;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.Plaid !== undefined) resolve(window.Plaid);
      else reject(new Error("The bank sign-in window did not load."));
    });
    script.addEventListener("error", () => {
      // Let the next press try again rather than holding a failed load for the whole session.
      loading = null;
      script.remove();
      reject(new Error("The bank sign-in window did not load."));
    });
    document.head.append(script);
  });
  return loading;
}

/**
 * Open the bank's sign-in window with a token from the server, and resolve when it closes. The same
 * call serves a new bank and signing in again to one: the token decides which.
 */
export async function openBankSignIn(token: string): Promise<BankSignInResult> {
  const plaid = await loadPlaid();
  return new Promise<BankSignInResult>((resolve) => {
    let handler: PlaidLinkHandler | null = null;
    const finish = (result: BankSignInResult): void => {
      handler?.destroy();
      resolve(result);
    };
    handler = plaid.create({
      token,
      onSuccess: (publicToken, metadata) =>
        finish({
          kind: "signedIn",
          success: { publicToken, institutionName: metadata.institution?.name ?? null },
        }),
      onExit: (error) =>
        finish({
          kind: "closed",
          errorMessage:
            error === null ? null : (error.display_message ?? error.error_message ?? null),
        }),
    });
    handler.open();
  });
}
