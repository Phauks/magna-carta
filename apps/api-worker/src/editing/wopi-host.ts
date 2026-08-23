import type { OpenAPIHono } from "@hono/zod-openapi";
import type { FileId } from "@magna-carta/identifiers/types";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { documentSessionStub } from "./document-session.ts";
import { wopiGuard, WopiGuardError, type FirmDatabaseResolver } from "./wopi-guard.ts";
import { checkFileInfo, getFile, lockOperation, putFile, runWopiCallback } from "./wopi-routes.ts";

// The WOPI host callback surface — the editor's data plane. Collabora replays an opaque access_token
// (no session cookie) against the WOPISrc the launch handed it, so these routes are token-guarded and
// deliberately OUTSIDE the cookie chokepoint (mirroring the cookieless preview-serve route). Tenancy
// holds because the guard reconstructs the firm SOLELY from the verified token and the handlers derive
// every object key from the token's fileId/versionId — never the request line — so a token presented
// against another firm's WOPISrc reaches only its own firm's data. Every callback is wrapped in
// runWopiCallback, which maps a fault to the WOPI-contract status and emits ONE redacted operation.failed
// (no document bytes, no token) with an X-MC-Error-Id. Reasoning home: docs/conventions/security.md.

// Resolves a firm's per-firm database from the firmId in the verified token: confirm the firm exists
// in the control plane, then address its FirmDatabase Durable Object by firmId. Null (unknown firm,
// no control-plane row) → the guard answers 404.
function firmDatabaseResolverFor(env: Bindings): FirmDatabaseResolver {
  return async (firmId) => {
    const firm = await env.DB_CONTROL.prepare("SELECT id FROM firm WHERE id = ?1")
      .bind(firmId)
      .first<{ id: string }>();
    if (firm === null) return null;
    return firmDatabaseFor(env.FIRM_DATABASE, firm.id);
  };
}

type WopiContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

// Authenticates the callback from its access_token and resolves the live session state once (the DO
// holds the working-copy meta + lock). The fn receives the verified result; any thrown guard/route
// fault is mapped + redacted by runWopiCallback.
async function withWopi(
  c: WopiContext,
  operation: string,
  fn: (resolved: {
    claims: Awaited<ReturnType<typeof wopiGuard>>["claims"];
    firmDatabase: ProxyBatchDatabase;
    fileId: FileId;
    state: Awaited<ReturnType<ReturnType<typeof documentSessionStub>["getState"]>>;
  }) => Promise<Response>,
  options: { readonly requireLiveSession?: boolean } = {},
): Promise<Response> {
  const logger = createWorkersLogger(c.env.TELEMETRY);
  return runWopiCallback(operation, { logger, now: () => new Date().toISOString() }, async () => {
    const token = c.req.query("access_token") ?? "";
    const { claims, firmDatabase } = await wopiGuard(token, c.env, firmDatabaseResolverFor(c.env));
    const fileId = claims.fileId as FileId;
    const state = await documentSessionStub(c.env, fileId).getState();
    // Session binding for MUTATING edit callbacks: an edit token is bound to the DO session it was
    // minted for, so a leaked-but-unexpired token cannot replay a write/lock once that session is reaped
    // (state.sessionId null) or rotated (a different id). Scoped to capability === 'edit': reads are
    // never blocked, and a view token cannot mutate anyway (the handler's capability gate answers it),
    // so its session id need not be live.
    if (
      options.requireLiveSession === true &&
      claims.capability === "edit" &&
      claims.sessionId !== state.sessionId
    ) {
      throw new WopiGuardError("unauthorized");
    }
    return fn({ claims, firmDatabase, fileId, state });
  });
}

export function registerWopiHostRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
): void {
  // CheckFileInfo — GET /wopi/files/{fileId}
  app.get("/wopi/files/:fileId", (c) =>
    withWopi(c, "wopi:check-file-info", async ({ claims, firmDatabase, state }) => {
      const body = await checkFileInfo(claims, {
        database: firmDatabase,
        bucket: c.env.R2,
        currentMeta: state.current,
        liveSessionId: state.sessionId,
      });
      return Response.json(body);
    }),
  );

  // Lock family — POST /wopi/files/{fileId} (dispatched by X-WOPI-Override)
  app.post("/wopi/files/:fileId", (c) =>
    withWopi(
      c,
      "wopi:lock",
      async ({ claims, fileId, state }) => {
        const stub = documentSessionStub(c.env, fileId);
        return lockOperation(claims, c.req.raw, {
          currentLock: state.wopiLock,
          setLock: (value) => stub.setWopiLock(value),
          clearLock: () => stub.clearWopiLock(),
        });
      },
      { requireLiveSession: true },
    ),
  );

  // GetFile — GET /wopi/files/{fileId}/contents
  app.get("/wopi/files/:fileId/contents", (c) =>
    withWopi(c, "wopi:get-file", async ({ claims, firmDatabase, state }) =>
      getFile(claims, {
        database: firmDatabase,
        bucket: c.env.R2,
        currentMeta: state.current,
        // The live session identity is what decides whether this token may read the working copy, so it
        // is passed through even though a read never mutates it.
        liveSessionId: state.sessionId,
      }),
    ),
  );

  // PutFile — POST /wopi/files/{fileId}/contents
  app.post("/wopi/files/:fileId/contents", (c) =>
    withWopi(
      c,
      "wopi:put-file",
      async ({ claims, fileId, state }) => {
        const stub = documentSessionStub(c.env, fileId);
        return putFile(claims, c.req.raw, {
          bucket: c.env.R2,
          currentMeta: state.current,
          currentLock: state.wopiLock,
          recordCurrentMeta: (meta) => stub.setCurrentMeta(meta),
          now: () => new Date().toISOString(),
        });
      },
      { requireLiveSession: true },
    ),
  );
}
