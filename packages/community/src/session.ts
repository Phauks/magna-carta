import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import type { BoardMember } from "./board-service.ts";
import { suggestedDisplayName } from "./display.ts";
import type { SqlDatabase } from "./sql-database.ts";

// How a signed-in person reaches the board, which lives on its own host and so cannot read the
// app's session cookie.
//
// 1. The app, holding a live session, mints a HANDOFF token: the person's id, a random id and an
//    expiry one minute out, signed with a secret the app and the board's worker share. It sends the
//    browser to the board with that token in the address.
// 2. The board's worker verifies it, records the random id in `community_session_handoff` (the
//    insert refuses a second use of the same id), and sets its own SESSION cookie: the person's id
//    and an expiry, signed with the same secret under a different type.
// 3. Every board request reads the person afresh from the control plane (`resolveBoardViewer`), so
//    a person who has left their firm stops being able to post at once, whatever the cookie says.
//
// The shared secret is never the app's own sign-in secret: a leak from the board's worker must not
// be able to forge an app session.

export const HANDOFF_TOKEN_TYPE = "community-handoff";
export const SESSION_TOKEN_TYPE = "community-session";
export const HANDOFF_LIFETIME_SECONDS = 60;
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
// Redeemed handoff ids are kept a day: far past any token's one-minute life, so a replay is always
// refused, and short enough that the table never grows.
const HANDOFF_RETENTION_MILLISECONDS = 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signToken(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// The payload of a token this secret signed with this type, or null. `crypto.subtle.verify` compares
// in constant time, and every failure answers the same null so a caller cannot say which check failed.
async function verifyToken(
  secret: string,
  token: string,
  type: string,
): Promise<Record<string, unknown> | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const signature = base64UrlDecode(token.slice(dot + 1));
  if (signature === null) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature,
    encoder.encode(body),
  );
  if (!valid) return null;
  const bytes = base64UrlDecode(body);
  if (bytes === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  return record["typ"] === type ? record : null;
}

function randomId(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(18)));
}

export interface HandoffClaim {
  readonly userId: UserId;
  readonly handoffId: string;
}

export async function mintHandoffToken(
  secret: string,
  userId: UserId,
  nowSeconds: number,
): Promise<string> {
  return await signToken(secret, {
    typ: HANDOFF_TOKEN_TYPE,
    sub: userId,
    jti: randomId(),
    exp: nowSeconds + HANDOFF_LIFETIME_SECONDS,
  });
}

export async function verifyHandoffToken(
  secret: string,
  token: string,
  nowSeconds: number,
): Promise<HandoffClaim | null> {
  const payload = await verifyToken(secret, token, HANDOFF_TOKEN_TYPE);
  if (payload === null) return null;
  const { sub, jti, exp } = payload;
  if (typeof sub !== "string" || typeof jti !== "string" || typeof exp !== "number") return null;
  if (exp < nowSeconds) return null;
  return { userId: sub as UserId, handoffId: jti };
}

export async function mintSessionToken(
  secret: string,
  userId: UserId,
  nowSeconds: number,
): Promise<string> {
  return await signToken(secret, {
    typ: SESSION_TOKEN_TYPE,
    sub: userId,
    exp: nowSeconds + SESSION_LIFETIME_SECONDS,
  });
}

export async function verifySessionToken(
  secret: string,
  token: string,
  nowSeconds: number,
): Promise<UserId | null> {
  const payload = await verifyToken(secret, token, SESSION_TOKEN_TYPE);
  if (payload === null) return null;
  const { sub, exp } = payload;
  if (typeof sub !== "string" || typeof exp !== "number" || exp < nowSeconds) return null;
  return sub as UserId;
}

// Records a handoff as used. True the first time an id is redeemed, false on every later attempt.
// The same call drops ids redeemed more than a day ago.
export async function redeemHandoff(
  database: SqlDatabase,
  claim: HandoffClaim,
  now: string,
): Promise<boolean> {
  const cutoff = new Date(Date.parse(now) - HANDOFF_RETENTION_MILLISECONDS).toISOString();
  await database
    .prepare("DELETE FROM community_session_handoff WHERE redeemed_at < ?1")
    .bind(cutoff)
    .run();
  const result = await database
    .prepare(
      `INSERT INTO community_session_handoff (id, user_id, redeemed_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(claim.handoffId, claim.userId, now)
    .run();
  return result.meta.changes === 1;
}

export interface BoardViewer {
  readonly member: BoardMember;
  readonly suggestedDisplayName: string;
}

// The person behind a session, read afresh: a member of a firm, and on the Magna Carta team when
// they hold an unexpired platform-operator grant. Null for an unknown id or a person with no firm,
// who may read the board like anyone signed out but may not write to it.
export async function resolveBoardViewer(
  database: SqlDatabase,
  userId: UserId,
  now: string,
): Promise<BoardViewer | null> {
  const { results } = await database
    .prepare(
      `SELECT user.firm_id AS firm_id, user.name_given AS name_given,
              user.name_family AS name_family, user.name AS name,
              EXISTS (
                SELECT 1 FROM platform_operator
                WHERE platform_operator.user_id = user.id
                  AND (platform_operator.expires_at IS NULL OR platform_operator.expires_at > ?2)
              ) AS is_team
       FROM user WHERE user.id = ?1 LIMIT 1`,
    )
    .bind(userId, now)
    .all<{
      firm_id: string | null;
      name_given: string | null;
      name_family: string | null;
      name: string;
      is_team: number;
    }>();
  const row = results[0];
  if (row === undefined || row.firm_id === null) return null;
  const given = row.name_given ?? row.name.trim().split(/\s+/)[0] ?? null;
  const family =
    row.name_family ??
    (row.name_given === null ? (row.name.trim().split(/\s+/).at(-1) ?? null) : null);
  return {
    member: { userId, firmId: row.firm_id as FirmId, isTeam: row.is_team === 1 },
    suggestedDisplayName: suggestedDisplayName(given, family === given ? null : family),
  };
}

export const BOARD_STATES = ["open", "read-only", "off"] as const;
export type BoardState = (typeof BOARD_STATES)[number];

// The board's switch (`community_board_switch`, row "board"). No row, or a value this code does not
// know, reads as open for "no row" and as read-only for anything unrecognised: a typo during an
// incident must fail towards fewer writes, never towards more.
export async function readBoardState(database: SqlDatabase): Promise<BoardState> {
  const { results } = await database
    .prepare("SELECT state FROM community_board_switch WHERE id = 'board' LIMIT 1")
    .all<{ state: string }>();
  const row = results[0];
  if (row === undefined) return "open";
  return (BOARD_STATES as readonly string[]).includes(row.state)
    ? (row.state as BoardState)
    : "read-only";
}
