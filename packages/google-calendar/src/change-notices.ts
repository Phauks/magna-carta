import type { ProviderNotice } from "@magna-carta/calendar/sync-port";

// What Google posts to a watch's address, read into the calendar's terms.
//
// A Google notice has no body. Everything it says is in its headers, and only two are read: the
// token, which is the secret the watch was begun with, and the state, which tells the greeting
// Google sends when a watch begins from a notice that something changed. Which calendar changed is
// deliberately not read. The receiver has not yet established who sent the notice when this runs,
// and a pass that looks at the whole account is correct whatever the notice claimed.

export const GOOGLE_NOTICE_TOKEN_HEADER = "X-Goog-Channel-Token";
export const GOOGLE_NOTICE_STATE_HEADER = "X-Goog-Resource-State";

// Google allows a token of 256 characters; one longer than that is not Google's.
const TOKEN_LIMIT = 256;

// The notices in one request: one, or none. A request with no token holds none, since nothing
// could ever believe it, and so does the greeting, which says only that the watch has begun.
export function readGoogleNotices(headers: {
  get(name: string): string | null | undefined;
}): readonly ProviderNotice[] {
  const secret = headers.get(GOOGLE_NOTICE_TOKEN_HEADER) ?? "";
  if (secret === "" || secret.length > TOKEN_LIMIT) return [];
  if (headers.get(GOOGLE_NOTICE_STATE_HEADER) === "sync") return [];
  return [{ secret }];
}
