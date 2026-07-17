import type { MatterId } from "@magna-carta/identifiers/types";
import type { FirmContext } from "../chokepoint/ports.ts";

// The ethical-wall seam. Given the matters a message is filed to, return the subset the caller may see.
// Ethical-wall enforcement is a later phase; today every matter in the firm is accessible, so this is
// the identity filter — but every wall-sensitive read (the "already filed" signal, the multi-matter
// "also on ..." list, the single-message read) routes its matter set through here, so when walls land
// the narrowing happens in one place and those reads become wall-safe with no call-site change.
export async function filterAccessibleMatters(
  _firm: FirmContext,
  _userId: string,
  matterIds: readonly MatterId[],
): Promise<MatterId[]> {
  return [...matterIds];
}
