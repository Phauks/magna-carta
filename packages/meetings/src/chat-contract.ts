import { z } from "zod";

// A meeting chat message's contract shapes that are the chat's own rather than a route's. The routes
// are in apps/api-worker/src/http/routes/communications/meeting-chat.ts; the rule is in
// docs/conventions/api.md (_Where a contract shape lives_).

/**
 * The file a line points at: one of the meeting's matter's files, opened through the file's own
 * download route. Null on a line that shares none, on one taken back, once the file is deleted, and
 * on every copy a guest reads.
 */
export const MeetingMessageFile = z.object({ id: z.string(), name: z.string() });

/**
 * Where a guest's browser fetches a file shared in the chat: a short-lived signed address, handed
 * back as data rather than as a redirect, because the guest's credential travels in a header that a
 * plain link cannot carry.
 */
export const GuestMeetingFileAddress = z
  .object({ url: z.string(), name: z.string() })
  .meta({ id: "GuestMeetingFileAddress" });
