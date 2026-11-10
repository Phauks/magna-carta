import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { CommunityCommentId, FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptAnswer,
  addComment,
  createPost,
  deleteOwnComment,
  deleteOwnPost,
  flag,
  listBoard,
  moderate,
  readBoardSummary,
  readPost,
  saveDisplayName,
  setStatus,
  vote,
  type BoardMember,
} from "../src/board-service.ts";
import type { SqlDatabase } from "../src/sql-database.ts";

const NOW = "2026-11-10T12:00:00.000Z";
const LATER = "2026-11-10T13:00:00.000Z";

let database: SqlDatabase;
let raw: ReturnType<typeof createMigratedNodeDatabase>["raw"];

function firm(id: string): FirmId {
  raw
    .prepare("INSERT INTO firm (id, name, created_at) VALUES (?, ?, ?)")
    .run(id, `Firm ${id}`, NOW);
  return id as FirmId;
}

function person(id: string, firmId: FirmId): UserId {
  raw
    .prepare("INSERT INTO user (id, name, email, firm_id) VALUES (?, ?, ?, ?)")
    .run(id, `Real Name ${id}`, `${id}@example.com`, firmId);
  return id as UserId;
}

async function member(
  id: string,
  firmId: FirmId,
  displayName: string,
  isTeam = false,
): Promise<BoardMember> {
  const userId = person(id, firmId);
  await saveDisplayName(database, userId, displayName, NOW);
  return { userId, firmId, isTeam };
}

let team: BoardMember;
let dana: BoardMember;
let priya: BoardMember;

async function publishedRequest(
  author: BoardMember,
  title = "Split one invoice across two trust accounts",
) {
  const created = await createPost(
    database,
    author,
    {
      kind: "request",
      category: "trust-and-reconciliation",
      title,
      body: "Two deposits, one invoice.",
    },
    NOW,
  );
  if (!created.ok) {
    throw new Error(created.refusal);
  }
  if (created.value.moderationState !== "published") {
    await moderate(database, team, { number: created.value.number }, "publish", NOW);
  }
  return created.value.number;
}

beforeEach(async () => {
  const migrated = createMigratedNodeDatabase("control-plane");
  database = migrated.database as unknown as SqlDatabase;
  raw = migrated.raw;
  const staffFirm = firm("firm_team");
  const firmA = firm("firm_a");
  const firmB = firm("firm_b");
  team = await member("user_team", staffFirm, "Trevor", true);
  dana = await member("user_dana", firmA, "Dana R.");
  priya = await member("user_priya", firmB, "Priya");
});

describe("posting", () => {
  it("holds a first post until a moderator publishes it, then lets the author post freely", async () => {
    const first = await createPost(
      database,
      dana,
      {
        kind: "request",
        category: "time-and-costs",
        title: "Start a timer from the keyboard",
        body: "One key.",
      },
      NOW,
    );
    expect(first.ok && first.value).toMatchObject({
      number: 1,
      moderationState: "held",
      heldReason: "first-post",
    });
    expect(
      (
        await listBoard(
          database,
          { kind: "request", sort: "new", limit: 10, offset: 0 },
          undefined,
          NOW,
        )
      ).total,
    ).toBe(0);
    // The author sees their own held post; nobody else does.
    expect((await readPost(database, 1, dana)).ok).toBe(true);
    expect((await readPost(database, 1, priya)).ok).toBe(false);

    await moderate(database, team, { number: 1 }, "publish", NOW);
    const second = await createPost(
      database,
      dana,
      {
        kind: "request",
        category: "time-and-costs",
        title: "Show unbilled time on the header",
        body: "Small.",
      },
      NOW,
    );
    expect(second.ok && second.value).toMatchObject({ number: 2, moderationState: "published" });
  });

  it("holds anything the detector flags, even from an approved author or the team", async () => {
    const created = await createPost(
      database,
      team,
      {
        kind: "question",
        category: "trust-and-reconciliation",
        title: "Reversing a trust payment",
        body: "For Hendricks v. Lowell, matter 2026-CV-0412, the invoice reopens.",
      },
      NOW,
    );
    expect(created.ok && created.value.heldReason).toBe("detector");
    expect(created.ok && created.value.findings.map((finding) => finding.kind)).toEqual([
      "case-caption",
      "docket-or-matter-number",
    ]);
  });

  it("refuses a category that is not a product area, and a member with no profile", async () => {
    expect(
      await createPost(
        database,
        dana,
        { kind: "request", category: "general", title: "Anything at all", body: "x" },
        NOW,
      ),
    ).toEqual({ ok: false, refusal: "invalid-category" });
    const stranger = {
      userId: person("user_new", dana.firmId),
      firmId: dana.firmId,
      isTeam: false,
    };
    expect(
      await createPost(
        database,
        stranger,
        { kind: "request", category: "reports", title: "A report I need", body: "x" },
        NOW,
      ),
    ).toEqual({ ok: false, refusal: "profile-required" });
  });
});

describe("voting", () => {
  it("counts votes and distinct firms, withholds counts below five, and never says who voted", async () => {
    const number = await publishedRequest(dana);
    await vote(database, dana, number, true, NOW);
    await vote(database, dana, number, true, NOW); // a repeat is a no-op
    await vote(database, priya, number, true, NOW);
    const early = await readPost(database, number, undefined);
    expect(early.ok && early.value.post).toMatchObject({ voteCount: null, firmVoteCount: null });

    for (const index of [1, 2, 3]) {
      const colleague = await member(`user_b${index}`, priya.firmId, `B${index}`);
      await vote(database, colleague, number, true, LATER);
    }
    const read = await readPost(database, number, priya);
    expect(read.ok && read.value.post).toMatchObject({
      voteCount: 5,
      firmVoteCount: 2,
      viewerHasVoted: true,
    });
    expect(JSON.stringify(read)).not.toMatch(/firm_a|firm_b|user_dana|Real Name/);

    await vote(database, priya, number, false, LATER);
    const after = await readPost(database, number, priya);
    expect(after.ok && after.value.post).toMatchObject({ voteCount: null, viewerHasVoted: false });
  });

  it("ranks Top by distinct firms rather than raw votes", async () => {
    const oneFirm = await publishedRequest(dana, "Requested by one firm many times");
    const twoFirms = await publishedRequest(dana, "Requested by two different firms");
    for (const index of [1, 2, 3]) {
      await vote(
        database,
        await member(`user_a${index}`, dana.firmId, `A${index}`),
        oneFirm,
        true,
        NOW,
      );
    }
    await vote(database, dana, twoFirms, true, NOW);
    await vote(database, priya, twoFirms, true, NOW);
    const top = await listBoard(
      database,
      { kind: "request", sort: "top", limit: 10, offset: 0 },
      undefined,
      NOW,
    );
    expect(top.posts.map((post) => post.number)).toEqual([twoFirms, oneFirm]);
  });

  it("does not let anyone vote on a question", async () => {
    await moderate(database, team, { number: await publishedRequest(dana) }, "publish", NOW);
    const question = await createPost(
      database,
      dana,
      {
        kind: "question",
        category: "reports",
        title: "How do I export a report?",
        body: "Where is it?",
      },
      NOW,
    );
    const number = question.ok ? question.value.number : 0;
    expect(await vote(database, priya, number, true, NOW)).toEqual({
      ok: false,
      refusal: "not-votable",
    });
  });
});

describe("comments, deletes and flags", () => {
  it("deletes the author's post in one write, leaving no text behind", async () => {
    const number = await publishedRequest(dana);
    expect(await deleteOwnPost(database, priya, number, NOW)).toEqual({
      ok: false,
      refusal: "not-the-author",
    });
    expect(await deleteOwnPost(database, dana, number, NOW)).toEqual({ ok: true, value: null });
    const row = raw
      .prepare("SELECT title, body, moderation_state FROM community_post WHERE number = ?")
      .get(number);
    expect(row).toEqual({ title: "", body: "", moderation_state: "deleted" });
    expect((await readPost(database, number, team)).ok).toBe(false);
  });

  it("marks a team reply, counts only published comments, and lets an author delete theirs", async () => {
    const number = await publishedRequest(dana);
    await addComment(database, team, number, "We are taking this on.", NOW);
    const priyaFirst = await addComment(database, priya, number, "Same need here.", NOW);
    expect(priyaFirst.ok && priyaFirst.value.moderationState).toBe("held");
    let read = await readPost(database, number, undefined);
    expect(read.ok && read.value.post.commentCount).toBe(1);
    expect(read.ok && read.value.comments[0]).toMatchObject({
      authorDisplayName: "Trevor",
      isTeamResponse: true,
    });

    const commentId = (priyaFirst.ok ? priyaFirst.value.id : "") as CommunityCommentId;
    await moderate(database, team, { number, commentId }, "publish", NOW);
    read = await readPost(database, number, undefined);
    expect(read.ok && read.value.post.commentCount).toBe(2);
    await deleteOwnComment(database, priya, commentId, NOW);
    read = await readPost(database, number, undefined);
    expect(read.ok && read.value.post.commentCount).toBe(1);
  });

  it("hides on one confidentiality flag, but needs three firms for spam", async () => {
    const number = await publishedRequest(dana);
    expect(await flag(database, priya, { number, reason: "spam" }, NOW)).toEqual({
      ok: true,
      value: { hidden: false },
    });
    expect(await flag(database, priya, { number, reason: "confidential" }, NOW)).toEqual({
      ok: true,
      value: { hidden: true },
    });
    expect((await readPost(database, number, undefined)).ok).toBe(false);
    await moderate(database, team, { number }, "publish", NOW);
    expect((await readPost(database, number, undefined)).ok).toBe(true);
  });
});

describe("the team", () => {
  it("only lets the team set a status, and requires a reason to decline", async () => {
    const number = await publishedRequest(dana);
    expect(await setStatus(database, dana, number, { status: "planned" }, NOW)).toEqual({
      ok: false,
      refusal: "not-team",
    });
    expect(await setStatus(database, team, number, { status: "not-on-the-roadmap" }, NOW)).toEqual({
      ok: false,
      refusal: "decline-reason-required",
    });
    expect(
      await setStatus(
        database,
        team,
        number,
        {
          status: "not-on-the-roadmap",
          declineReason: "already-possible",
          declineNote: "Use split payments.",
        },
        NOW,
      ),
    ).toEqual({ ok: true, value: null });
    await setStatus(database, team, number, { status: "planned" }, LATER);
    const read = await readPost(database, number, undefined);
    expect(read.ok && read.value.post).toMatchObject({ status: "planned", declineReason: null });
    const summary = await readBoardSummary(database);
    expect(summary.roadmap.planned).toBe(1);
    expect(summary.requestsByArea["trust-and-reconciliation"]).toBe(1);
  });

  it("marks a question answered when its author accepts a reply", async () => {
    await publishedRequest(dana);
    const question = await createPost(
      database,
      dana,
      {
        kind: "question",
        category: "reports",
        title: "How do I export a report?",
        body: "Where is it?",
      },
      NOW,
    );
    const number = question.ok ? question.value.number : 0;
    const answer = await addComment(database, team, number, "Use the export button.", NOW);
    const commentId = (answer.ok ? answer.value.id : "") as CommunityCommentId;
    expect(await acceptAnswer(database, priya, number, commentId, NOW)).toEqual({
      ok: false,
      refusal: "not-the-author",
    });
    await acceptAnswer(database, dana, number, commentId, NOW);
    const read = await readPost(database, number, undefined);
    expect(read.ok && read.value.post.status).toBe("answered");
    expect(read.ok && read.value.comments[0]?.isAcceptedAnswer).toBe(true);
  });
});

describe("search", () => {
  it("matches title and body text, treating % and _ literally", async () => {
    await publishedRequest(dana, "Court rules calendar for Nevada");
    await publishedRequest(dana, "100% of the trust balance");
    const found = await listBoard(
      database,
      { kind: "request", sort: "new", search: "nevada", limit: 10, offset: 0 },
      undefined,
      NOW,
    );
    expect(found.posts.map((post) => post.title)).toEqual(["Court rules calendar for Nevada"]);
    const percent = await listBoard(
      database,
      { kind: "request", sort: "new", search: "100%", limit: 10, offset: 0 },
      undefined,
      NOW,
    );
    expect(percent.total).toBe(1);
  });
});
