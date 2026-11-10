import type { StatusKey } from "@magna-carta/design-system/status-register";
import type { PostKind, PostStatus } from "@magna-carta/community/vocabulary";

// A board status, as the status register's key. The board stores plain words ("planned"); the
// register keys them under a community prefix because "new" and "completed" are ordinary words
// other vocabularies may want.
const STATUS_KEYS: Record<PostStatus, StatusKey> = {
  new: "community-new",
  future: "community-future",
  planned: "community-planned",
  "building-now": "community-building-now",
  beta: "community-beta",
  completed: "community-completed",
  "not-on-the-roadmap": "community-not-on-the-roadmap",
  duplicate: "community-duplicate",
  answered: "community-answered",
};

export function communityStatusKey(status: PostStatus): StatusKey {
  return STATUS_KEYS[status];
}

// The word a post's kind is called by, in the board's own voice.
export const KIND_LABELS: Record<PostKind, string> = {
  request: "Request",
  question: "Question",
};
