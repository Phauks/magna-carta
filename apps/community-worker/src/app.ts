import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import type {
  CommunityCommentId,
  CommunityPostId,
  CommunityProfileId,
} from "@magna-carta/identifiers/types";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  readBoardAvailability,
  type ReadOnlyKeyValueStore,
} from "@magna-carta/community/availability";
import { CATEGORIES, CATEGORY_LABELS, isCategory } from "@magna-carta/community/categories";
import {
  ATTACHMENTS_UNAVAILABLE_NOTICE,
  COMPOSER_VENUE_NOTICE,
  FIRST_POST_NOTICE,
  SEND_TO_SUPPORT_LABEL,
} from "@magna-carta/community/posting-notice";
import {
  boardNoticesSchema,
  categoryListSchema,
  commentListSchema,
  createCommentRequestSchema,
  createPostRequestSchema,
  editPostRequestSchema,
  flagRequestSchema,
  listPostsQuerySchema,
  mergeDuplicateRequestSchema,
  moderationRequestSchema,
  postListSchema,
  profileRequestSchema,
  publicPostSchema,
  setStatusRequestSchema,
} from "@magna-carta/community/contract";
import { publicComment, publicPost } from "@magna-carta/community/projection";
import type { BatchSqlDatabase } from "@magna-carta/community/sql";
import { ROADMAP_STATUSES, TRIAGE_DUE_DAYS } from "@magna-carta/community/types";
import {
  acceptAnswerStatement,
  archiveStalePostsStatement,
  authorEditPostStatement,
  carryVotesToDuplicateTargetStatement,
  convertQuestionToRequestStatement,
  hidePostStatement,
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
  type StoredPostRow,
} from "@magna-carta/community/post-statements";
import {
  listCommentsStatement,
  publishCommentStatement,
  type StoredCommentRow,
} from "@magna-carta/community/comment-statements";
import {
  listOpenFlagsStatement,
  resolveFlagsForSubjectStatement,
} from "@magna-carta/community/flag-statements";
import { insertModerationActionStatement } from "@magna-carta/community/moderation-statements";
import { createBoardService, type BoardService } from "./board-service.ts";
import { problemJson } from "./problem.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { boardRoute, boardRouteMetaOf, type BoardRouteMeta } from "./route-meta.ts";
import { controlPlaneSessionPort, type BoardSession, type SessionPort } from "./session.ts";

// The whole binding surface. Two entries, and that is the confidentiality boundary — see the
// reasoning in wrangler.jsonc, which is the one home for it.
export interface Bindings {
  readonly DB_CONTROL: D1Database;
  readonly COMMUNITY_KV: KVNamespace;
  readonly AUTH_SECRET?: string;
}

export interface AppOverrides {
  readonly sessionPort?: SessionPort;
  readonly now?: () => string;
  readonly rateLimiter?: RateLimiter;
}

const PAGE_LIMIT_CEILING = 50;
const COMMENT_PAGE_LIMIT = 200;
const MODERATION_QUEUE_LIMIT = 100;
const MILLISECONDS_PER_DAY = 86_400_000;

// The board is publicly readable and permanently unindexed, and the second half is not a
// preference. A public voter list on the reference product is findable by a web search today; that
// is the demonstration of what indexing a board of this kind does, and it cannot be undone once a
// crawler has it. A prospect who follows a link still sees everything.
const BOARD_HEADERS: Readonly<Record<string, string>> = {
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

interface StoredOperatorRow {
  readonly user_id: string;
  readonly expires_at: string | null;
}

function encodeCursor(row: { created_at: string; number: number }): string {
  return btoa(`${row.created_at}|${row.number}`).replace(/=+$/, "");
}

function decodeCursor(cursor: string): { createdAt: string; number: number } | null {
  try {
    const [createdAt, number] = atob(cursor).split("|");
    if (createdAt === undefined || number === undefined) return null;
    const parsed = Number.parseInt(number, 10);
    return Number.isNaN(parsed) ? null : { createdAt, number: parsed };
  } catch {
    return null;
  }
}

function toPublicPost(row: StoredPostRow) {
  return publicPost({
    number: row.number,
    slug: row.slug,
    kind: row.kind as "request" | "question",
    category: row.category as (typeof CATEGORIES)[number],
    title: row.title,
    body: row.body,
    status: row.status as never,
    declineReason: row.decline_reason as never,
    declineNote: row.decline_note,
    duplicateOfNumber: row.duplicate_of_number,
    voteCount: row.vote_count,
    distinctFirmVoteCount: row.distinct_firm_vote_count,
    commentCount: row.comment_count,
    acceptedCommentReference: row.accepted_comment_id,
    visibility: row.visibility as never,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    author: {
      id: row.author_id as CommunityProfileId,
      displayName: row.author_display_name,
      badge: row.author_badge as "none" | "staff",
    },
  });
}

function toPublicComment(row: StoredCommentRow) {
  return publicComment({
    reference: row.id,
    body: row.body,
    isOperatorResponse: row.is_operator_response !== 0,
    visibility: row.visibility as never,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.author_id as CommunityProfileId,
      displayName: row.author_display_name,
      badge: row.author_badge as "none" | "staff",
    },
  });
}

export function createApp(env: Bindings, overrides: AppOverrides = {}) {
  const database = env.DB_CONTROL as unknown as BatchSqlDatabase;
  const now = overrides.now ?? (() => new Date().toISOString());
  const sessionPort =
    overrides.sessionPort ?? controlPlaneSessionPort(database, () => Date.parse(now()));
  const rateLimiter = overrides.rateLimiter ?? createRateLimiter(() => Date.parse(now()));
  const service = createBoardService({ database, now });

  const app = new OpenAPIHono<{
    Bindings: Bindings;
    Variables: { session: BoardSession | null; service: BoardService };
  }>({
    // A validation failure answers in the platform's error shape rather than the library's, so a
    // client parses one thing whichever surface refused it.
    defaultHook: (result, c) => {
      if (result.success) return;
      return problemJson(c, {
        type: "validation",
        status: 422,
        title: "Invalid request",
        detail: "The request did not match the contract for this endpoint.",
        errors: result.error.issues.map((issue) => ({
          path: issue.path.length === 0 ? "$" : issue.path.join("."),
          code: issue.code,
          detail: issue.message,
        })),
      });
    },
  });

  // Every response, including every error, carries the board's headers.
  app.use("*", async (c, next) => {
    await next();
    for (const [header, value] of Object.entries(BOARD_HEADERS)) c.res.headers.set(header, value);
  });

  async function isOperator(session: BoardSession): Promise<boolean> {
    const row = await database
      .prepare(`SELECT user_id, expires_at FROM platform_operator WHERE user_id = ?1`)
      .bind(session.userId)
      .first<StoredOperatorRow>();
    if (row === null) return false;
    return row.expires_at === null || Date.parse(row.expires_at) > Date.parse(now());
  }

  // THE ORDERED GATE. One place, one order, and the order is the contract:
  //
  //   1. kill switch  — an operator can stop every write in seconds with no deploy, and this is
  //                     first so nothing downstream can be reached during an incident.
  //   2. session      — no valid session on a write route is a 401.
  //   3. write bar    — a barred account, or an unverified one, may read and not write.
  //   4. operator     — the platform axis, checked only where declared.
  //   5. rate limit   — spent per account AND per firm, so a firm cannot pool its seats.
  //
  // A request failing an earlier gate never reaches a later one.
  function gate(meta: BoardRouteMeta): MiddlewareHandler {
    return async (c, next) => {
      const writes = meta.rateLimitBucket !== null;
      if (writes) {
        const availability = await readBoardAvailability(
          env.COMMUNITY_KV as unknown as ReadOnlyKeyValueStore,
        );
        if (!availability.writesAccepted) {
          return problemJson(c, {
            type: "community-board-read-only",
            status: 503,
            title: "The board is read only",
            detail: "New posts, comments and votes are paused. Everything already here is intact.",
            ...(availability.refusalNotice === undefined
              ? {}
              : { refusalNotice: availability.refusalNotice }),
          });
        }
      }

      let session: BoardSession | null = null;
      if (meta.access !== "public") {
        session = await sessionPort.resolve(c);
        if (session === null) {
          return problemJson(c, {
            type: "unauthenticated",
            status: 401,
            title: "Sign in to take part",
            detail: "The board is public to read. Writing needs an account at a provisioned firm.",
          });
        }
        if (!session.emailVerified) {
          return problemJson(c, {
            type: "community-write-refused",
            status: 403,
            title: "Confirm your email address first",
            detail: "Writing to the board needs a confirmed account.",
          });
        }
        const profile = await service.profileFor(session);
        if (profile.writeBarredAt !== null) {
          return problemJson(c, {
            type: "community-write-refused",
            status: 403,
            title: "This account cannot write to the board",
            detail: "Reading is unaffected. Support can tell you more.",
          });
        }
        if (meta.access === "operator" && !(await isOperator(session))) {
          // A 404 rather than a 403: the moderation surface should not confirm its own existence to
          // an ordinary member probing for it.
          return problemJson(c, { type: "not-found", status: 404, title: "Not found" });
        }
      } else {
        // A read may still be made by a signed-in member, and one fact about them rides the
        // response: whether they have voted. Nothing else about a reader is read or returned.
        session = await sessionPort.resolve(c);
      }

      // The write budget is a member's budget. An operator's moderation actions are deliberately
      // not metered: the moment an operator most needs to act — a spam run, a thread going wrong,
      // a disclosure being reported repeatedly — is exactly the moment a member-sized budget would
      // stop them, and the gate in front of these routes is already the platform-operator record.
      if (meta.rateLimitBucket !== null && meta.access !== "operator" && session !== null) {
        for (const key of [`user:${session.userId}`, `firm:${session.firmId}`]) {
          const verdict = rateLimiter.check(meta.rateLimitBucket, key);
          if (!verdict.allowed) {
            const response = problemJson(c, {
              type: "rate-limited",
              status: 429,
              title: "Too many writes",
              detail: "Wait for the interval in the Retry-After header and try again.",
              retryAfterSeconds: verdict.retryAfterSeconds,
            });
            response.headers.set("retry-after", String(verdict.retryAfterSeconds));
            return response;
          }
        }
      }

      c.set("session", session);
      c.set("service", service);
      await next();
    };
  }

  // Registration goes through one function so a route cannot reach the application without its
  // gate. `registered` is what the isolation test counts, so a route added outside this path shows
  // up as a discrepancy rather than as a quietly ungated endpoint.
  const registered: BoardRouteMeta[] = [];
  function register(route: Parameters<typeof app.openapi>[0], handler: never): void {
    const meta = boardRouteMetaOf(route);
    if (meta === undefined) {
      throw new Error(
        `A community route was registered without its metadata — define it with boardRoute so the ` +
          `gate knows who may call it.`,
      );
    }
    registered.push(meta);
    app.openapi({ ...route, middleware: [gate(meta)] } as never, handler);
  }

  const numberParam = z.object({ number: z.coerce.number().int().positive() });
  const referenceParam = z.object({ reference: z.string().min(1) });
  const jsonOk = <T extends z.ZodType>(schema: T, description: string) => ({
    200: { description, content: { "application/json": { schema } } },
  });
  const notFound = {
    404: {
      description: "No such post, comment or profile on this board.",
      content: { "application/problem+json": { schema: z.object({}).passthrough() } },
    },
  } as const;

  // ---------------------------------------------------------------- public reads

  register(
    boardRoute(
      { operationId: "community.listCategories", access: "public", rateLimitBucket: null },
      {
        method: "get",
        path: "/api/v1/community/categories",
        description:
          "The board's categories. Every one is a product area, and a post must name one before it can be created.",
        responses: jsonOk(categoryListSchema, "The category list."),
      },
    ),
    ((c: Context) =>
      c.json({
        data: CATEGORIES.map((key) => ({ key, label: CATEGORY_LABELS[key] })),
      })) as never,
  );

  register(
    boardRoute(
      { operationId: "community.notices", access: "public", rateLimitBucket: null },
      {
        method: "get",
        path: "/api/v1/community/notices",
        description:
          "The standing copy a composer shows: the first-post notice, the venue statement, and why attachments are unavailable.",
        responses: jsonOk(boardNoticesSchema, "The composer's standing copy."),
      },
    ),
    ((c: Context) =>
      c.json({
        firstPostNotice: FIRST_POST_NOTICE,
        composerVenueNotice: COMPOSER_VENUE_NOTICE,
        sendToSupportLabel: SEND_TO_SUPPORT_LABEL,
        attachmentsUnavailableNotice: ATTACHMENTS_UNAVAILABLE_NOTICE,
        attachmentsEnabled: false,
      })) as never,
  );

  register(
    boardRoute(
      { operationId: "community.listPosts", access: "public", rateLimitBucket: null },
      {
        method: "get",
        path: "/api/v1/community/posts",
        description:
          "Published posts, filtered by kind, category and status, ordered by trending, top or new. Cursor paged.",
        request: { query: listPostsQuerySchema },
        responses: jsonOk(postListSchema, "A page of posts."),
      },
    ),
    (async (c: Context) => {
      const query = listPostsQuerySchema.parse(c.req.query());
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      if (query.cursor !== undefined && cursor === null) {
        return problemJson(c, {
          type: "validation",
          status: 422,
          title: "Invalid cursor",
          detail: "The cursor did not come from a previous page of this list.",
        });
      }
      const limit = Math.min(query.limit, PAGE_LIMIT_CEILING);
      const listed = await listPostsStatement(database, {
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.status === undefined ? {} : { status: query.status }),
        sort: query.sort,
        limit: limit + 1,
        ...(cursor === undefined || cursor === null ? {} : { cursor }),
        now: now(),
      }).all<StoredPostRow>();
      const page = listed.results.slice(0, limit);
      const hasMore = listed.results.length > limit;
      const last = page.at(-1);
      return c.json({
        data: page.map(toPublicPost),
        nextCursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      });
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.getPost", access: "public", rateLimitBucket: null },
      {
        method: "get",
        path: "/api/v1/community/posts/{number}",
        description: "One post by its permanent number.",
        request: { params: numberParam },
        responses: { ...jsonOk(publicPostSchema, "The post."), ...notFound },
      },
    ),
    (async (c: Context) => {
      const number = Number(c.req.param("number"));
      const row = await selectPostByNumberStatement(database, number).first<StoredPostRow>();
      // A hidden post is absent, and so is a removed or deleted one. There is no placeholder,
      // because a marker over a suspected disclosure is a sign pointing at the interesting part
      // of it — the title, the category and the author are all still attached to the marker.
      if (row === null || row.visibility !== "published") {
        return problemJson(c, { type: "not-found", status: 404, title: "No such post" });
      }
      return c.json(toPublicPost(row));
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.listComments", access: "public", rateLimitBucket: null },
      {
        method: "get",
        path: "/api/v1/community/posts/{number}/comments",
        description: "A post's thread, oldest first.",
        request: { params: numberParam },
        responses: { ...jsonOk(commentListSchema, "The thread."), ...notFound },
      },
    ),
    (async (c: Context) => {
      const post = await service.postIdentity(Number(c.req.param("number")));
      if (post === null || post.visibility !== "published") {
        return problemJson(c, { type: "not-found", status: 404, title: "No such post" });
      }
      const listed = await listCommentsStatement(database, {
        postId: post.id,
        limit: COMMENT_PAGE_LIMIT,
      }).all<StoredCommentRow>();
      return c.json({ data: listed.results.map(toPublicComment) });
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.roadmap", access: "public", rateLimitBucket: null },
      {
        method: "get",
        path: "/api/v1/community/roadmap",
        description:
          "The public roadmap: requests grouped by the statuses that put them on it. A projection of the board, never a second store, and it carries no dates.",
        responses: jsonOk(
          z.object({
            columns: z.array(
              z.object({ status: z.string(), data: z.array(publicPostSchema) }).strict(),
            ),
          }),
          "The roadmap columns.",
        ),
      },
    ),
    (async (c: Context) => {
      // No target dates anywhere, because there is no column to hold one. A card moving backwards
      // is a normal event on a roadmap and a date would turn it into a broken promise.
      const columns = [];
      for (const status of ROADMAP_STATUSES) {
        const listed = await listPostsStatement(database, {
          kind: "request",
          status,
          sort: "top",
          limit: PAGE_LIMIT_CEILING,
          now: now(),
        }).all<StoredPostRow>();
        columns.push({ status, data: listed.results.map(toPublicPost) });
      }
      return c.json({ columns });
    }) as never,
  );

  // ---------------------------------------------------------------- member writes

  register(
    boardRoute(
      { operationId: "community.setProfile", access: "member", rateLimitBucket: "profile" },
      {
        method: "put",
        path: "/api/v1/community/me",
        description:
          "Set the display name shown on the board, and whether it is a handle rather than the member's own name. An account-level choice, never a per-post one.",
        request: { body: { content: { "application/json": { schema: profileRequestSchema } } } },
        responses: jsonOk(
          z.object({ displayName: z.string(), isPseudonym: z.boolean() }).strict(),
          "The board identity.",
        ),
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const body = profileRequestSchema.parse(await c.req.json());
      const profile = await service.profileFor(session);
      const { updateProfileDisplayNameStatement } =
        await import("@magna-carta/community/profile-statements");
      await updateProfileDisplayNameStatement(database, {
        userId: session.userId,
        displayName: body.displayName,
        isPseudonym: body.isPseudonym,
        now: now(),
      }).run();
      void profile;
      return c.json({ displayName: body.displayName, isPseudonym: body.isPseudonym });
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.createPost", access: "member", rateLimitBucket: "post" },
      {
        method: "post",
        path: "/api/v1/community/posts",
        description:
          "Create a request or a question. A category is required. A post that carries a signal the content check recognises, and a brand-new account's first post, are accepted and held rather than published.",
        request: { body: { content: { "application/json": { schema: createPostRequestSchema } } } },
        responses: {
          201: {
            description: "Published.",
            content: {
              "application/json": {
                schema: z.object({ number: z.number(), slug: z.string() }).strict(),
              },
            },
          },
          202: {
            description: "Accepted and held until it is reviewed.",
            content: {
              "application/json": {
                schema: z
                  .object({
                    number: z.number(),
                    slug: z.string(),
                    heldReason: z.string(),
                    signals: z.array(z.string()),
                  })
                  .strict(),
              },
            },
          },
        },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const body = createPostRequestSchema.parse(await c.req.json());
      if (!isCategory(body.category)) {
        return problemJson(c, {
          type: "validation",
          status: 422,
          title: "Unknown category",
          detail: "Choose the part of the software this is about.",
        });
      }
      const outcome = await service.createPost(session, body);
      if (outcome.kind === "published") {
        return c.json({ number: outcome.number, slug: outcome.slug }, 201);
      }
      return c.json(
        {
          number: outcome.number,
          slug: outcome.slug,
          heldReason: outcome.reason,
          // The signal NAMES, so a member can see what tripped it and fix their own post. Never
          // the matched text: repeating it would copy the thing being withheld into a reply.
          signals: outcome.findings.map((finding) => finding.signal),
        },
        202,
      );
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.editPost", access: "member", rateLimitBucket: "post" },
      {
        method: "patch",
        path: "/api/v1/community/posts/{number}",
        description:
          "Rewrite one's own post. No previous version is kept anywhere: a member who realises their post said too much must be able to make the original unreadable.",
        request: {
          params: numberParam,
          body: { content: { "application/json": { schema: editPostRequestSchema } } },
        },
        responses: { 204: { description: "Rewritten." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const body = editPostRequestSchema.parse(await c.req.json());
      const post = await service.postIdentity(Number(c.req.param("number")));
      if (post === null) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such post" });
      }
      const result = await authorEditPostStatement(database, {
        postId: post.id,
        authorUserId: session.userId,
        title: body.title,
        body: body.body,
        now: now(),
      }).run();
      if (result.meta.changes === 0) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such post" });
      }
      return c.body(null, 204);
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.deletePost", access: "member", rateLimitBucket: "post" },
      {
        method: "delete",
        path: "/api/v1/community/posts/{number}",
        description:
          "Delete one's own post. One write, no queue and no operator: the words are gone when this returns.",
        request: { params: numberParam },
        responses: { 204: { description: "Deleted." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const post = await service.postIdentity(Number(c.req.param("number")));
      if (post === null || !(await service.deleteOwnPost(session, post))) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such post" });
      }
      return c.body(null, 204);
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.vote", access: "member", rateLimitBucket: "vote" },
      {
        method: "post",
        path: "/api/v1/community/posts/{number}/vote",
        description:
          "Vote for a request. One account, one vote; a second is a no-op rather than an error.",
        request: { params: numberParam },
        responses: { 204: { description: "Counted." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const post = await service.postIdentity(Number(c.req.param("number")));
      if (post === null || post.visibility !== "published" || post.kind !== "request") {
        return problemJson(c, { type: "not-found", status: 404, title: "No such request" });
      }
      await service.vote(session, post);
      return c.body(null, 204);
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.withdrawVote", access: "member", rateLimitBucket: "vote" },
      {
        method: "delete",
        path: "/api/v1/community/posts/{number}/vote",
        description: "Withdraw one's own vote.",
        request: { params: numberParam },
        responses: { 204: { description: "Withdrawn." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const post = await service.postIdentity(Number(c.req.param("number")));
      if (post === null) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such request" });
      }
      await service.withdrawVote(session, post);
      return c.body(null, 204);
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.comment", access: "member", rateLimitBucket: "comment" },
      {
        method: "post",
        path: "/api/v1/community/posts/{number}/comments",
        description: "Reply on a post. On a question these are the answers.",
        request: {
          params: numberParam,
          body: { content: { "application/json": { schema: createCommentRequestSchema } } },
        },
        responses: {
          201: {
            description: "Published.",
            content: {
              "application/json": { schema: z.object({ reference: z.string() }).strict() },
            },
          },
          202: {
            description: "Accepted and held until it is reviewed.",
            content: {
              "application/json": { schema: z.object({ reference: z.string() }).strict() },
            },
          },
          ...notFound,
        },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const body = createCommentRequestSchema.parse(await c.req.json());
      const post = await service.postIdentity(Number(c.req.param("number")));
      if (post === null || post.visibility !== "published") {
        return problemJson(c, { type: "not-found", status: 404, title: "No such post" });
      }
      const outcome = await service.comment(session, post, body.body);
      return c.json({ reference: outcome.reference }, outcome.held ? 202 : 201);
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.deleteComment", access: "member", rateLimitBucket: "comment" },
      {
        method: "delete",
        path: "/api/v1/community/comments/{reference}",
        description: "Delete one's own reply. The same single erasing write a post gets.",
        request: { params: referenceParam },
        responses: { 204: { description: "Deleted." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const deleted = await service.deleteOwnComment(
        session,
        c.req.param("reference") as CommunityCommentId,
      );
      if (!deleted) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such reply" });
      }
      return c.body(null, 204);
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.acceptAnswer", access: "member", rateLimitBucket: "comment" },
      {
        method: "post",
        path: "/api/v1/community/posts/{number}/accepted-answer",
        description:
          "Mark a reply as the answer to one's own question. The question then floats to the top of its category.",
        request: {
          params: numberParam,
          body: {
            content: {
              "application/json": { schema: z.object({ reference: z.string() }).strict() },
            },
          },
        },
        responses: { 204: { description: "Accepted." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const body = z
        .object({ reference: z.string() })
        .strict()
        .parse(await c.req.json());
      const post = await service.postIdentity(Number(c.req.param("number")));
      if (post === null) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such question" });
      }
      const result = await acceptAnswerStatement(database, {
        postId: post.id,
        commentId: body.reference as CommunityCommentId,
        authorUserId: session.userId,
        now: now(),
      }).run();
      if (result.meta.changes === 0) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such question" });
      }
      return c.body(null, 204);
    }) as never,
  );

  for (const subject of ["post", "comment"] as const) {
    register(
      boardRoute(
        {
          operationId: subject === "post" ? "community.reportPost" : "community.reportComment",
          access: "member",
          rateLimitBucket: "report",
        },
        {
          method: "post",
          path:
            subject === "post"
              ? "/api/v1/community/posts/{number}/reports"
              : "/api/v1/community/comments/{reference}/reports",
          description:
            "Report something. A confidentiality report hides its subject immediately, on one report from any signed-in reader. A spam or abuse report is counted and hides nothing until several separate firms have raised one.",
          request: {
            params: subject === "post" ? numberParam : referenceParam,
            body: { content: { "application/json": { schema: flagRequestSchema } } },
          },
          responses: {
            ...jsonOk(
              z.object({ hidden: z.boolean() }).strict(),
              "Whether the subject is now hidden.",
            ),
            ...notFound,
          },
        },
      ),
      (async (c: Context) => {
        const session = c.get("session") as BoardSession;
        const body = flagRequestSchema.parse(await c.req.json());
        let subjectId: string;
        if (subject === "post") {
          const post = await service.postIdentity(Number(c.req.param("number")));
          if (post === null) {
            return problemJson(c, { type: "not-found", status: 404, title: "No such post" });
          }
          subjectId = post.id;
        } else {
          const reference = c.req.param("reference");
          if (reference === undefined || reference === "") {
            return problemJson(c, { type: "not-found", status: 404, title: "No such reply" });
          }
          subjectId = reference;
        }
        const outcome = await service.report(
          session,
          { kind: subject, id: subjectId },
          { reason: body.reason, note: body.note ?? null },
        );
        return c.json(outcome);
      }) as never,
    );
  }

  // ---------------------------------------------------------------- operator moderation

  register(
    boardRoute(
      { operationId: "community.moderationQueue", access: "operator", rateLimitBucket: null },
      {
        method: "get",
        path: "/api/v1/community/moderation/queue",
        description:
          "What is waiting: open reports with confidentiality first, and requests that have sat past the triage window with no status.",
        responses: jsonOk(
          z
            .object({
              reports: z.array(
                z
                  .object({
                    reference: z.string(),
                    subjectKind: z.string(),
                    subjectReference: z.string(),
                    reason: z.string(),
                    note: z.string().nullable(),
                    createdAt: z.string(),
                  })
                  .strict(),
              ),
              untriagedRequests: z.array(publicPostSchema),
            })
            .strict(),
          "The queue.",
        ),
      },
    ),
    (async (c: Context) => {
      const flags = await listOpenFlagsStatement(database, MODERATION_QUEUE_LIMIT).all<{
        id: string;
        subject_kind: string;
        subject_id: string;
        reason: string;
        note: string | null;
        created_at: string;
      }>();
      const cutoff = new Date(
        Date.parse(now()) - TRIAGE_DUE_DAYS * MILLISECONDS_PER_DAY,
      ).toISOString();
      const untriaged = await listUntriagedRequestsStatement(
        database,
        cutoff,
        MODERATION_QUEUE_LIMIT,
      ).all<StoredPostRow>();
      return c.json({
        reports: flags.results.map((flag) => ({
          reference: flag.id,
          subjectKind: flag.subject_kind,
          subjectReference: flag.subject_id,
          reason: flag.reason,
          note: flag.note,
          createdAt: flag.created_at,
        })),
        untriagedRequests: untriaged.results.map(toPublicPost),
      });
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.setStatus", access: "operator", rateLimitBucket: "post" },
      {
        method: "post",
        path: "/api/v1/community/posts/{number}/status",
        description:
          "Move a request along the pipeline. Declining requires a reason from the closed set and a note, because a status used to end a conversation rather than to describe reality teaches readers to distrust every other status.",
        request: {
          params: numberParam,
          body: { content: { "application/json": { schema: setStatusRequestSchema } } },
        },
        responses: { 204: { description: "Moved." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const body = setStatusRequestSchema.parse(await c.req.json());
      if (
        body.status === "not_on_the_roadmap" &&
        (body.declineReason === undefined || body.declineNote === undefined)
      ) {
        return problemJson(c, {
          type: "validation",
          status: 422,
          title: "Declining needs a reason",
          detail: "A declined request carries a reason from the closed set and a note saying why.",
        });
      }
      const post = await service.postIdentity(Number(c.req.param("number")));
      if (post === null) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such request" });
      }
      const instant = now();
      const result = await setPostStatusStatement(database, {
        postId: post.id,
        status: body.status,
        declineReason: body.declineReason ?? null,
        declineNote: body.declineNote ?? null,
        now: instant,
      }).run();
      if (result.meta.changes === 0) {
        // A question has no pipeline, so this is not a request and there is nothing to move.
        return problemJson(c, { type: "not-found", status: 404, title: "No such request" });
      }
      await insertModerationActionStatement(database, {
        id: newIdentifier("communityModerationAction") as never,
        subjectKind: "post",
        subjectId: post.id,
        action: "status_changed",
        actorUserId: session.userId,
        reason: body.status,
        note: body.declineNote ?? null,
        now: instant,
      }).run();
      return c.body(null, 204);
    }) as never,
  );

  for (const action of ["hide", "restore", "remove"] as const) {
    register(
      boardRoute(
        {
          operationId: `community.${action}Post`,
          access: "operator",
          rateLimitBucket: "post",
        },
        {
          method: "post",
          path: `/api/v1/community/posts/{number}/${action}`,
          description:
            action === "hide"
              ? "Hide a post pending review. Reversible, and the half of remove-first that makes remove-first affordable is the restore beside it."
              : action === "restore"
                ? "Put a hidden post back. Only a hidden post can be restored; one an author deleted has no words left."
                : "Remove a post permanently, erasing its words. A removal that leaves the text in place has not removed the thing that mattered.",
          request: {
            params: numberParam,
            body: { content: { "application/json": { schema: moderationRequestSchema } } },
          },
          responses: { 204: { description: "Done." }, ...notFound },
        },
      ),
      (async (c: Context) => {
        const session = c.get("session") as BoardSession;
        const body = moderationRequestSchema.parse(await c.req.json().catch(() => ({})));
        const post = await service.postIdentity(Number(c.req.param("number")));
        if (post === null) {
          return problemJson(c, { type: "not-found", status: 404, title: "No such post" });
        }
        const instant = now();
        const statement =
          action === "hide"
            ? hidePostStatement(database, { postId: post.id, reason: "operator", now: instant })
            : action === "restore"
              ? restorePostStatement(database, post.id, instant)
              : removePostStatement(database, post.id, instant);
        const result = await statement.run();
        if (result.meta.changes === 0) {
          return problemJson(c, { type: "not-found", status: 404, title: "No such post" });
        }
        await database.batch([
          insertModerationActionStatement(database, {
            id: newIdentifier("communityModerationAction") as never,
            subjectKind: "post",
            subjectId: post.id,
            action: action === "hide" ? "hidden" : action === "restore" ? "restored" : "removed",
            actorUserId: session.userId,
            reason: null,
            note: body.note ?? null,
            now: instant,
          }),
          resolveFlagsForSubjectStatement(database, {
            subjectId: post.id,
            // Restoring clears the reports that hid the post; hiding or removing upholds them.
            // Recording which way a report went is what makes repeat false reporting visible on
            // the account that raised them.
            status: action === "restore" ? "cleared" : "upheld",
            resolvedByUserId: session.userId,
            now: instant,
          }),
        ]);
        return c.body(null, 204);
      }) as never,
    );
  }

  register(
    boardRoute(
      { operationId: "community.convertToRequest", access: "operator", rateLimitBucket: "post" },
      {
        method: "post",
        path: "/api/v1/community/posts/{number}/convert-to-request",
        description:
          "Turn a question that is really a missing capability into a request, carrying its whole thread with it.",
        request: { params: numberParam },
        responses: { 204: { description: "Converted." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const post = await service.postIdentity(Number(c.req.param("number")));
      if (post === null) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such question" });
      }
      const instant = now();
      const result = await convertQuestionToRequestStatement(database, {
        postId: post.id,
        status: "future",
        now: instant,
      }).run();
      if (result.meta.changes === 0) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such question" });
      }
      await insertModerationActionStatement(database, {
        id: newIdentifier("communityModerationAction") as never,
        subjectKind: "post",
        subjectId: post.id,
        action: "converted_to_request",
        actorUserId: session.userId,
        reason: null,
        note: null,
        now: instant,
      }).run();
      return c.body(null, 204);
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.mergeDuplicate", access: "operator", rateLimitBucket: "post" },
      {
        method: "post",
        path: "/api/v1/community/posts/{number}/merge",
        description:
          "Merge a request into the one it duplicates, carrying its votes across. A voter who had already voted for the target does not arrive twice.",
        request: {
          params: numberParam,
          body: { content: { "application/json": { schema: mergeDuplicateRequestSchema } } },
        },
        responses: { 204: { description: "Merged." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const body = mergeDuplicateRequestSchema.parse(await c.req.json());
      const post = await service.postIdentity(Number(c.req.param("number")));
      const target = await service.postIdentity(body.targetNumber);
      if (post === null || target === null || post.id === target.id) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such request" });
      }
      const instant = now();
      await database.batch([
        carryVotesToDuplicateTargetStatement(database, {
          postId: post.id,
          targetPostId: target.id,
        }),
        markDuplicateStatement(database, {
          postId: post.id,
          targetPostId: target.id,
          now: instant,
        }),
        recountPostVotesStatement(database, target.id),
        recountPostVotesStatement(database, post.id),
        insertModerationActionStatement(database, {
          id: newIdentifier("communityModerationAction") as never,
          subjectKind: "post",
          subjectId: post.id,
          action: "merged_as_duplicate",
          actorUserId: session.userId,
          reason: String(body.targetNumber),
          note: null,
          now: instant,
        }),
      ]);
      return c.body(null, 204);
    }) as never,
  );

  register(
    boardRoute(
      {
        operationId: "community.approveFirstWrite",
        access: "operator",
        rateLimitBucket: "profile",
      },
      {
        method: "post",
        path: "/api/v1/community/moderation/profiles/{reference}/approve",
        description:
          "Approve an account's first write. Everything it has waiting is published, and afterwards it writes freely.",
        request: { params: referenceParam },
        responses: { 204: { description: "Approved." }, ...notFound },
      },
    ),
    (async (c: Context) => {
      const session = c.get("session") as BoardSession;
      const profileId = c.req.param("reference") as CommunityProfileId;
      const approved = await service.approveFirstWrite(profileId);
      if (!approved) {
        return problemJson(c, { type: "not-found", status: 404, title: "No such profile" });
      }
      const instant = now();
      const held = await database
        .prepare(
          `SELECT id FROM community_post WHERE author_profile_id = ?1 AND visibility = 'pending_first_write_review'`,
        )
        .bind(profileId)
        .all<{ id: string }>();
      const heldComments = await database
        .prepare(
          `SELECT id, post_id FROM community_comment WHERE author_profile_id = ?1 AND visibility = 'pending_first_write_review'`,
        )
        .bind(profileId)
        .all<{ id: string; post_id: string }>();
      // A held comment does not count toward its post's thread until it is published, so the posts
      // it belongs to are recounted in the same batch. Missing this leaves a thread reading zero
      // with a reply visible underneath it.
      const touchedPosts = [...new Set(heldComments.results.map((row) => row.post_id))];
      await database.batch([
        ...held.results.map((row) =>
          publishPostStatement(database, row.id as CommunityPostId, instant),
        ),
        ...heldComments.results.map((row) =>
          publishCommentStatement(database, row.id as CommunityCommentId, instant),
        ),
        ...touchedPosts.map((postId) =>
          recountPostCommentsStatement(database, postId as CommunityPostId),
        ),
        insertModerationActionStatement(database, {
          id: newIdentifier("communityModerationAction") as never,
          subjectKind: "post",
          subjectId: profileId,
          action: "approved_first_write",
          actorUserId: session.userId,
          reason: null,
          note: null,
          now: instant,
        }),
      ]);
      return c.body(null, 204);
    }) as never,
  );

  register(
    boardRoute(
      { operationId: "community.archiveStale", access: "operator", rateLimitBucket: "post" },
      {
        method: "post",
        path: "/api/v1/community/moderation/archive-stale",
        description:
          "Archive requests with no activity for a year. Archived, never deleted: the words stay and the post stops competing for attention.",
        responses: jsonOk(z.object({ archived: z.number().int() }).strict(), "How many moved."),
      },
    ),
    (async (c: Context) => {
      const { ARCHIVE_AFTER_DAYS } = await import("@magna-carta/community/types");
      const instant = now();
      const cutoff = new Date(
        Date.parse(instant) - ARCHIVE_AFTER_DAYS * MILLISECONDS_PER_DAY,
      ).toISOString();
      const result = await archiveStalePostsStatement(database, cutoff, instant).run();
      return c.json({ archived: result.meta.changes });
    }) as never,
  );

  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Magna Carta community board",
      version: "1.0.0",
      description:
        "The community board: feature requests, questions, votes and moderation. Public to read, signed in to write.",
    },
    servers: [{ url: "https://community.magnacarta.esq" }],
  });

  return { app, registeredRoutes: registered as readonly BoardRouteMeta[] };
}
