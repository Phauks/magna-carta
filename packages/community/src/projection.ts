// THE IDENTITY CHOKEPOINT.
//
// Everything a reader of this board ever receives is built here, and the reason it is one module
// with one exported function per shape is that leaking identity is a sin of omission. A handler
// that assembles a response inline leaks the day somebody forgets a field; a handler that calls
// `publicPost(row)` cannot, because the public types below have no field to put a firm or an
// account in. The row types are the storage shape and the public types are the wire shape, and they
// are deliberately not the same type with optional fields.
//
// WHAT A READER LEARNS ABOUT A POSTER, AND WHAT THEY DO NOT.
//
// They learn a display name — the member's real name by default, or an account-level pseudonym if
// the member set one. They learn whether the platform has badged the account. They learn a stable
// author reference, so two posts by one person read as two posts by one person; that stability is
// the point of choosing an account-level identity over a per-post one, because a per-post choice
// would make hiding this one post a signal in itself.
//
// They do not learn the firm. Not by default, not by opt-in, not anywhere. Firm plus practice area
// plus question is the inference path that matters, and a name on its own is not — which is why the
// board can show real names while showing no employers. The firm identifier is on every row; it is
// a ranking, rate-limiting and moderation key and it is rendered nowhere.
//
// They do not learn who voted. Aggregate counts only, at any size, and the distinct-firm count only
// once enough firms are involved that the number identifies nobody.
//
// They do not learn the account behind the profile. The author reference is the community profile's
// own handle, which is a different value from the account's handle and cannot be turned into one
// outside the control plane.

import type { CommunityProfileId } from "@magna-carta/identifiers/types";
import { displayableDistinctFirmCount } from "./ranking.ts";
import type { Badge, DeclineReason, PostKind, PostStatus, Visibility } from "./types.ts";
import type { Category } from "./categories.ts";

// The stored shapes, as the statement builders return them.

export interface ProfileRow {
  readonly id: CommunityProfileId;
  readonly displayName: string;
  readonly badge: Badge;
}

export interface PostRow {
  readonly number: number;
  readonly slug: string;
  readonly kind: PostKind;
  readonly category: Category;
  readonly title: string;
  readonly body: string;
  readonly status: PostStatus | null;
  readonly declineReason: DeclineReason | null;
  readonly declineNote: string | null;
  readonly duplicateOfNumber: number | null;
  readonly voteCount: number;
  readonly distinctFirmVoteCount: number;
  readonly commentCount: number;
  readonly acceptedCommentReference: string | null;
  readonly visibility: Visibility;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastActivityAt: string;
  readonly author: ProfileRow;
}

export interface CommentRow {
  readonly reference: string;
  readonly body: string;
  readonly isOperatorResponse: boolean;
  readonly visibility: Visibility;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly author: ProfileRow;
}

// The wire shapes. Note what is absent: no firm, no account, no voter, no edit history, no
// moderation detail, and no hidden-post placeholder.

export interface PublicAuthor {
  readonly reference: CommunityProfileId;
  readonly displayName: string;
  readonly badge: Badge;
}

export interface PublicPost {
  readonly number: number;
  readonly slug: string;
  readonly kind: PostKind;
  readonly category: Category;
  readonly title: string;
  readonly body: string;
  readonly author: PublicAuthor;
  readonly status: PostStatus | null;
  readonly declineReason: DeclineReason | null;
  readonly declineNote: string | null;
  readonly duplicateOfNumber: number | null;
  readonly voteCount: number;
  // Absent below the display floor. Absence rather than a floored number, because "fewer than five"
  // is itself a fact about how few firms are involved.
  readonly distinctFirmVoteCount?: number;
  readonly commentCount: number;
  readonly acceptedCommentReference: string | null;
  readonly archived: boolean;
  readonly createdAt: string;
  // The instant of the last edit. The PREVIOUS text is never available anywhere: a member editing a
  // post that said too much must not leave the original readable behind them, which is why there is
  // no revision table to project from.
  readonly updatedAt: string;
  readonly lastActivityAt: string;
}

export interface PublicComment {
  readonly reference: string;
  readonly author: PublicAuthor;
  readonly body: string;
  readonly isOperatorResponse: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function publicAuthor(profile: ProfileRow): PublicAuthor {
  return { reference: profile.id, displayName: profile.displayName, badge: profile.badge };
}

export function publicPost(row: PostRow): PublicPost {
  const distinctFirms = displayableDistinctFirmCount(row);
  return {
    number: row.number,
    slug: row.slug,
    kind: row.kind,
    category: row.category,
    title: row.title,
    body: row.body,
    author: publicAuthor(row.author),
    status: row.status,
    declineReason: row.declineReason,
    declineNote: row.declineNote,
    duplicateOfNumber: row.duplicateOfNumber,
    voteCount: row.voteCount,
    ...(distinctFirms === undefined ? {} : { distinctFirmVoteCount: distinctFirms }),
    commentCount: row.commentCount,
    acceptedCommentReference: row.acceptedCommentReference,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
  };
}

export function publicComment(row: CommentRow): PublicComment {
  return {
    reference: row.reference,
    author: publicAuthor(row.author),
    body: row.body,
    isOperatorResponse: row.isOperatorResponse,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// WHO MAY SEE A ROW THAT IS NOT PUBLISHED, AND WHY THERE IS NO TOMBSTONE.
//
// A hidden post is absent for everyone except its own author, who sees it with its state so they
// know what happened to their own words. There is deliberately no "hidden pending review"
// placeholder in its place, and the reasoning is the same reasoning that produced remove-first: a
// placeholder is a sign pointing at the one post somebody thought might name a client, and it
// arrives with the post's title, its category, and its author's name still attached. Publishing a
// marker over a suspected disclosure re-publishes the interesting part of it.
//
// A post deleted by its author or removed by an operator is absent for everyone, including the
// author. The author already knows.
export function isVisibleTo(
  row: { readonly visibility: Visibility },
  viewer: { readonly authorProfileId?: CommunityProfileId } | null,
  rowAuthorProfileId: CommunityProfileId,
): boolean {
  if (row.visibility === "published") return true;
  if (row.visibility === "removed" || row.visibility === "deleted_by_author") return false;
  return viewer?.authorProfileId === rowAuthorProfileId;
}
