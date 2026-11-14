import type { CalendarProvider } from "@magna-carta/calendar/sync-contract";
import type { CalendarSyncPort, ProviderNotice } from "@magna-carta/calendar/sync-port";
import type { Bindings } from "../bindings.ts";
import type { ConnectionIdentity } from "./connection-pass.ts";

// THE STANDING REQUEST THAT A PROVIDER SAY WHEN A MEMBER'S CALENDAR CHANGES.
//
// Without it a change made at the provider is found by whichever pass happens to run next, which
// can be hours. With it the provider calls this deployment the moment something changes, and the
// account's pass runs a second later. The notice says only "look again": nothing is read from it
// but the secret that proves who sent it, so a forged or replayed notice costs one pass that finds
// nothing different.
//
// A provider keeps a watch for a limited time. Every pass that reaches the provider checks the
// watch and renews it well before it lapses, so a watch is only ever lost by an account that has
// not run a pass for days, and the first pass afterwards begins a new one.

// What an account's object remembers about its watch. The secret never leaves the object except
// to the provider, once, when the watch begins.
export interface WatchState {
  readonly watchId: string;
  readonly secret: string;
  readonly expiresAt: string;
  // The address the provider was given. A deployment whose public address changes begins again.
  readonly address: string;
  // Set when the provider said the watch needs attention before its time: `renew` when it asked
  // to be reauthorized, `replace` when it said the watch is gone.
  readonly attention?: "renew" | "replace";
}

// Three days, where Microsoft allows a little under seven for a calendar's events and Google about
// the same. Short enough to sit inside any provider's limit, long enough that a renewal is a rare
// request.
export const WATCH_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;
// Renewed once less than this is left. An account's safety pass runs several times a day, so a
// watch with two days left is renewed long before it could lapse.
export const WATCH_RENEW_WHEN_LEFT_MS = 2 * 24 * 60 * 60 * 1000;

// Each provider has a receiving route of its own under this path, because each provider's notice
// is a different shape.
export const MICROSOFT_NOTICE_PATH = "/api/v1/calendar-sync/provider-notices/microsoft";
export const GOOGLE_NOTICE_PATH = "/api/v1/calendar-sync/provider-notices/google";

const NOTICE_PATHS: Readonly<Record<CalendarProvider, string>> = {
  microsoft: MICROSOFT_NOTICE_PATH,
  google: GOOGLE_NOTICE_PATH,
};

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === "/".charCodeAt(0)) end -= 1;
  return value.slice(0, end);
}

// Where the provider is told to send this account's notices, or undefined when this deployment has
// no public address a provider could reach. The firm and the connection are in the path because
// they say which account's object to ask; they prove nothing, and the object believes a notice
// only by its secret.
export function watchAddressFor(
  env: Pick<Bindings, "APP_BASE_URL">,
  identity: ConnectionIdentity,
  provider: CalendarProvider,
): string | undefined {
  const stated = trimTrailingSlashes(env.APP_BASE_URL ?? "");
  if (!stated.startsWith("https://")) return undefined;
  return `${stated}${NOTICE_PATHS[provider]}/${encodeURIComponent(identity.firmId)}/${encodeURIComponent(identity.connectionId)}`;
}

export function newWatchSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface KeepWatchInput {
  readonly port: CalendarSyncPort;
  readonly current: WatchState | null;
  readonly address: string | undefined;
  readonly now: () => Date;
  readonly newSecret: () => string;
}

// The watch as it should be remembered after this pass. Never throws and never fails a pass: a
// watch that could not be begun or renewed is tried again by the next pass, and until then the
// account is exactly as fast as it was before watches existed.
export async function keepWatch(input: KeepWatchInput): Promise<WatchState | null> {
  const { port, current, address } = input;
  const nowMs = input.now().getTime();

  if (address === undefined) {
    if (current !== null) await port.stopWatch(current.watchId);
    return null;
  }

  if (current !== null && current.address === address && current.attention !== "replace") {
    const left = Date.parse(current.expiresAt) - nowMs;
    if (current.attention === undefined && left > WATCH_RENEW_WHEN_LEFT_MS) return current;
    const renewed = await port.renewWatch(
      current.watchId,
      new Date(nowMs + WATCH_LIFETIME_MS).toISOString(),
    );
    // The provider could not answer. The watch is kept as it is while it still has time, and the
    // next pass asks again.
    if (!renewed.ok) return left > 0 ? current : null;
    if (renewed.value !== null) {
      return {
        watchId: renewed.value.watchId,
        secret: current.secret,
        expiresAt: renewed.value.expiresAt,
        address,
      };
    }
    // The provider no longer has it. Begin again below.
  } else if (current !== null) {
    await port.stopWatch(current.watchId);
  }

  const secret = input.newSecret();
  const begun = await port.watchChanges({
    address,
    secret,
    expiresAt: new Date(nowMs + WATCH_LIFETIME_MS).toISOString(),
  });
  if (!begun.ok) return null;
  return { watchId: begun.value.watchId, secret, expiresAt: begun.value.expiresAt, address };
}

function sameSecret(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

// What a batch of notices means for a watch: nothing when none of them carries its secret, and
// otherwise that a pass is wanted, with the watch marked where the provider said it needs
// attention.
export function readNotices(
  watch: WatchState,
  notices: readonly ProviderNotice[],
): { readonly watch: WatchState } | null {
  const believed = notices.filter((notice) => sameSecret(notice.secret, watch.secret));
  if (believed.length === 0) return null;
  const attention = believed.some((notice) => notice.lifecycle === "replace")
    ? "replace"
    : believed.some((notice) => notice.lifecycle === "renew")
      ? "renew"
      : watch.attention;
  return { watch: attention === undefined ? watch : { ...watch, attention } };
}
