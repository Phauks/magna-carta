import type { MatterId } from "@magna-carta/identifiers/types";
import type { FirmContext } from "../http/chokepoint/ports.ts";

// The ethical-wall seam. Given the matters a message is filed to, return the subset the caller may see.
// Ethical-wall enforcement is a later phase; today every matter in the firm is accessible, so this is
// the identity filter — but every wall-sensitive read (the "already filed" signal, the multi-matter
// "also on ..." list, the single-message read) routes its matter set through here, so when walls land
// the narrowing happens in one place and those reads become wall-safe with no call-site change.
//
// Takes the firm's DATABASE HANDLE rather than the whole request context, because the callers are no
// longer all request handlers: the capture consumer asks the same question off the queue, about the
// member who delegated a filing rule rather than about a member who is present. A wall answer that
// depended on a request context would have forced that caller to invent one, or to filter somewhere
// else — and a second narrowing point is exactly what this seam exists to prevent.
export async function filterAccessibleMatters(
  _firm: Pick<FirmContext, "firmDatabase">,
  _userId: string,
  matterIds: readonly MatterId[],
): Promise<MatterId[]> {
  return [...matterIds];
}
