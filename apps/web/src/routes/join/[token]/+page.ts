/*
 * The address a guest's link opens: the token, read off the path and handed to the page.
 *
 * THIS ROUTE IS OUTSIDE THE (app) GROUP, AND THAT IS ITS WHOLE SAFETY. It inherits no shell, no
 * session guard, no sidebar and no back-navigation registry, so nothing the application draws for a
 * member is drawn here, and nothing here reads anything a member reads. Somebody from outside the
 * firm lands on the firm's own origin — which is what the meeting's camera and microphone
 * permissions and the socket's same-origin check both need — and is structurally unable to reach
 * anything else on it.
 *
 * NOTHING IS READ OR SPENT HERE. The page reads the meeting's reduced summary when it mounts, and the
 * link is spent only by the person pressing Join: a mail client that prefetches every address in a
 * message runs no load of this app at all, and one that did would spend nothing.
 */
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => ({ token: params.token });
