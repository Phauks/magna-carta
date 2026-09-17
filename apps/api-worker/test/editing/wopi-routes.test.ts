import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FileVersionId, FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  checkFileInfo,
  getFile,
  lockOperation,
  putFile,
  saveKindOf,
} from "../../src/editing/wopi-routes.ts";
import type { EditTokenClaims } from "../../src/editing/wopi-token.ts";
import type { CurrentObjectMeta } from "../../src/editing/document-session.ts";
import { firmDatabaseHandle } from "../support/firm-database-handle.ts";

// The WOPI CheckFileInfo + GetFile handlers, exercised over real Miniflare bindings (the firm's
// FirmDatabase Durable Object, the R2 binding). The handlers receive already-verified token claims (the
// guard + firm-database resolution happen upstream), so these tests construct the claims directly and assert
// the protocol shaping: UserCanWrite tracks capability, the file's display name and size come from the
// firm metadata, LastModifiedTime echoes the session's host-assigned timestamp, and the file-access
// handlers read the live `current` working object only for the session that owns it — every other caller
// reads the immutable version its token names.

const ISO = "2026-06-20T00:00:00.000Z";
const LIVE_SESSION = "wopiSession_test";
const memberId = newIdentifier("user");
let matterId: string;
let firmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;

// Seeds a clean file with one committed version and writes its bytes into the R2 binding at the
// version key — the minimal metadata chain CheckFileInfo/GetFile read from.
async function seedCleanFile(
  name: string,
  versionBytes: string,
): Promise<{ fileId: FileId; versionId: FileVersionId; versionKey: string }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const versionKey = `files/${fileId}/${versionId}`;
  await firmDb
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
    )
    .bind(fileId, matterId, name, ISO)
    .run();
  await firmDb
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at) " +
        "VALUES (?1, ?2, 1, ?3, ?4, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', NULL, 'seed-hash', 'clean', ?5, ?6, ?6)",
    )
    .bind(versionId, fileId, versionKey, versionBytes.length, memberId, ISO)
    .run();
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(versionKey, versionBytes);
  return { fileId, versionId, versionKey };
}

function claimsFor(
  fileId: FileId,
  versionId: FileVersionId,
  capability: "view" | "edit",
  sessionId: string = LIVE_SESSION,
): EditTokenClaims {
  return {
    firmId,
    matterId,
    fileId,
    versionId,
    memberId,
    capability,
    sessionId,
    exp: Date.parse(ISO) + 60 * 60 * 1000,
    jti: "test-jti",
  };
}

beforeAll(async () => {
  firmId = newIdentifier("firm");
  firmDb = firmDatabaseHandle(firmId);
  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Editor', 'active', ?2)",
    )
    .bind(memberId, ISO)
    .run();
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Editing Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, memberId, ISO)
    .run();
});

describe("WOPI CheckFileInfo", () => {
  it("reports the file name and size and grants write for an edit token", async () => {
    const { fileId, versionId } = await seedCleanFile("Brief.docx", "hello world");

    const info = await checkFileInfo(claimsFor(fileId, versionId, "edit"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta: null,
      liveSessionId: null,
    });

    expect(info.BaseFileName).toBe("Brief.docx");
    expect(info.Size).toBe("hello world".length);
    expect(info.UserCanWrite).toBe(true);
    expect(info.UserId).toBe(memberId);
    expect(typeof info.OwnerId).toBe("string");
    expect(info.OwnerId.length).toBeGreaterThan(0);
    expect(typeof info.Version).toBe("string");
    expect(info.Version.length).toBeGreaterThan(0);
  });

  it("advertises the lock contract it enforces, and gives every member the whole editor", async () => {
    // PutFile refuses a save made without a held lock, and the editor only takes a lock when the host
    // says it supports them — so a host that enforces locks without advertising them refuses every save.
    const { fileId, versionId } = await seedCleanFile("Locked.docx", "hello");

    const info = await checkFileInfo(claimsFor(fileId, versionId, "edit"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta: null,
      liveSessionId: null,
    });

    expect(info.SupportsLocks).toBe(true);
    expect(info.SupportsUpdate).toBe(true);
    // Every member: the owner wants the whole editor, its server audit included, on every seat.
    expect(info.IsAdminUser).toBe(true);
    // The lock handler implements no GET_LOCK, so it must not be advertised.
    expect("SupportsGetLock" in info).toBe(false);
  });

  it("names the member as the editor shows them, and omits the name where the host has none", async () => {
    // The editor labels the member's cursor, seat and changes with UserFriendlyName; without it the
    // member is "UnknownUser" with an identifier appended, which is what co-authors would read.
    const { fileId, versionId } = await seedCleanFile("Named.docx", "hello");
    const named = await checkFileInfo(claimsFor(fileId, versionId, "edit"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta: null,
      liveSessionId: null,
      memberName: "Editor",
    });
    expect(named.UserFriendlyName).toBe("Editor");

    const unnamed = await checkFileInfo(claimsFor(fileId, versionId, "edit"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta: null,
      liveSessionId: null,
      memberName: null,
    });
    expect("UserFriendlyName" in unnamed).toBe(false);
  });

  it("hands back the launching origin as PostMessageOrigin, so the editor can report itself up", async () => {
    // Without it the editor posts nothing, and the screen framing it cannot tell a container that is
    // still starting from a frame the browser refused.
    const { fileId, versionId } = await seedCleanFile("Spoken.docx", "hello");
    const claims = { ...claimsFor(fileId, versionId, "edit"), appOrigin: "https://acme.example" };

    const info = await checkFileInfo(claims, {
      database: firmDb,
      bucket: env.R2,
      currentMeta: null,
      liveSessionId: null,
    });

    expect(info.PostMessageOrigin).toBe("https://acme.example");
  });

  it("omits PostMessageOrigin for a token minted before the claim existed, rather than guessing one", async () => {
    // A guessed origin would not match the page, so the messages would go nowhere — the same silence,
    // with a configuration value standing behind it. Such a token is still inside its hour.
    const { fileId, versionId } = await seedCleanFile("Silent.docx", "hello");

    const info = await checkFileInfo(claimsFor(fileId, versionId, "edit"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta: null,
      liveSessionId: null,
    });

    expect(info.PostMessageOrigin).toBeUndefined();
    expect("PostMessageOrigin" in info).toBe(false);
  });

  it("withholds write for a view token (capability is the gate, not a UI hint)", async () => {
    const { fileId, versionId } = await seedCleanFile("ReadOnly.docx", "abc");

    const info = await checkFileInfo(claimsFor(fileId, versionId, "view"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta: null,
      liveSessionId: null,
    });

    expect(info.UserCanWrite).toBe(false);
  });

  it("echoes the session's host-assigned timestamp as LastModifiedTime when a live session set it", async () => {
    const { fileId, versionId } = await seedCleanFile("Live.docx", "draft");
    const currentMeta: CurrentObjectMeta = {
      sha256: "live-hash",
      sizeBytes: 12345,
      wopiTimestamp: "2026-06-21T09:30:00.000Z",
    };

    const info = await checkFileInfo(claimsFor(fileId, versionId, "edit"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta,
      liveSessionId: LIVE_SESSION,
    });

    expect(info.LastModifiedTime).toBe("2026-06-21T09:30:00.000Z");
    // The live working-copy size supersedes the committed version's size.
    expect(info.Size).toBe(12345);
  });

  // The advertised size/version must describe the bytes GetFile will hand back: a token minted outside
  // the live session reads the committed version, so it must be told the committed version's metadata.
  it("reports the committed version's metadata to a token that does not own the live working copy", async () => {
    const { fileId, versionId } = await seedCleanFile("Foreign.docx", "committed");
    const deps = {
      database: firmDb,
      bucket: env.R2,
      currentMeta: {
        sha256: "live-hash",
        sizeBytes: 999_999,
        wopiTimestamp: "2026-06-21T11:00:00.000Z",
      },
      liveSessionId: LIVE_SESSION,
    };

    const outsider = await checkFileInfo(
      claimsFor(fileId, versionId, "view", "wopiSession_other"),
      deps,
    );
    expect(outsider.Size).toBe("committed".length);
    expect(outsider.Version).toBe(versionId);
    expect(outsider.LastModifiedTime).toBeNull();

    // The same file, read by the session that owns the working copy, still reports the live metadata.
    const owner = await checkFileInfo(claimsFor(fileId, versionId, "edit"), deps);
    expect(owner.Size).toBe(999_999);
    expect(owner.Version).toBe("2026-06-21T11:00:00.000Z");
  });

  it("reports the committed version's metadata once the live session is gone", async () => {
    const { fileId, versionId } = await seedCleanFile("Reaped.docx", "committed");

    const info = await checkFileInfo(claimsFor(fileId, versionId, "edit"), {
      database: firmDb,
      bucket: env.R2,
      // A reap clears the session state; the working-copy metadata goes with it.
      currentMeta: null,
      liveSessionId: null,
    });

    expect(info.Size).toBe("committed".length);
    expect(info.Version).toBe(versionId);
  });
});

// The live working copy is served to the session that owns it and to nobody else. `current` is one
// mutable object per file that outlives the session that wrote it, so ownership — not capability — is
// what makes it the right bytes: an owning session gets its own working copy, and every other caller
// (an editor whose session was reaped, a token minted outside the live session, a read-only viewer that
// never joined) gets the immutable version its token names.
const liveMeta: CurrentObjectMeta = {
  sha256: "live-hash",
  sizeBytes: "live-working-copy".length,
  wopiTimestamp: "2026-06-21T10:00:00.000Z",
};

describe("WOPI GetFile", () => {
  it("streams the live `current` working object to the session that owns it", async () => {
    const { fileId, versionId } = await seedCleanFile("Edit.docx", "committed-bytes");
    await env.R2.put(`files/${fileId}/current`, "live-working-copy");

    const response = await getFile(claimsFor(fileId, versionId, "edit"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta: liveMeta,
      liveSessionId: LIVE_SESSION,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("live-working-copy");
  });

  it("streams the live working copy to a read-only viewer that joined that session (reading is never blocked)", async () => {
    const { fileId, versionId } = await seedCleanFile("Watch.docx", "committed-bytes");
    await env.R2.put(`files/${fileId}/current`, "live-working-copy");

    const response = await getFile(claimsFor(fileId, versionId, "view"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta: liveMeta,
      liveSessionId: LIVE_SESSION,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("live-working-copy");
  });

  it("streams the version a token names — never the live bytes — when the token belongs to another session", async () => {
    const { fileId, versionId } = await seedCleanFile("Outsider.docx", "committed-bytes");
    await env.R2.put(`files/${fileId}/current`, "live-working-copy");
    const deps = {
      database: firmDb,
      bucket: env.R2,
      currentMeta: liveMeta,
      liveSessionId: LIVE_SESSION,
    };

    const served = await Promise.all(
      (["view", "edit"] as const).map(async (capability) => {
        const response = await getFile(
          claimsFor(fileId, versionId, capability, "wopiSession_other"),
          deps,
        );
        expect(response.status).toBe(200);
        return response.text();
      }),
    );

    expect(served).toEqual(["committed-bytes", "committed-bytes"]);
  });

  it("streams the committed version when no session is live, even though a `current` object lingers", async () => {
    const { fileId, versionId } = await seedCleanFile("Stale.docx", "committed-bytes");
    // A reaped session leaves its working object behind (the reap cuts a version, it does not delete
    // `current`), so a fresh session must not pick those bytes up as its editing base.
    await env.R2.put(`files/${fileId}/current`, "abandoned-working-copy");

    const served = await Promise.all(
      (["view", "edit"] as const).map(async (capability) => {
        const response = await getFile(claimsFor(fileId, versionId, capability), {
          database: firmDb,
          bucket: env.R2,
          currentMeta: null,
          liveSessionId: null,
        });
        expect(response.status).toBe(200);
        return response.text();
      }),
    );

    expect(served).toEqual(["committed-bytes", "committed-bytes"]);
  });

  it("streams the committed version while a live session has not yet written a working copy", async () => {
    const { fileId, versionId } = await seedCleanFile("Fresh.docx", "version-bytes");
    // The session is live and this token owns it, but nothing has been saved — and the leftover object
    // from an earlier session is not this session's base.
    await env.R2.put(`files/${fileId}/current`, "abandoned-working-copy");

    const response = await getFile(claimsFor(fileId, versionId, "edit"), {
      database: firmDb,
      bucket: env.R2,
      currentMeta: null,
      liveSessionId: LIVE_SESSION,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("version-bytes");
  });

  it("404s rather than substituting other bytes when the owned working copy is gone", async () => {
    const { fileId, versionId } = await seedCleanFile("Vanished.docx", "committed-bytes");
    // The session owns a working copy the bucket no longer holds (a soft-delete destroys `current`).
    // Serving the committed version instead would hand the editor a different document under the size
    // and version CheckFileInfo already advertised.
    await expect(
      getFile(claimsFor(fileId, versionId, "edit"), {
        database: firmDb,
        bucket: env.R2,
        currentMeta: liveMeta,
        liveSessionId: LIVE_SESSION,
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("404s when neither the working copy nor the named version exists", async () => {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");

    await expect(
      getFile(claimsFor(fileId, versionId, "view"), {
        database: firmDb,
        bucket: env.R2,
        currentMeta: null,
        liveSessionId: null,
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

// The two file-access handlers must answer the same question the same way. A token is a capability
// over ONE version of one file for a fixed window, and everything it depends on can change inside that
// window — the file can be soft-deleted, the named version withdrawn behind the status gate, a re-scan
// can flag it, or another writer can cut a newer version. Each case is asserted against BOTH handlers,
// because the failure that matters is not either refusal on its own: it is one handler serving bytes
// the other has already decided are not servable.
describe("WOPI CheckFileInfo + GetFile agree on what the token may reach", () => {
  const deps = () => ({
    database: firmDb,
    bucket: env.R2,
    currentMeta: null,
    liveSessionId: null,
  });

  it("refuses a soft-deleted file on both handlers", async () => {
    const { fileId, versionId } = await seedCleanFile("Deleted.docx", "committed-bytes");
    await firmDb.prepare("UPDATE file SET deleted_at = ?2 WHERE id = ?1").bind(fileId, ISO).run();

    const claims = claimsFor(fileId, versionId, "edit");
    await expect(checkFileInfo(claims, deps())).rejects.toMatchObject({ code: "not-found" });
    await expect(getFile(claims, deps())).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses a version withdrawn behind the status gate after the token was minted", async () => {
    const { fileId, versionId } = await seedCleanFile("Withdrawn.docx", "committed-bytes");
    // The custody check found the stored bytes no longer match the hash the version asserts, so the
    // version was withdrawn. The token predates that and its bytes are still at the version key.
    await firmDb
      .prepare("UPDATE file_version SET status = 'quarantined' WHERE id = ?1")
      .bind(versionId)
      .run();

    const claims = claimsFor(fileId, versionId, "view");
    await expect(checkFileInfo(claims, deps())).rejects.toMatchObject({ code: "not-found" });
    await expect(getFile(claims, deps())).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses a version a re-scan flagged, which stays clean-status and visible elsewhere", async () => {
    const { fileId, versionId } = await seedCleanFile("Flagged.docx", "committed-bytes");
    await firmDb
      .prepare("UPDATE file_version SET scan_verdict = 'flagged' WHERE id = ?1")
      .bind(versionId)
      .run();

    const claims = claimsFor(fileId, versionId, "edit");
    await expect(checkFileInfo(claims, deps())).rejects.toMatchObject({ code: "not-found" });
    await expect(getFile(claims, deps())).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses a version handle that names another file's version", async () => {
    const { fileId } = await seedCleanFile("Own.docx", "own-bytes");
    const other = await seedCleanFile("Other.docx", "other-bytes");

    const claims = claimsFor(fileId, other.versionId, "edit");
    await expect(checkFileInfo(claims, deps())).rejects.toMatchObject({ code: "not-found" });
    await expect(getFile(claims, deps())).rejects.toMatchObject({ code: "not-found" });
  });

  // The divergence a mid-token version cut used to open: CheckFileInfo described the file's CURRENT
  // version while GetFile served the version the token names. The editor then saved against a base
  // whose size and version identifier it had been told belonged to different bytes.
  it("reports the token's version, not a newer one another writer cut mid-token", async () => {
    const { fileId, versionId } = await seedCleanFile("Superseded.docx", "the-token-version");
    // A second writer commits v2 and advances the file's current pointer while this token is live.
    const newerVersionId = newIdentifier("fileVersion");
    const newerKey = `files/${fileId}/${newerVersionId}`;
    await firmDb
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at) " +
          "VALUES (?1, ?2, 2, ?3, ?4, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', NULL, 'newer-hash', 'clean', ?5, ?6, ?6)",
      )
      .bind(newerVersionId, fileId, newerKey, "a-much-longer-newer-version".length, memberId, ISO)
      .run();
    await firmDb
      .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(fileId, newerVersionId)
      .run();
    await env.R2.put(newerKey, "a-much-longer-newer-version");

    const claims = claimsFor(fileId, versionId, "edit");
    const info = await checkFileInfo(claims, deps());
    expect(info.Version).toBe(versionId);
    expect(info.Size).toBe("the-token-version".length);

    const response = await getFile(claims, deps());
    expect(await response.text()).toBe("the-token-version");
  });
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function putRequest(body: string, coolTimestamp?: string): Request {
  return new Request("https://host/wopi/files/x/contents", {
    method: "POST",
    headers: coolTimestamp === undefined ? {} : { "X-COOL-WOPI-Timestamp": coolTimestamp },
    body,
  });
}

const HOST_TIMESTAMP = "2026-06-22T12:00:00.000Z";

describe("WOPI PutFile", () => {
  it("streams the body into `current`, recording the streamed hash and a host-assigned timestamp", async () => {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const recordCurrentMeta = vi.fn(async () => {});

    const response = await putFile(
      claimsFor(fileId, versionId, "edit"),
      putRequest("edited body"),
      {
        bucket: env.R2,
        currentMeta: null,
        currentLock: "lock-1",
        recordCurrentMeta,
        now: () => HOST_TIMESTAMP,
      },
    );

    expect(response.status).toBe(200);
    // The answer the editor reads: a JSON body naming the new LastModifiedTime, which it presents on
    // its next save. The header beside it is the same fact for a trace.
    expect(await response.json()).toEqual({ LastModifiedTime: HOST_TIMESTAMP });
    expect(response.headers.get("X-COOL-WOPI-Timestamp")).toBe(HOST_TIMESTAMP);
    const stored = await env.R2.get(`files/${fileId}/current`);
    expect(await stored?.text()).toBe("edited body");
    expect(recordCurrentMeta).toHaveBeenCalledOnce();
    expect(recordCurrentMeta).toHaveBeenCalledWith({
      sha256: await sha256Hex("edited body"),
      sizeBytes: "edited body".length,
      wopiTimestamp: HOST_TIMESTAMP,
    });
  });

  it("rejects a stale X-COOL-WOPI-Timestamp with 409/1010 and leaves `current` untouched", async () => {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    await env.R2.put(`files/${fileId}/current`, "original");
    const recordCurrentMeta = vi.fn(async () => {});

    const response = await putFile(
      claimsFor(fileId, versionId, "edit"),
      putRequest("attempted overwrite", "2020-01-01T00:00:00.000Z"),
      {
        bucket: env.R2,
        // The session's authoritative timestamp differs from the presented one.
        currentMeta: { sha256: "x", sizeBytes: 8, wopiTimestamp: HOST_TIMESTAMP },
        currentLock: "lock-1",
        recordCurrentMeta,
        now: () => "2026-06-22T13:00:00.000Z",
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ COOLStatusCode: 1010 });
    const stored = await env.R2.get(`files/${fileId}/current`);
    expect(await stored?.text()).toBe("original");
    expect(recordCurrentMeta).not.toHaveBeenCalled();
  });

  it("accepts a PutFile whose timestamp matches the session's recorded value", async () => {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const recordCurrentMeta = vi.fn(async () => {});

    const response = await putFile(
      claimsFor(fileId, versionId, "edit"),
      putRequest("next revision", HOST_TIMESTAMP),
      {
        bucket: env.R2,
        currentMeta: { sha256: "x", sizeBytes: 8, wopiTimestamp: HOST_TIMESTAMP },
        currentLock: "lock-1",
        recordCurrentMeta,
        now: () => "2026-06-22T14:00:00.000Z",
      },
    );

    expect(response.status).toBe(200);
    const stored = await env.R2.get(`files/${fileId}/current`);
    expect(await stored?.text()).toBe("next revision");
    expect(recordCurrentMeta).toHaveBeenCalledOnce();
  });

  it("refuses a view token, writing nothing", async () => {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const recordCurrentMeta = vi.fn(async () => {});

    await expect(
      putFile(claimsFor(fileId, versionId, "view"), putRequest("sneaky write"), {
        bucket: env.R2,
        currentMeta: null,
        currentLock: "lock-1",
        recordCurrentMeta,
        now: () => HOST_TIMESTAMP,
      }),
    ).rejects.toMatchObject({ code: "forbidden-readonly" });

    expect(await env.R2.get(`files/${fileId}/current`)).toBeNull();
    expect(recordCurrentMeta).not.toHaveBeenCalled();
  });

  it("refuses an unlocked PutFile with 409 (empty X-WOPI-Lock), writing nothing", async () => {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const recordCurrentMeta = vi.fn(async () => {});

    const response = await putFile(
      claimsFor(fileId, versionId, "edit"),
      putRequest("no lock held"),
      {
        bucket: env.R2,
        currentMeta: null,
        currentLock: null, // no lock held
        recordCurrentMeta,
        now: () => HOST_TIMESTAMP,
      },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("X-WOPI-Lock")).toBe("");
    expect(await env.R2.get(`files/${fileId}/current`)).toBeNull();
    expect(recordCurrentMeta).not.toHaveBeenCalled();
  });
});

const editClaims = () => claimsFor(newIdentifier("file"), newIdentifier("fileVersion"), "edit");

function lockRequest(override: string, lock: string, oldLock?: string): Request {
  const headers: Record<string, string> = { "X-WOPI-Override": override, "X-WOPI-Lock": lock };
  if (oldLock !== undefined) headers["X-WOPI-OldLock"] = oldLock;
  return new Request("https://host/wopi/files/x", { method: "POST", headers });
}

describe("saveKindOf", () => {
  it("reads the editor's save headers: exit first, then autosave, else the member's own save", () => {
    expect(saveKindOf(new Headers())).toBe("explicit");
    expect(saveKindOf(new Headers({ "X-COOL-WOPI-IsAutosave": "false" }))).toBe("explicit");
    expect(saveKindOf(new Headers({ "X-COOL-WOPI-IsAutosave": "true" }))).toBe("autosave");
    expect(
      saveKindOf(
        new Headers({ "X-COOL-WOPI-IsAutosave": "true", "X-COOL-WOPI-IsExitSave": "true" }),
      ),
    ).toBe("exit");
  });
});

describe("WOPI lock family", () => {
  it("locks an unlocked document and stores the lock value", async () => {
    const setLock = vi.fn(async () => {});
    const clearLock = vi.fn(async () => {});

    const response = await lockOperation(editClaims(), lockRequest("LOCK", "L1"), {
      currentLock: null,
      setLock,
      clearLock,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-WOPI-Lock")).toBeNull();
    expect(setLock).toHaveBeenCalledWith("L1");
  });

  it("treats a Lock with the same value as a co-editor join (no relock)", async () => {
    const setLock = vi.fn(async () => {});

    const response = await lockOperation(editClaims(), lockRequest("LOCK", "L1"), {
      currentLock: "L1",
      setLock,
      clearLock: vi.fn(async () => {}),
    });

    expect(response.status).toBe(200);
    expect(setLock).not.toHaveBeenCalled();
  });

  it("lets a successor container instance take over a stale lock with a plain Lock", async () => {
    // One container serves a document and its coolwsd holds one lock value that every co-editor on it
    // shares, so a different value can only be a new instance after the previous one slept without
    // unlocking. Refusing it would hold the document until an unlock that never comes.
    const setLock = vi.fn(async () => {});

    const response = await lockOperation(editClaims(), lockRequest("LOCK", "L2"), {
      currentLock: "L1",
      setLock,
      clearLock: vi.fn(async () => {}),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-WOPI-Lock")).toBeNull();
    expect(setLock).toHaveBeenCalledWith("L2");
  });

  it("unlocks when the presented lock matches", async () => {
    const clearLock = vi.fn(async () => {});

    const response = await lockOperation(editClaims(), lockRequest("UNLOCK", "L1"), {
      currentLock: "L1",
      setLock: vi.fn(async () => {}),
      clearLock,
    });

    expect(response.status).toBe(200);
    expect(clearLock).toHaveBeenCalledOnce();
  });

  it("returns 409 with the held lock when Unlock presents the wrong lock", async () => {
    const clearLock = vi.fn(async () => {});

    const response = await lockOperation(editClaims(), lockRequest("UNLOCK", "Lwrong"), {
      currentLock: "L1",
      setLock: vi.fn(async () => {}),
      clearLock,
    });

    expect(response.status).toBe(409);
    expect(response.headers.get("X-WOPI-Lock")).toBe("L1");
    expect(clearLock).not.toHaveBeenCalled();
  });

  it("refreshes a matching lock and 409s a mismatched one with an empty header when unlocked", async () => {
    const refreshed = await lockOperation(editClaims(), lockRequest("REFRESH_LOCK", "L1"), {
      currentLock: "L1",
      setLock: vi.fn(async () => {}),
      clearLock: vi.fn(async () => {}),
    });
    expect(refreshed.status).toBe(200);

    const stale = await lockOperation(editClaims(), lockRequest("REFRESH_LOCK", "L1"), {
      currentLock: null,
      setLock: vi.fn(async () => {}),
      clearLock: vi.fn(async () => {}),
    });
    expect(stale.status).toBe(409);
    expect(stale.headers.get("X-WOPI-Lock")).toBe("");
  });

  it("relocks (UnlockAndRelock) when the old lock matches and 409s when it does not", async () => {
    const setLockOk = vi.fn(async () => {});
    const ok = await lockOperation(editClaims(), lockRequest("LOCK", "L2", "L1"), {
      currentLock: "L1",
      setLock: setLockOk,
      clearLock: vi.fn(async () => {}),
    });
    expect(ok.status).toBe(200);
    expect(setLockOk).toHaveBeenCalledWith("L2");

    const setLockBad = vi.fn(async () => {});
    const bad = await lockOperation(editClaims(), lockRequest("LOCK", "L2", "Lwrong"), {
      currentLock: "L1",
      setLock: setLockBad,
      clearLock: vi.fn(async () => {}),
    });
    expect(bad.status).toBe(409);
    expect(bad.headers.get("X-WOPI-Lock")).toBe("L1");
    expect(setLockBad).not.toHaveBeenCalled();
  });

  it("refuses a view token", async () => {
    const viewClaims = claimsFor(newIdentifier("file"), newIdentifier("fileVersion"), "view");
    await expect(
      lockOperation(viewClaims, lockRequest("LOCK", "L1"), {
        currentLock: null,
        setLock: vi.fn(async () => {}),
        clearLock: vi.fn(async () => {}),
      }),
    ).rejects.toMatchObject({ code: "forbidden-readonly" });
  });
});
