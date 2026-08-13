import { describe, expect, it } from "vitest";
import type { CommunityProfileId } from "@magna-carta/identifiers/types";
import {
  isVisibleTo,
  publicComment,
  publicPost,
  type CommentRow,
  type PostRow,
} from "../src/projection.ts";
import { publicCommentSchema, publicPostSchema } from "../src/contract.ts";

const AUTHOR_PROFILE = "communityProfile_projected" as CommunityProfileId;
const OTHER_PROFILE = "communityProfile_other" as CommunityProfileId;

const postRow: PostRow = {
  number: 1042,
  slug: "bulk-editing-custom-fields",
  kind: "request",
  category: "matters_and_organisation",
  title: "Bulk editing custom fields on closed matters",
  body: "The bulk edit panel skips anything closed.",
  status: "planned",
  declineReason: null,
  declineNote: null,
  duplicateOfNumber: null,
  voteCount: 31,
  distinctFirmVoteCount: 9,
  commentCount: 4,
  acceptedCommentReference: null,
  visibility: "published",
  archivedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  lastActivityAt: "2026-08-12T00:00:00.000Z",
  author: { id: AUTHOR_PROFILE, displayName: "Marilyn Veitch", badge: "none" },
};

const commentRow: CommentRow = {
  reference: "communityComment_one",
  body: "There is a keyboard path from the closed-matters view.",
  isOperatorResponse: true,
  visibility: "published",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  author: { id: OTHER_PROFILE, displayName: "Platform team", badge: "staff" },
};

// The board is the platform's one cross-firm surface. What a reader of one firm may learn about a
// member of another is decided here and enforced by the shape of the response, not by a handler
// remembering to omit something.

describe("what a reader learns about a poster", () => {
  it("carries a display name, a badge and a stable reference, and nothing else about the person", () => {
    const projected = publicPost(postRow);
    expect(Object.keys(projected.author).sort()).toEqual(["badge", "displayName", "reference"]);
  });

  it("never carries a firm, anywhere in the response", () => {
    const serialized = JSON.stringify(publicPost(postRow));
    expect(serialized).not.toContain("firm");
    expect(serialized).not.toContain("firm_");
  });

  it("never carries the account behind the profile", () => {
    const serialized = JSON.stringify(publicPost(postRow));
    // The author reference is the community profile's own handle. An account handle carries the
    // person's identity everywhere else on the platform and must not be published here.
    expect(serialized).not.toContain("user_");
    expect(publicPost(postRow).author.reference).toBe(AUTHOR_PROFILE);
  });

  it("passes its own strict response schema, which refuses an unexpected key", () => {
    expect(() => publicPostSchema.parse(publicPost(postRow))).not.toThrow();
    expect(() => publicCommentSchema.parse(publicComment(commentRow))).not.toThrow();
    expect(() =>
      publicPostSchema.parse({ ...publicPost(postRow), authorFirmId: "firm_leak" }),
    ).toThrow();
  });

  it("gives the distinct-firm count only above the floor", () => {
    expect(publicPost(postRow).distinctFirmVoteCount).toBe(9);
    expect(
      publicPost({ ...postRow, distinctFirmVoteCount: 2 }).distinctFirmVoteCount,
    ).toBeUndefined();
  });

  it("says when a post was last edited and never what it used to say", () => {
    const projected = publicPost(postRow);
    expect(projected.updatedAt).toBe("2026-08-02T00:00:00.000Z");
    expect(Object.keys(projected)).not.toContain("revisions");
    expect(Object.keys(projected)).not.toContain("previousBody");
  });
});

describe("who may see an unpublished row", () => {
  it("shows a hidden post to its own author and to nobody else", () => {
    const hidden = { visibility: "hidden" } as const;
    expect(isVisibleTo(hidden, { authorProfileId: AUTHOR_PROFILE }, AUTHOR_PROFILE)).toBe(true);
    expect(isVisibleTo(hidden, { authorProfileId: OTHER_PROFILE }, AUTHOR_PROFILE)).toBe(false);
    expect(isVisibleTo(hidden, null, AUTHOR_PROFILE)).toBe(false);
  });

  it("shows a removed or deleted post to nobody, including its author", () => {
    for (const visibility of ["removed", "deleted_by_author"] as const) {
      expect(isVisibleTo({ visibility }, { authorProfileId: AUTHOR_PROFILE }, AUTHOR_PROFILE)).toBe(
        false,
      );
    }
  });

  it("shows a published post to a reader who is not signed in", () => {
    expect(isVisibleTo({ visibility: "published" }, null, AUTHOR_PROFILE)).toBe(true);
  });
});
