/*
 * The Reconciliation list is one trust account's, and the account rides the address so a link to
 * it names which. With none named, the screen opens on the firm's first open account.
 */
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => {
  const named = url.searchParams.get("account") ?? "";
  return { trustAccountId: named.trim() === "" ? null : named };
};
