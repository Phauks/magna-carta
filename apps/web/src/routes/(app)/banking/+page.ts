/*
 * Banking shows one bank account's lines at a time, and the account rides the address so a link to
 * it names which. With none named, the screen opens on the first account down its column.
 */
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => {
  const named = url.searchParams.get("account") ?? "";
  return { accountId: named.trim() === "" ? null : named };
};
