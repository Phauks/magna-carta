import { beforeEach, describe, expect, it } from "vitest";
import type {
  CommunityCommentId,
  CommunityFlagId,
  CommunityPostId,
  CommunityProfileId,
  CommunityVoteId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  insertProfileStatement,
  selectProfileByUserStatement,
  approveFirstWriteStatement,
  toProfileRecord,
  type StoredProfileRow,
} from "../src/data-access/profile-statements.ts";
import {
  acceptAnswerStatement,
  authorDeletePostStatement,
  authorEditPostStatement,
  carryVotesToDuplicateTargetStatement,
  convertQuestionToRequestStatement,
  hidePostStatement,
  insertPostStatement,
  listPostsStatement,
  listUntriagedRequestsStatement,
  markDuplicateStatement,
  publishPostStatement,
  recountPostCommentsStatement,
  recountPostVotesStatement,
  removePostStatement,
  restorePostStatement,
  selectPostByNumberStatement,
  setPostStatusStatement,
  touchLastActivityStatement,
  archiveStalePostsStatement,
  type StoredPostRow,
} from "../src/data-access/post-statements.ts";
import { deleteVoteStatement, insertVoteStatement } from "../src/data-access/vote-statements.ts";
import {
  insertCommentStatement,
  listCommentsStatement,
  publishCommentStatement,
} from "../src/data-access/comment-statements.ts";
import {
  countDistinctReportingFirmsStatement,
  insertFlagStatement,
  listOpenFlagsStatement,
} from "../src/data-access/flag-statements.ts";
import { insertModerationActionStatement } from "../src/data-access/moderation-statements.ts";
import {
  advancePostNumberStatement,
  allocatePostNumberStatement,
  ensurePostNumberCounterStatement,
  FIRST_POST_NUMBER,
  selectNextPostNumberStatement,
} from "../src/data-access/post-number.ts";
import { publicPost } from "../src/projection.ts";
import { communityDatabase, FIRM_ONE, FIRM_THREE, FIRM_TWO, seedUser } from "./support.ts";
import type { CommunityTestDatabase } from "./support.ts";

const NOW = "2026-08-13T09:00:00.000Z";

const AUTHOR = "user_communityAuthor" as UserId;
const READER = "user_communityReader" as UserId;
const THIRD = "user_communityThird" as UserId;
const AUTHOR_PROFILE = "communityProfile_author" as CommunityProfileId;
const READER_PROFILE = "communityProfile_reader" as CommunityProfileId;
const THIRD_PROFILE = "communityProfile_third" as CommunityProfileId;
const POST = "communityPost_first" as CommunityPostId;
const OTHER_POST = "communityPost_second" as CommunityPostId;

let test: CommunityTestDatabase;

async function seedProfiles(): Promise<void> {
  seedUser(test, AUTHOR, FIRM_ONE, "Marilyn Veitch");
  seedUser(test, READER, FIRM_TWO, "Hallam Pryce");
  seedUser(test, THIRD, FIRM_THREE, "Delia Okonkwo");
  await test.database.batch([
    insertProfileStatement(test.database, {
      id: AUTHOR_PROFILE,
      userId: AUTHOR,
      firmId: FIRM_ONE,
      displayName: "Marilyn Veitch",
      isPseudonym: false,
      now: NOW,
    }),
    insertProfileStatement(test.database, {
      id: READER_PROFILE,
      userId: READER,
      firmId: FIRM_TWO,
      displayName: "Hallam Pryce",
      isPseudonym: false,
      now: NOW,
    }),
    insertProfileStatement(test.database, {
      id: THIRD_PROFILE,
      userId: THIRD,
      firmId: FIRM_THREE,
      displayName: "quiet-clerk",
      isPseudonym: true,
      now: NOW,
    }),
    approveFirstWriteStatement(test.database, AUTHOR_PROFILE, NOW),
    approveFirstWriteStatement(test.database, READER_PROFILE, NOW),
    approveFirstWriteStatement(test.database, THIRD_PROFILE, NOW),
  ]);
}

async function seedPost(
  id: CommunityPostId,
  number: number,
  overrides: Partial<{ kind: "request" | "question"; visibility: "published" | "hidden" }> = {},
): Promise<void> {
  await test.database.batch([
    insertPostStatement(test.database, {
      id,
      number,
      slug: `post-${number}`,
      kind: overrides.kind ?? "request",
      category: "trust_and_reconciliation",
      title: `Request number ${number}`,
      body: "A body long enough to be a real post about the software.",
      authorProfileId: AUTHOR_PROFILE,
      authorUserId: AUTHOR,
      authorFirmId: FIRM_ONE,
      visibility: overrides.visibility ?? "published",
      hiddenReason: null,
      now: NOW,
    }),
  ]);
}

beforeEach(async () => {
  test = communityDatabase();
  await seedProfiles();
});

describe("the board's writes", () => {
  it("creates a profile whose display name is not the account's name column", async () => {
    const row = await selectProfileByUserStatement(test.database, THIRD).first<StoredProfileRow>();
    expect(row).not.toBeNull();
    const profile = toProfileRecord(row as StoredProfileRow);
    expect(profile.displayName).toBe("quiet-clerk");
    expect(profile.isPseudonym).toBe(true);
    // The account's own name is untouched by the board identity, which is the point of the profile
    // being a separate record.
    const account = test.raw.prepare(`SELECT name FROM user WHERE id = ?`).get(THIRD) as {
      name: string;
    };
    expect(account.name).toBe("Delia Okonkwo");
  });

  it("approves a first write once and reports nothing to do on a second attempt", async () => {
    const second = await approveFirstWriteStatement(test.database, AUTHOR_PROFILE, NOW).run();
    expect(second.meta.changes).toBe(0);
  });

  it("holds a brand-new account's first post until it is published", async () => {
    await seedPost(POST, 1001, { visibility: "published" });
    await test.database.batch([
      insertPostStatement(test.database, {
        id: OTHER_POST,
        number: 1002,
        slug: "held",
        kind: "question",
        category: "search",
        title: "A held first post",
        body: "Held until somebody looks at it, because nothing new posts unseen.",
        authorProfileId: READER_PROFILE,
        authorUserId: READER,
        authorFirmId: FIRM_TWO,
        visibility: "pending_first_write_review",
        hiddenReason: null,
        now: NOW,
      }),
    ]);
    const listed = await listPostsStatement(test.database, {
      sort: "new",
      limit: 20,
      now: NOW,
    }).all<StoredPostRow>();
    expect(listed.results.map((row) => row.number)).toEqual([1001]);

    await publishPostStatement(test.database, OTHER_POST, NOW).run();
    const afterPublish = await listPostsStatement(test.database, {
      sort: "new",
      limit: 20,
      now: NOW,
    }).all<StoredPostRow>();
    expect(afterPublish.results.map((row) => row.number).sort()).toEqual([1001, 1002]);
  });
});

describe("votes", () => {
  beforeEach(async () => {
    await seedPost(POST, 1001);
  });

  async function vote(userId: UserId, profileId: CommunityProfileId, firmId: string, id: string) {
    await test.database.batch([
      insertVoteStatement(test.database, {
        id: id as CommunityVoteId,
        postId: POST,
        profileId,
        userId,
        firmId: firmId as never,
        now: NOW,
      }),
      recountPostVotesStatement(test.database, POST),
      touchLastActivityStatement(test.database, POST, NOW),
    ]);
  }

  it("counts one vote per account and refuses a second from the same account", async () => {
    await vote(AUTHOR, AUTHOR_PROFILE, FIRM_ONE, "communityVote_a");
    await vote(AUTHOR, AUTHOR_PROFILE, FIRM_ONE, "communityVote_a2");
    const row = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    expect(row?.vote_count).toBe(1);
  });

  it("counts distinct firms separately from raw votes", async () => {
    await vote(AUTHOR, AUTHOR_PROFILE, FIRM_ONE, "communityVote_a");
    await vote(READER, READER_PROFILE, FIRM_TWO, "communityVote_b");
    await vote(THIRD, THIRD_PROFILE, FIRM_TWO, "communityVote_c");
    const row = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    expect(row?.vote_count).toBe(3);
    // Two firms, three people: the second firm's extra seat adds to the total and not to the
    // ranking figure, which is the whole reason the firm identifier is on the vote.
    expect(row?.distinct_firm_vote_count).toBe(2);
  });

  it("recomputes both counts when a vote is withdrawn", async () => {
    await vote(AUTHOR, AUTHOR_PROFILE, FIRM_ONE, "communityVote_a");
    await vote(READER, READER_PROFILE, FIRM_TWO, "communityVote_b");
    await test.database.batch([
      deleteVoteStatement(test.database, { postId: POST, userId: READER }),
      recountPostVotesStatement(test.database, POST),
    ]);
    const row = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    expect(row?.vote_count).toBe(1);
    expect(row?.distinct_firm_vote_count).toBe(1);
  });

  it("withholds the distinct-firm count from a reader until the display floor is reached", async () => {
    await vote(AUTHOR, AUTHOR_PROFILE, FIRM_ONE, "communityVote_a");
    await vote(READER, READER_PROFILE, FIRM_TWO, "communityVote_b");
    const row = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    const projected = publicPost({
      number: row?.number ?? 0,
      slug: "x",
      kind: "request",
      category: "search",
      title: "t",
      body: "b",
      status: null,
      declineReason: null,
      declineNote: null,
      duplicateOfNumber: null,
      voteCount: row?.vote_count ?? 0,
      distinctFirmVoteCount: row?.distinct_firm_vote_count ?? 0,
      commentCount: 0,
      acceptedCommentReference: null,
      visibility: "published",
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      lastActivityAt: NOW,
      author: { id: AUTHOR_PROFILE, displayName: "Marilyn Veitch", badge: "none" },
    });
    // Two firms would tell a reader roughly who the second firm is, on a post signed with a real
    // name. The raw total is shown because it names nobody.
    expect(projected.distinctFirmVoteCount).toBeUndefined();
    expect(projected.voteCount).toBe(2);
  });
});

describe("removal", () => {
  beforeEach(async () => {
    await seedPost(POST, 1001);
  });

  it("erases the author's own words in one write, title and body together", async () => {
    const result = await authorDeletePostStatement(test.database, {
      postId: POST,
      authorUserId: AUTHOR,
      now: NOW,
    }).run();
    expect(result.meta.changes).toBe(1);
    const stored = test.raw
      .prepare(`SELECT title, body, visibility FROM community_post WHERE id = ?`)
      .get(POST) as { title: string; body: string; visibility: string };
    expect(stored.title).toBe("");
    expect(stored.body).toBe("");
    expect(stored.visibility).toBe("deleted_by_author");
  });

  it("refuses to let one member delete another's post", async () => {
    const result = await authorDeletePostStatement(test.database, {
      postId: POST,
      authorUserId: READER,
      now: NOW,
    }).run();
    expect(result.meta.changes).toBe(0);
  });

  it("hides on a single confidentiality report and restores cleanly", async () => {
    await test.database.batch([
      insertFlagStatement(test.database, {
        id: "communityFlag_one" as CommunityFlagId,
        subjectKind: "post",
        subjectId: POST,
        reason: "confidentiality",
        note: null,
        reporterUserId: READER,
        reporterFirmId: FIRM_TWO,
        now: NOW,
      }),
      hidePostStatement(test.database, {
        postId: POST,
        reason: "confidentiality_report",
        now: NOW,
      }),
      insertModerationActionStatement(test.database, {
        id: "communityModerationAction_one" as never,
        subjectKind: "post",
        subjectId: POST,
        action: "hidden",
        actorUserId: null,
        reason: "confidentiality_report",
        note: null,
        now: NOW,
      }),
    ]);
    const hidden = await listPostsStatement(test.database, {
      sort: "new",
      limit: 20,
      now: NOW,
    }).all<StoredPostRow>();
    // Absent from the list, not present with a marker: a placeholder is a sign pointing at the one
    // post somebody thought might name a client.
    expect(hidden.results).toEqual([]);

    const restored = await restorePostStatement(test.database, POST, NOW).run();
    expect(restored.meta.changes).toBe(1);
    const afterRestore = await selectPostByNumberStatement(
      test.database,
      1001,
    ).first<StoredPostRow>();
    expect(afterRestore?.visibility).toBe("published");
    expect(afterRestore?.body).not.toBe("");
  });

  it("cannot restore what an author deleted", async () => {
    await authorDeletePostStatement(test.database, {
      postId: POST,
      authorUserId: AUTHOR,
      now: NOW,
    }).run();
    const restored = await restorePostStatement(test.database, POST, NOW).run();
    expect(restored.meta.changes).toBe(0);
  });

  it("cannot hide what an author deleted, so a moderation action cannot resurrect it", async () => {
    await authorDeletePostStatement(test.database, {
      postId: POST,
      authorUserId: AUTHOR,
      now: NOW,
    }).run();
    const hidden = await hidePostStatement(test.database, {
      postId: POST,
      reason: "operator",
      now: NOW,
    }).run();
    expect(hidden.meta.changes).toBe(0);
    const removed = await removePostStatement(test.database, POST, NOW).run();
    expect(removed.meta.changes).toBe(0);
  });

  it("records an automatic hide with no actor, and an operator's with one", async () => {
    await test.database.batch([
      insertModerationActionStatement(test.database, {
        id: "communityModerationAction_auto" as never,
        subjectKind: "post",
        subjectId: POST,
        action: "hidden",
        actorUserId: null,
        reason: "confidentiality_detector",
        note: null,
        now: NOW,
      }),
      insertModerationActionStatement(test.database, {
        id: "communityModerationAction_human" as never,
        subjectKind: "post",
        subjectId: POST,
        action: "restored",
        actorUserId: READER,
        reason: null,
        note: "Cleared on review.",
        now: "2026-08-13T09:05:00.000Z",
      }),
    ]);
    const rows = test.raw
      .prepare(`SELECT action, actor_user_id FROM community_moderation_action ORDER BY created_at`)
      .all() as { action: string; actor_user_id: string | null }[];
    expect(rows).toEqual([
      { action: "hidden", actor_user_id: null },
      { action: "restored", actor_user_id: READER },
    ]);
  });
});

describe("spam reporting", () => {
  beforeEach(async () => {
    await seedPost(POST, 1001);
  });

  it("counts distinct firms, not reports, and ignores confidentiality reports in that count", async () => {
    await test.database.batch([
      insertFlagStatement(test.database, {
        id: "communityFlag_spam1" as CommunityFlagId,
        subjectKind: "post",
        subjectId: POST,
        reason: "spam",
        note: null,
        reporterUserId: READER,
        reporterFirmId: FIRM_TWO,
        now: NOW,
      }),
      insertFlagStatement(test.database, {
        id: "communityFlag_spam2" as CommunityFlagId,
        subjectKind: "post",
        subjectId: POST,
        reason: "spam",
        note: null,
        reporterUserId: THIRD,
        reporterFirmId: FIRM_TWO,
        now: NOW,
      }),
    ]);
    const counted = await countDistinctReportingFirmsStatement(test.database, POST).first<{
      firm_count: number;
    }>();
    // Two accounts, one firm: one firm's worth of accounts cannot reach the threshold by itself.
    expect(counted?.firm_count).toBe(1);
  });

  it("refuses a second report of the same subject by the same reader", async () => {
    await insertFlagStatement(test.database, {
      id: "communityFlag_a" as CommunityFlagId,
      subjectKind: "post",
      subjectId: POST,
      reason: "spam",
      note: null,
      reporterUserId: READER,
      reporterFirmId: FIRM_TWO,
      now: NOW,
    }).run();
    await insertFlagStatement(test.database, {
      id: "communityFlag_b" as CommunityFlagId,
      subjectKind: "post",
      subjectId: POST,
      reason: "spam",
      note: null,
      reporterUserId: READER,
      reporterFirmId: FIRM_TWO,
      now: NOW,
    }).run();
    const rows = test.raw
      .prepare(`SELECT COUNT(*) AS count FROM community_flag WHERE subject_id = ?`)
      .get(POST) as { count: number };
    expect(rows.count).toBe(1);
  });

  it("puts confidentiality at the head of the operator's queue whatever its age", async () => {
    await test.database.batch([
      insertFlagStatement(test.database, {
        id: "communityFlag_old" as CommunityFlagId,
        subjectKind: "post",
        subjectId: POST,
        reason: "spam",
        note: null,
        reporterUserId: READER,
        reporterFirmId: FIRM_TWO,
        now: "2026-08-01T00:00:00.000Z",
      }),
      insertFlagStatement(test.database, {
        id: "communityFlag_new" as CommunityFlagId,
        subjectKind: "post",
        subjectId: POST,
        reason: "confidentiality",
        note: null,
        reporterUserId: THIRD,
        reporterFirmId: FIRM_THREE,
        now: "2026-08-13T00:00:00.000Z",
      }),
    ]);
    const queue = await listOpenFlagsStatement(test.database, 10).all<{ reason: string }>();
    expect(queue.results.map((row) => row.reason)).toEqual(["confidentiality", "spam"]);
  });
});

describe("the request pipeline", () => {
  it("refuses to give a question a status", async () => {
    await seedPost(POST, 1001, { kind: "question" });
    const result = await setPostStatusStatement(test.database, {
      postId: POST,
      status: "planned",
      declineReason: null,
      declineNote: null,
      now: NOW,
    }).run();
    expect(result.meta.changes).toBe(0);
  });

  it("converts a question into a request, carrying its thread", async () => {
    await seedPost(POST, 1001, { kind: "question" });
    await test.database.batch([
      insertCommentStatement(test.database, {
        id: "communityComment_one" as CommunityCommentId,
        postId: POST,
        authorProfileId: READER_PROFILE,
        authorUserId: READER,
        authorFirmId: FIRM_TWO,
        body: "There is no way to do this today.",
        isOperatorResponse: false,
        visibility: "published",
        hiddenReason: null,
        now: NOW,
      }),
      recountPostCommentsStatement(test.database, POST),
    ]);
    await convertQuestionToRequestStatement(test.database, {
      postId: POST,
      status: "future",
      now: NOW,
    }).run();
    const row = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    expect(row?.kind).toBe("request");
    expect(row?.status).toBe("future");
    expect(row?.comment_count).toBe(1);
    const thread = await listCommentsStatement(test.database, {
      postId: POST,
      limit: 20,
    }).all();
    expect(thread.results).toHaveLength(1);
  });

  it("carries a duplicate's votes to its target without double-counting a shared voter", async () => {
    await seedPost(POST, 1001);
    await seedPost(OTHER_POST, 1002);
    await test.database.batch([
      insertVoteStatement(test.database, {
        id: "communityVote_dup1" as CommunityVoteId,
        postId: POST,
        profileId: READER_PROFILE,
        userId: READER,
        firmId: FIRM_TWO,
        now: NOW,
      }),
      insertVoteStatement(test.database, {
        id: "communityVote_dup2" as CommunityVoteId,
        postId: POST,
        profileId: THIRD_PROFILE,
        userId: THIRD,
        firmId: FIRM_THREE,
        now: NOW,
      }),
      insertVoteStatement(test.database, {
        id: "communityVote_target1" as CommunityVoteId,
        postId: OTHER_POST,
        profileId: READER_PROFILE,
        userId: READER,
        firmId: FIRM_TWO,
        now: NOW,
      }),
      carryVotesToDuplicateTargetStatement(test.database, {
        postId: POST,
        targetPostId: OTHER_POST,
      }),
      markDuplicateStatement(test.database, {
        postId: POST,
        targetPostId: OTHER_POST,
        now: NOW,
      }),
      recountPostVotesStatement(test.database, OTHER_POST),
      recountPostVotesStatement(test.database, POST),
    ]);
    const target = await selectPostByNumberStatement(test.database, 1002).first<StoredPostRow>();
    // The reader had already voted for the target, so their vote does not arrive twice.
    expect(target?.vote_count).toBe(2);
    expect(target?.distinct_firm_vote_count).toBe(2);
    const duplicate = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    expect(duplicate?.status).toBe("duplicate");
    expect(duplicate?.duplicate_of_number).toBe(1002);
  });

  it("lets a question's own author accept an answer, and nobody else", async () => {
    await seedPost(POST, 1001, { kind: "question" });
    await insertCommentStatement(test.database, {
      id: "communityComment_answer" as CommunityCommentId,
      postId: POST,
      authorProfileId: READER_PROFILE,
      authorUserId: READER,
      authorFirmId: FIRM_TWO,
      body: "Use the bulk edit panel from the closed-matters view.",
      isOperatorResponse: false,
      visibility: "published",
      hiddenReason: null,
      now: NOW,
    }).run();
    const byStranger = await acceptAnswerStatement(test.database, {
      postId: POST,
      commentId: "communityComment_answer" as CommunityCommentId,
      authorUserId: READER,
      now: NOW,
    }).run();
    expect(byStranger.meta.changes).toBe(0);
    const byAuthor = await acceptAnswerStatement(test.database, {
      postId: POST,
      commentId: "communityComment_answer" as CommunityCommentId,
      authorUserId: AUTHOR,
      now: NOW,
    }).run();
    expect(byAuthor.meta.changes).toBe(1);
  });

  it("surfaces a request that has sat past the triage window with no status", async () => {
    await seedPost(POST, 1001);
    await seedPost(OTHER_POST, 1002);
    await setPostStatusStatement(test.database, {
      postId: OTHER_POST,
      status: "planned",
      declineReason: null,
      declineNote: null,
      now: NOW,
    }).run();
    const untriaged = await listUntriagedRequestsStatement(
      test.database,
      "2026-09-30T00:00:00.000Z",
      10,
    ).all<StoredPostRow>();
    expect(untriaged.results.map((row) => row.number)).toEqual([1001]);
  });

  it("archives a stale request and keeps every word of it", async () => {
    await seedPost(POST, 1001);
    await archiveStalePostsStatement(
      test.database,
      "2027-08-13T00:00:00.000Z",
      "2027-08-13T00:00:00.000Z",
    ).run();
    const row = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    expect(row?.archived_at).toBe("2027-08-13T00:00:00.000Z");
    expect(row?.body).not.toBe("");
    expect(row?.visibility).toBe("published");
  });
});

describe("the post-number sequence", () => {
  it("starts above one, so an early reader cannot count the board", async () => {
    await ensurePostNumberCounterStatement(test.database).run();
    const drawn = await selectNextPostNumberStatement(test.database).first<{
      next_value: number;
    }>();
    expect(drawn?.next_value).toBe(FIRST_POST_NUMBER);
    expect(FIRST_POST_NUMBER).toBeGreaterThan(1);
  });

  it("advances only for the drawer that observed the current value", async () => {
    await ensurePostNumberCounterStatement(test.database).run();
    const winner = await advancePostNumberStatement(test.database, FIRST_POST_NUMBER).run();
    expect(winner.meta.changes).toBe(1);
    // The loser observed the same value, and its guarded update matches nothing. A zero-row UPDATE
    // is not an error in SQLite, which is exactly why the allocation row below is the real guard.
    const loser = await advancePostNumberStatement(test.database, FIRST_POST_NUMBER).run();
    expect(loser.meta.changes).toBe(0);
  });

  it("aborts a second claim on the same number", async () => {
    await ensurePostNumberCounterStatement(test.database).run();
    await seedPost(POST, FIRST_POST_NUMBER);
    await seedPost(OTHER_POST, FIRST_POST_NUMBER + 1);
    await allocatePostNumberStatement(test.database, {
      drawnValue: FIRST_POST_NUMBER,
      postId: POST,
      now: NOW,
    }).run();
    expect(() =>
      allocatePostNumberStatement(test.database, {
        drawnValue: FIRST_POST_NUMBER,
        postId: OTHER_POST,
        now: NOW,
      }).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("does not reset a running counter", async () => {
    await ensurePostNumberCounterStatement(test.database).run();
    await advancePostNumberStatement(test.database, FIRST_POST_NUMBER).run();
    await ensurePostNumberCounterStatement(test.database).run();
    const drawn = await selectNextPostNumberStatement(test.database).first<{
      next_value: number;
    }>();
    expect(drawn?.next_value).toBe(FIRST_POST_NUMBER + 1);
  });
});

describe("comments", () => {
  it("counts only published comments, so a held first comment does not inflate a thread", async () => {
    await seedPost(POST, 1001);
    await test.database.batch([
      insertCommentStatement(test.database, {
        id: "communityComment_held" as CommunityCommentId,
        postId: POST,
        authorProfileId: READER_PROFILE,
        authorUserId: READER,
        authorFirmId: FIRM_TWO,
        body: "Held pending review.",
        isOperatorResponse: false,
        visibility: "pending_first_write_review",
        hiddenReason: null,
        now: NOW,
      }),
      recountPostCommentsStatement(test.database, POST),
    ]);
    let row = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    expect(row?.comment_count).toBe(0);

    await test.database.batch([
      publishCommentStatement(test.database, "communityComment_held" as CommunityCommentId, NOW),
      recountPostCommentsStatement(test.database, POST),
    ]);
    row = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    expect(row?.comment_count).toBe(1);
  });
});

describe("edits", () => {
  it("leaves no readable trace of what a post used to say", async () => {
    await seedPost(POST, 1001);
    await authorEditPostStatement(test.database, {
      postId: POST,
      authorUserId: AUTHOR,
      title: "Trust reversal on a fee dispute",
      body: "Rewritten without the detail that should not have been there.",
      now: "2026-08-13T10:00:00.000Z",
    }).run();
    // There is no revision table to look in, which is the property being asserted: a member who
    // realises their post said too much can make the original unreadable, and no schema object
    // holds a copy.
    const tables = test.raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'community%'`)
      .all() as { name: string }[];
    expect(tables.map((table) => table.name)).not.toContain("community_post_revision");
    const row = await selectPostByNumberStatement(test.database, 1001).first<StoredPostRow>();
    expect(row?.title).toBe("Trust reversal on a fee dispute");
    expect(row?.updated_at).toBe("2026-08-13T10:00:00.000Z");
  });
});
