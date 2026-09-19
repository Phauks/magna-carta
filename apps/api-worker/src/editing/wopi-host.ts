import type { OpenAPIHono } from "@hono/zod-openapi";
import { readMemberDisplayName } from "@magna-carta/data-access/member-statements";
import { readRecordChanges } from "@magna-carta/file-manager/editing-policy-settings";
import type { FileId, UserId } from "@magna-carta/identifiers/types";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { documentSessionStub } from "./document-session.ts";
import { wopiGuard, WopiGuardError, type FirmDatabaseResolver } from "./wopi-guard.ts";
import {
  checkFileInfo,
  getFile,
  lockOperation,
  putFile,
  runWopiCallback,
  saveKindOf,
} from "./wopi-routes.ts";
import { cutVersionFromWorkingCopy } from "./working-copy-version.ts";

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
    bucket: R2Bucket;
    fileId: FileId;
    state: Awaited<ReturnType<ReturnType<typeof documentSessionStub>["getState"]>>;
  }) => Promise<Response>,
  options: { readonly requireLiveSession?: boolean } = {},
): Promise<Response> {
  const logger = createWorkersLogger(c.env.TELEMETRY);

  const verified = async (
    claims: Awaited<ReturnType<typeof wopiGuard>>["claims"],
    firmDatabase: ProxyBatchDatabase,
    fileId: FileId,
  ): Promise<Response> => {
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
    // The bucket comes from the MAC-verified claims, like the database beside it — a WOPI callback
    // reads and writes the working copy in the firm its token names and in no other.
    const { bucket } = await resolveFirmBucketForFirmId(c.env, claims.firmId);
    return fn({ claims, firmDatabase, bucket, fileId, state });
  };

  // Who this callback was for, once the token has said so. It stays unset when the guard refuses the
  // token: with no verified member there is no open to record against, and a forged token must not
  // be able to write a mark onto anyone's. (A holder rather than a plain variable, because the
  // assignment happens inside the callback and a plain `let` reads as never-assigned after it.)
  const seen: { caller: { readonly memberId: string; readonly fileId: FileId } | null } = {
    caller: null,
  };
  const response = await runWopiCallback(
    operation,
    { logger, now: () => new Date().toISOString() },
    async () => {
      const token = c.req.query("access_token") ?? "";
      const { claims, firmDatabase } = await wopiGuard(
        token,
        c.env,
        firmDatabaseResolverFor(c.env),
      );
      const fileId = claims.fileId as FileId;
      seen.caller = { memberId: claims.memberId, fileId };
      return verified(claims, firmDatabase, fileId);
    },
  );
  // The host's answer, recorded where the screen that launched the editor can read it: which call
  // the editor made and what it was told, refusals included (the Error ID is the same one the
  // redacted event carries). This is the only sight the screen has of the editor's side of the open,
  // and the place every failure on this path so far has been.
  if (seen.caller !== null) {
    await documentSessionStub(c.env, seen.caller.fileId).recordCallback(seen.caller.memberId, {
      operation,
      status: response.status,
      errorId: response.headers.get("X-MC-Error-Id"),
      at: new Date().toISOString(),
    });
  }
  return response;
}

export function registerWopiHostRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
): void {
  // CheckFileInfo — GET /wopi/files/{fileId}
  app.get("/wopi/files/:fileId", (c) =>
    withWopi(c, "wopi:check-file-info", async ({ claims, firmDatabase, bucket, state }) => {
      const [memberName, recordChanges] = await Promise.all([
        readMemberDisplayName(firmDatabase, claims.memberId as UserId),
        readRecordChanges(firmDatabase),
      ]);
      const body = await checkFileInfo(claims, {
        database: firmDatabase,
        bucket,
        currentMeta: state.current,
        liveSessionId: state.sessionId,
        memberName,
        recordChanges,
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
    withWopi(c, "wopi:get-file", async ({ claims, firmDatabase, bucket, state }) =>
      getFile(claims, {
        database: firmDatabase,
        bucket,
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
      async ({ claims, firmDatabase, bucket, fileId, state }) => {
        const stub = documentSessionStub(c.env, fileId);
        const saveKind = saveKindOf(c.req.raw.headers);
        const now = (): string => new Date().toISOString();
        return putFile(claims, c.req.raw, {
          bucket,
          currentMeta: state.current,
          currentLock: state.wopiLock,
          // The working copy's metadata first, then a version cut from it — every save, the autosave
          // included — so the file's history shows each state the moment it landed, with the kind of
          // save and everyone in the session on it. A save with unchanged bytes cuts nothing.
          recordCurrentMeta: async (meta) => {
            await stub.setCurrentMeta(meta);
            await cutVersionFromWorkingCopy(
              firmDatabase,
              bucket,
              fileId,
              meta,
              claims.memberId as UserId,
              saveKind,
              Object.keys(state.participants) as UserId[],
              now,
            );
          },
          now,
        });
      },
      { requireLiveSession: true },
    ),
  );
}
