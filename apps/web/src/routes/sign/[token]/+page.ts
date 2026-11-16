/*
 * The address a signer's link opens: the token, read off the path and handed to the page.
 *
 * THIS ROUTE IS OUTSIDE THE (app) GROUP, AND THAT IS ITS WHOLE SAFETY. It inherits no shell, no
 * session guard and no sidebar, so nothing the application draws for a member is drawn here, and
 * nothing here reads anything a member reads. Somebody from outside the firm lands on the firm's own
 * origin and is structurally unable to reach anything else on it.
 *
 * NOTHING IS SIGNED HERE. Opening the page records that the signer looked; signing is a separate act
 * on the page, so a mail scanner that follows the link costs nothing.
 */
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => ({ token: params.token });
