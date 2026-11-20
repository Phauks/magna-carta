/*
 * The address the completion email's link opens: the token, read off the path and handed to the page.
 *
 * Like the signing page beside it, this route is outside the (app) group, so it inherits no shell and
 * no session guard, and nothing here reads anything a member reads. Opening it records nothing.
 */
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => ({ token: params.token });
