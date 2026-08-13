// The board's write logic, in one place, so the route handlers stay thin and so every rule that
// decides what happens to a member's words can be read without reading HTTP.
//
// Everything here runs against the control-plane database through @magna-carta/community's
// statement builders. Nothing here can reach a firm's own data, because this worker holds no
// binding that could.

import type {
  CommunityCommentId,
  CommunityFlagId,
  CommunityModerationActionId,
  CommunityPostId,
  CommunityProfileId,
  CommunityVoteId,
  UserId,
} from "@magna-carta/identifiers/types";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { BatchSqlDatabase, SqlStatement } from "@magna-carta/community/sql";
import type { Category } from "@magna-carta/community/categories";
import {
  detectConfidentialitySignals,
  type ConfidentialityFinding,
} from "@magna-carta/community/confidentiality-detector";
import { slugFromTitle } from "@magna-carta/community/slug";
import {
  SPAM_REPORT_DISTINCT_FIRM_THRESHOLD,
  type FlagReason,
  type HiddenReason,
  type PostKind,
  type SubjectKind,
  type Visibility,
} from "@magna-carta/community/types";
import {
  approveFirstWriteStatement,
  insertProfileStatement,
  selectProfileByUserStatement,
  toProfileRecord,
  type ProfileRecord,
  type StoredProfileRow,
} from "@magna-carta/community/profile-statements";
import {
  authorDeleteCommentStatement,
  insertCommentStatement,
  selectCommentIdentityStatement,
} from "@magna-carta/community/comment-statements";
import {
  authorDeletePostStatement,
  hidePostStatement,
  insertPostStatement,
  recountPostCommentsStatement,
  recountPostVotesStatement,
  selectPostIdentityByNumberStatement,
  touchLastActivityStatement,
} from "@magna-carta/community/post-statements";
import { hideCommentStatement } from "@magna-carta/community/comment-statements";
import {
  advancePostNumberStatement,
  allocatePostNumberStatement,
  ensurePostNumberCounterStatement,
  MAX_POST_NUMBER_DRAW_ATTEMPTS,
  selectNextPostNumberStatement,
} from "@magna-carta/community/post-number";
import { deleteVoteStatement, insertVoteStatement } from "@magna-carta/community/vote-statements";
import {
  countDistinctReportingFirmsStatement,
  insertFlagStatement,
} from "@magna-carta/community/flag-statements";
import { insertModerationActionStatement } from "@magna-carta/community/moderation-statements";
import type { BoardSession } from "./session.ts";

export interface BoardServiceOptions {
  readonly database: BatchSqlDatabase;
  readonly now: () => string;
}

export interface PostIdentity {
  readonly id: CommunityPostId;
  readonly kind: PostKind;
  readonly status: string | null;
  readonly visibility: Visibility;
  readonly authorProfileId: CommunityProfileId;
  readonly authorUserId: UserId;
}

interface StoredPostIdentity {
  readonly id: string;
  readonly kind: string;
  readonly status: string | null;
  readonly visibility: string;
  readonly author_profile_id: string;
  readonly author_user_id: string;
}

interface StoredCommentIdentity {
  readonly id: string;
  readonly post_id: string;
  readonly author_profile_id: string;
  readonly author_user_id: string;
  readonly visibility: string;
}

export type CreatePostOutcome =
  | { readonly kind: "published"; readonly number: number; readonly slug: string }
  | {
      readonly kind: "held";
      readonly number: number;
      readonly slug: string;
      readonly reason: HiddenReason | "first_write_review";
      readonly findings: readonly ConfidentialityFinding[];
    };

export function createBoardService(options: BoardServiceOptions) {
  const { database, now } = options;

  // A member's board identity, created on their first WRITE and never on a read — so somebody who
  // only ever reads the board leaves no record on it.
  //
  // The suggested display name is the account's own, which is the reference product's default and
  // is harmless here because the firm is never shown beside it. A member who wants a handle sets
  // one on their profile, once, for the account.
  async function profileFor(session: BoardSession): Promise<ProfileRecord> {
    const existing = await selectProfileByUserStatement(
      database,
      session.userId,
    ).first<StoredProfileRow>();
    if (existing !== null) return toProfileRecord(existing);
    const id = newIdentifier("communityProfile") as CommunityProfileId;
    const instant = now();
    await insertProfileStatement(database, {
      id,
      userId: session.userId,
      firmId: session.firmId,
      displayName: session.accountName,
      isPseudonym: false,
      now: instant,
    }).run();
    const created = await selectProfileByUserStatement(
      database,
      session.userId,
    ).first<StoredProfileRow>();
    if (created === null) throw new Error("community profile vanished immediately after creation");
    return toProfileRecord(created);
  }

  async function postIdentity(number: number): Promise<PostIdentity | null> {
    const row = await selectPostIdentityByNumberStatement(
      database,
      number,
    ).first<StoredPostIdentity>();
    if (row === null) return null;
    return {
      id: row.id as CommunityPostId,
      kind: row.kind as PostKind,
      status: row.status,
      visibility: row.visibility as Visibility,
      authorProfileId: row.author_profile_id as CommunityProfileId,
      authorUserId: row.author_user_id as UserId,
    };
  }

  // Drawing the public number. The guarded increment is not the guard — the allocation row is —
  // so a losing drawer's whole batch aborts and it comes back here to re-read the advanced counter.
  async function createPost(
    session: BoardSession,
    input: {
      readonly kind: PostKind;
      readonly category: Category;
      readonly title: string;
      readonly body: string;
    },
  ): Promise<CreatePostOutcome> {
    const profile = await profileFor(session);
    const instant = now();
    const detected = detectConfidentialitySignals({
      title: input.title,
      body: input.body,
      category: input.category,
    });

    // Two independent reasons a post arrives unpublished, and the more serious one wins the label.
    // A brand-new account's first post is held because nothing from an account nobody has seen
    // becomes publicly visible unreviewed. A post carrying a format signal is hidden because the
    // two errors are not symmetric: waiting costs a member their afternoon, and publishing costs a
    // client their confidentiality permanently.
    const heldForFirstWrite = profile.firstWriteApprovedAt === null;
    const visibility: Visibility = detected.shouldHide
      ? "hidden"
      : heldForFirstWrite
        ? "pending_first_write_review"
        : "published";
    const hiddenReason: HiddenReason | null = detected.shouldHide
      ? "confidentiality_detector"
      : null;

    await ensurePostNumberCounterStatement(database).run();
    let lastFailure: unknown = null;
    for (let attempt = 0; attempt < MAX_POST_NUMBER_DRAW_ATTEMPTS; attempt += 1) {
      const counter = await selectNextPostNumberStatement(database).first<{ next_value: number }>();
      if (counter === null) throw new Error("post-number counter missing after it was ensured");
      const drawn = counter.next_value;
      const id = newIdentifier("communityPost") as CommunityPostId;
      const slug = slugFromTitle(input.title);
      const statements: SqlStatement[] = [
        advancePostNumberStatement(database, drawn),
        insertPostStatement(database, {
          id,
          number: drawn,
          slug,
          kind: input.kind,
          category: input.category,
          title: input.title,
          body: input.body,
          authorProfileId: profile.id,
          authorUserId: session.userId,
          authorFirmId: session.firmId,
          visibility,
          hiddenReason,
          now: instant,
        }),
        allocatePostNumberStatement(database, { drawnValue: drawn, postId: id, now: instant }),
      ];
      if (detected.shouldHide) {
        // The automatic hide is recorded with NO actor, which is how the record distinguishes the
        // platform acting at three in the morning from the owner acting at nine.
        statements.push(
          insertModerationActionStatement(database, {
            id: newIdentifier("communityModerationAction") as CommunityModerationActionId,
            subjectKind: "post",
            subjectId: id,
            action: "hidden",
            actorUserId: null,
            // The signal names, never the text that matched them: a moderation record that quotes
            // the post it hid has copied the disclosure into a second place.
            reason: detected.findings.map((finding) => finding.signal).join(","),
            note: null,
            now: instant,
          }),
        );
      }
      try {
        await database.batch(statements);
      } catch (caught) {
        lastFailure = caught;
        continue;
      }
      if (visibility === "published") return { kind: "published", number: drawn, slug };
      return {
        kind: "held",
        number: drawn,
        slug,
        reason: detected.shouldHide ? "confidentiality_detector" : "first_write_review",
        findings: detected.findings,
      };
    }
    throw new Error(
      `could not draw a post number after ${MAX_POST_NUMBER_DRAW_ATTEMPTS} attempts`,
      { cause: lastFailure },
    );
  }

  async function vote(session: BoardSession, post: PostIdentity): Promise<void> {
    const profile = await profileFor(session);
    const instant = now();
    await database.batch([
      insertVoteStatement(database, {
        id: newIdentifier("communityVote") as CommunityVoteId,
        postId: post.id,
        profileId: profile.id,
        userId: session.userId,
        firmId: session.firmId,
        now: instant,
      }),
      recountPostVotesStatement(database, post.id),
      touchLastActivityStatement(database, post.id, instant),
    ]);
  }

  async function withdrawVote(session: BoardSession, post: PostIdentity): Promise<void> {
    await database.batch([
      deleteVoteStatement(database, { postId: post.id, userId: session.userId }),
      recountPostVotesStatement(database, post.id),
    ]);
  }

  async function comment(
    session: BoardSession,
    post: PostIdentity,
    body: string,
  ): Promise<{ readonly held: boolean; readonly reference: CommunityCommentId }> {
    const profile = await profileFor(session);
    const instant = now();
    const detected = detectConfidentialitySignals({ title: "", body });
    const visibility: Visibility = detected.shouldHide
      ? "hidden"
      : profile.firstWriteApprovedAt === null
        ? "pending_first_write_review"
        : "published";
    const id = newIdentifier("communityComment") as CommunityCommentId;
    const statements: SqlStatement[] = [
      insertCommentStatement(database, {
        id,
        postId: post.id,
        authorProfileId: profile.id,
        authorUserId: session.userId,
        authorFirmId: session.firmId,
        body,
        isOperatorResponse: false,
        visibility,
        hiddenReason: detected.shouldHide ? "confidentiality_detector" : null,
        now: instant,
      }),
      recountPostCommentsStatement(database, post.id),
      touchLastActivityStatement(database, post.id, instant),
    ];
    if (detected.shouldHide) {
      statements.push(
        insertModerationActionStatement(database, {
          id: newIdentifier("communityModerationAction") as CommunityModerationActionId,
          subjectKind: "comment",
          subjectId: id,
          action: "hidden",
          actorUserId: null,
          reason: detected.findings.map((finding) => finding.signal).join(","),
          note: null,
          now: instant,
        }),
      );
    }
    await database.batch(statements);
    return { held: visibility !== "published", reference: id };
  }

  // THE ONE-CLICK DELETE. One statement, guarded on the author's own account, erasing the words
  // rather than hiding them. The author is the fastest and most frequent detector of a post that
  // said too much — usually within minutes — and everything else on this board exists to catch what
  // they miss, which is why this path has no queue, no operator and no delay in it.
  async function deleteOwnPost(session: BoardSession, post: PostIdentity): Promise<boolean> {
    const result = await authorDeletePostStatement(database, {
      postId: post.id,
      authorUserId: session.userId,
      now: now(),
    }).run();
    return result.meta.changes > 0;
  }

  async function deleteOwnComment(
    session: BoardSession,
    commentId: CommunityCommentId,
  ): Promise<boolean> {
    const identity = await selectCommentIdentityStatement(
      database,
      commentId,
    ).first<StoredCommentIdentity>();
    if (identity === null) return false;
    const instant = now();
    const result = await authorDeleteCommentStatement(database, {
      commentId,
      authorUserId: session.userId,
      now: instant,
    }).run();
    if (result.meta.changes === 0) return false;
    await recountPostCommentsStatement(database, identity.post_id as CommunityPostId).run();
    return true;
  }

  // A REPORT, AND THE ASYMMETRY THAT DEFINES THIS BOARD.
  //
  // A confidentiality report hides its subject immediately, on one report, from any signed-in
  // reader — because waiting for a second reader to agree that a post names a client means waiting
  // for the disclosure to be read twice. A spam or abuse report is counted and hides nothing until
  // several separate FIRMS have reported it, which bounds report abuse without putting a threshold
  // in front of the case that cannot wait.
  async function report(
    session: BoardSession,
    subject: { readonly kind: SubjectKind; readonly id: string },
    input: { readonly reason: FlagReason; readonly note: string | null },
  ): Promise<{ readonly hidden: boolean }> {
    const instant = now();
    await insertFlagStatement(database, {
      id: newIdentifier("communityFlag") as CommunityFlagId,
      subjectKind: subject.kind,
      subjectId: subject.id,
      reason: input.reason,
      note: input.note,
      reporterUserId: session.userId,
      reporterFirmId: session.firmId,
      now: instant,
    }).run();

    let hiddenReason: HiddenReason | null = null;
    if (input.reason === "confidentiality") {
      hiddenReason = "confidentiality_report";
    } else {
      const counted = await countDistinctReportingFirmsStatement(database, subject.id).first<{
        firm_count: number;
      }>();
      if ((counted?.firm_count ?? 0) >= SPAM_REPORT_DISTINCT_FIRM_THRESHOLD) {
        hiddenReason = "spam_reports";
      }
    }
    if (hiddenReason === null) return { hidden: false };

    const hide =
      subject.kind === "post"
        ? hidePostStatement(database, {
            postId: subject.id as CommunityPostId,
            reason: hiddenReason,
            now: instant,
          })
        : hideCommentStatement(database, {
            commentId: subject.id as CommunityCommentId,
            reason: hiddenReason,
            now: instant,
          });
    const result = await hide.run();
    if (result.meta.changes === 0) return { hidden: false };
    await insertModerationActionStatement(database, {
      id: newIdentifier("communityModerationAction") as CommunityModerationActionId,
      subjectKind: subject.kind,
      subjectId: subject.id,
      action: "hidden",
      // No actor: the reader raised the report, but the hide was the platform's automatic response
      // to it rather than a person's judgement. A person's judgement is the review that follows.
      actorUserId: null,
      reason: hiddenReason,
      note: null,
      now: instant,
    }).run();
    return { hidden: true };
  }

  async function approveFirstWrite(profileId: CommunityProfileId): Promise<boolean> {
    const result = await approveFirstWriteStatement(database, profileId, now()).run();
    return result.meta.changes > 0;
  }

  return {
    profileFor,
    postIdentity,
    createPost,
    vote,
    withdrawVote,
    comment,
    deleteOwnPost,
    deleteOwnComment,
    report,
    approveFirstWrite,
  };
}

export type BoardService = ReturnType<typeof createBoardService>;
