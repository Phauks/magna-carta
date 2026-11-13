import {
  acceptAnswer,
  addComment,
  createPost,
  deleteOwnComment,
  deleteOwnPost,
  dismissConfidentialityNotice,
  flag,
  getProfile,
  listBoard,
  moderate,
  readBoardSummary,
  readModerationQueue,
  readPost,
  saveDisplayName,
  setStatus,
  vote,
  type BoardResult,
} from "@magna-carta/community/board-service";
import { detectConfidentialDetail } from "@magna-carta/community/confidentiality-detector";
import {
  acceptAnswerRequestSchema,
  boardListQuerySchema,
  checkTextRequestSchema,
  createCommentRequestSchema,
  createPostRequestSchema,
  flagRequestSchema,
  moderateRequestSchema,
  saveProfileRequestSchema,
  setStatusRequestSchema,
} from "@magna-carta/community/contract";
import {
  mintSessionToken,
  readBoardState,
  redeemHandoff,
  resolveBoardViewer,
  SESSION_LIFETIME_SECONDS,
  verifyHandoffToken,
  verifySessionToken,
  type BoardState,
  type BoardViewer,
} from "@magna-carta/community/session";
import type { PostStatus } from "@magna-carta/community/vocabulary";
import type { CommunityCommentId, UserId } from "@magna-carta/identifiers/types";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { z } from "zod";
import type { Bindings } from "./bindings.ts";
import { json, problem, type BoardProblemCode } from "./respond.ts";

// The board's API. A write that has nothing to report answers 200 with an empty object rather than
// 204, so the app's one transport, which reads every success as JSON, reads it as a success.
//
// Reads are open to anyone; every write needs a signed-in member of a firm, a
// request from the board's own pages, and the board switch on "open".

// Sent as `__Host-community_session`: Hono adds the prefix, which binds the cookie to this exact host
// over HTTPS with path "/", so no sibling host under magnacarta.esq can set or read it.
export const SESSION_COOKIE = "community_session";

interface Variables {
  // The person behind the session cookie, or null when there is none or it no longer verifies.
  signedInUserId: UserId | null;
  // That person as the board sees them, or null when they are signed out or belong to no firm.
  viewer: BoardViewer | null;
  boardState: BoardState;
}

type BoardContext = Context<{ Bindings: Bindings; Variables: Variables }>;

const nowInstant = (): string => new Date().toISOString();
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function fromResult<T>(result: BoardResult<T>, shape: (value: T) => unknown): Response {
  return result.ok ? json(shape(result.value)) : problem(result.refusal);
}

async function parseBody<Schema extends z.ZodType>(
  context: BoardContext,
  schema: Schema,
): Promise<z.infer<Schema> | null> {
  let raw: unknown;
  try {
    raw = await context.req.json();
  } catch {
    return null;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function postNumber(context: BoardContext): number | null {
  const value = Number(context.req.param("number"));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// The app's page that mints the one-minute link and sends the person back here signed in. A person
// not signed in to the app meets the app's own sign-in first.
const signInUrl = (context: BoardContext): string =>
  `${context.env.APP_BASE_URL}/community-sign-in`;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// The guard every write passes: the board is open, the request came from the board's own pages, and
// a member of a firm is signed in. Returns the refusal, or null to go on.
function writeRefusal(context: BoardContext): BoardProblemCode | null {
  if (context.var.boardState === "read-only") return "board-read-only";
  // A browser always sends Origin on a cross-origin write; requiring it to be this host is the
  // cross-site request guard, on top of the cookie's SameSite=Lax.
  const origin = context.req.header("Origin");
  if (origin !== new URL(context.req.url).origin) return "cross-site-request";
  if (context.var.signedInUserId === null) return "sign-in-required";
  if (context.var.viewer === null) return "membership-required";
  return null;
}

export function boardApplication(): Hono<{ Bindings: Bindings; Variables: Variables }> {
  const application = new Hono<{ Bindings: Bindings; Variables: Variables }>();

  application.onError((caught, context) => {
    const errorId = logOperationFailed(
      createWorkersLogger(),
      `community.${context.req.method.toLowerCase()}`,
      caught,
    );
    return problem("internal-error", errorId);
  });

  application.notFound(() => problem("invalid-request"));

  // Who is asking, and whether the board is open, before any route runs.
  application.use("*", async (context, next) => {
    const database = context.env.DB_CONTROL;
    const boardState = await readBoardState(database);
    context.set("boardState", boardState);
    if (boardState === "off" && !context.req.path.startsWith("/session/")) {
      return problem("board-off");
    }
    const secret = context.env.COMMUNITY_HANDOFF_SECRET;
    const cookie = getCookie(context, SESSION_COOKIE, "host");
    const userId =
      secret === undefined || cookie === undefined
        ? null
        : await verifySessionToken(secret, cookie, nowSeconds());
    context.set("signedInUserId", userId);
    context.set(
      "viewer",
      userId === null ? null : await resolveBoardViewer(database, userId, nowInstant()),
    );
    if (WRITE_METHODS.has(context.req.method) && context.req.path.startsWith("/api/")) {
      const refusal = writeRefusal(context);
      if (refusal !== null) return problem(refusal);
    }
    return await next();
  });

  // ---- Session --------------------------------------------------------------------------------

  application.get("/session", async (context) => {
    const viewer = context.var.viewer;
    if (viewer === null) {
      return json({
        signedIn: context.var.signedInUserId !== null,
        canWrite: false,
        boardState: context.var.boardState,
        signInUrl: signInUrl(context),
        profile: null,
      });
    }
    const profile = await getProfile(context.env.DB_CONTROL, viewer.member.userId);
    return json({
      signedIn: true,
      canWrite: context.var.boardState === "open",
      boardState: context.var.boardState,
      signInUrl: signInUrl(context),
      profile: {
        displayName: profile?.displayName ?? null,
        suggestedDisplayName: viewer.suggestedDisplayName,
        approved: profile?.approvedAt != null,
        noticeDismissed: profile?.noticeDismissedAt != null,
        isTeam: viewer.member.isTeam,
      },
    });
  });

  // The app sends a signed-in person here with a one-minute, one-use token. A token that fails any
  // check lands them on the board signed out, with a note the page can show; it never says which
  // check failed.
  application.get("/session/begin", async (context) => {
    const secret = context.env.COMMUNITY_HANDOFF_SECRET;
    const token = context.req.query("token");
    const fail = (): Response =>
      new Response(null, {
        status: 303,
        headers: { Location: "/?sign-in=expired", "Cache-Control": "no-store" },
      });
    if (secret === undefined || token === undefined) return fail();
    const claim = await verifyHandoffToken(secret, token, nowSeconds());
    if (claim === null) return fail();
    if (!(await redeemHandoff(context.env.DB_CONTROL, claim, nowInstant()))) return fail();
    setCookie(context, SESSION_COOKIE, await mintSessionToken(secret, claim.userId, nowSeconds()), {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      maxAge: SESSION_LIFETIME_SECONDS,
      prefix: "host",
    });
    context.header("Cache-Control", "no-store");
    return context.redirect("/", 303);
  });

  application.post("/session/end", (context) => {
    if (context.req.header("Origin") !== new URL(context.req.url).origin) {
      return problem("cross-site-request");
    }
    deleteCookie(context, SESSION_COOKIE, { path: "/", secure: true, prefix: "host" });
    context.header("Cache-Control", "no-store");
    return context.json({});
  });

  // ---- Reading --------------------------------------------------------------------------------

  application.get("/api/board", async (context) => {
    const url = new URL(context.req.url);
    const status = url.searchParams.getAll("status");
    const parsed = boardListQuerySchema.safeParse({
      ...Object.fromEntries(url.searchParams),
      status: status.length === 0 ? undefined : status,
    });
    if (!parsed.success) return problem("invalid-request");
    const query = parsed.data;
    return json(
      await listBoard(
        context.env.DB_CONTROL,
        {
          kind: query.kind,
          category: query.category,
          statuses: query.status as PostStatus[] | undefined,
          search: query.search,
          sort: query.sort,
          limit: query.limit,
          offset: query.offset,
        },
        context.var.viewer?.member,
        nowInstant(),
      ),
    );
  });

  application.get("/api/summary", async (context) =>
    json(await readBoardSummary(context.env.DB_CONTROL)),
  );

  application.get("/api/posts/:number", async (context) => {
    const number = postNumber(context);
    if (number === null) return problem("post-not-found");
    return fromResult(
      await readPost(context.env.DB_CONTROL, number, context.var.viewer?.member),
      (value) => value,
    );
  });

  // The team's queue: everything held for review or hidden by reports, with what the reports say.
  // A reader who is not on the team gets the same refusal whether signed in or not.
  application.get("/api/moderation-queue", async (context) => {
    const viewer = context.var.viewer;
    if (viewer === null) return problem("not-team");
    return fromResult(
      await readModerationQueue(context.env.DB_CONTROL, viewer.member),
      (value) => value,
    );
  });

  // ---- Writing (the guard above has already passed) -------------------------------------------

  const member = (context: BoardContext) => {
    const viewer = context.var.viewer;
    if (viewer === null) throw new Error("a write reached its route without a member");
    return viewer.member;
  };

  application.post("/api/check-text", async (context) => {
    const body = await parseBody(context, checkTextRequestSchema);
    if (body === null) return problem("invalid-request");
    return json({ findings: detectConfidentialDetail(body.text) });
  });

  application.put("/api/profile", async (context) => {
    const body = await parseBody(context, saveProfileRequestSchema);
    if (body === null) return problem("invalid-request");
    await saveDisplayName(
      context.env.DB_CONTROL,
      member(context).userId,
      body.displayName,
      nowInstant(),
    );
    return json({ displayName: body.displayName.trim() });
  });

  application.post("/api/profile/notice-dismissed", async (context) => {
    await dismissConfidentialityNotice(
      context.env.DB_CONTROL,
      member(context).userId,
      nowInstant(),
    );
    return json({});
  });

  application.post("/api/posts", async (context) => {
    const body = await parseBody(context, createPostRequestSchema);
    if (body === null) return problem("invalid-request");
    const result = await createPost(context.env.DB_CONTROL, member(context), body, nowInstant());
    return result.ok ? json(result.value, 201) : problem(result.refusal);
  });

  for (const [method, cast] of [
    ["post", true],
    ["delete", false],
  ] as const) {
    application[method]("/api/posts/:number/vote", async (context) => {
      const number = postNumber(context);
      if (number === null) return problem("post-not-found");
      return fromResult(
        await vote(context.env.DB_CONTROL, member(context), number, cast, nowInstant()),
        (value) => value,
      );
    });
  }

  application.post("/api/posts/:number/comments", async (context) => {
    const number = postNumber(context);
    if (number === null) return problem("post-not-found");
    const body = await parseBody(context, createCommentRequestSchema);
    if (body === null) return problem("invalid-request");
    const result = await addComment(
      context.env.DB_CONTROL,
      member(context),
      number,
      body.body,
      nowInstant(),
    );
    return result.ok ? json(result.value, 201) : problem(result.refusal);
  });

  application.delete("/api/posts/:number", async (context) => {
    const number = postNumber(context);
    if (number === null) return problem("post-not-found");
    const result = await deleteOwnPost(
      context.env.DB_CONTROL,
      member(context),
      number,
      nowInstant(),
    );
    return result.ok ? json({}) : problem(result.refusal);
  });

  application.delete("/api/comments/:id", async (context) => {
    const result = await deleteOwnComment(
      context.env.DB_CONTROL,
      member(context),
      context.req.param("id") as CommunityCommentId,
      nowInstant(),
    );
    return result.ok ? json({}) : problem(result.refusal);
  });

  application.post("/api/posts/:number/flag", async (context) => {
    const number = postNumber(context);
    if (number === null) return problem("post-not-found");
    const body = await parseBody(context, flagRequestSchema);
    if (body === null) return problem("invalid-request");
    return fromResult(
      await flag(
        context.env.DB_CONTROL,
        member(context),
        {
          number,
          commentId: body.commentId as CommunityCommentId | undefined,
          reason: body.reason,
        },
        nowInstant(),
      ),
      (value) => value,
    );
  });

  // ---- The team's triage and moderation (the board service refuses anyone else) ---------------

  application.post("/api/posts/:number/status", async (context) => {
    const number = postNumber(context);
    if (number === null) return problem("post-not-found");
    const body = await parseBody(context, setStatusRequestSchema);
    if (body === null) return problem("invalid-request");
    const result = await setStatus(
      context.env.DB_CONTROL,
      member(context),
      number,
      body,
      nowInstant(),
    );
    return result.ok ? json({}) : problem(result.refusal);
  });

  application.post("/api/posts/:number/accept-answer", async (context) => {
    const number = postNumber(context);
    if (number === null) return problem("post-not-found");
    const body = await parseBody(context, acceptAnswerRequestSchema);
    if (body === null) return problem("invalid-request");
    const result = await acceptAnswer(
      context.env.DB_CONTROL,
      member(context),
      number,
      body.commentId as CommunityCommentId | null,
      nowInstant(),
    );
    return result.ok ? json({}) : problem(result.refusal);
  });

  application.post("/api/posts/:number/moderate", async (context) => {
    const number = postNumber(context);
    if (number === null) return problem("post-not-found");
    const body = await parseBody(context, moderateRequestSchema);
    if (body === null) return problem("invalid-request");
    const result = await moderate(
      context.env.DB_CONTROL,
      member(context),
      { number, commentId: body.commentId as CommunityCommentId | undefined },
      body.decision,
      nowInstant(),
    );
    return result.ok ? json({}) : problem(result.refusal);
  });

  return application;
}
