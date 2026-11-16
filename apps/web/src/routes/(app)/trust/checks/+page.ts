/*
 * The Checks screen is one trust account's, and the account rides the address so a link to it
 * names which. With no account named there is no screen to draw, so the address 404s inside the
 * app chrome; whether the account exists is the server's answer, read on the client.
 */
import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => {
  const trustAccountId = url.searchParams.get("account") ?? "";
  if (trustAccountId.trim() === "") error(404, "Not Found");
  return { trustAccountId };
};
