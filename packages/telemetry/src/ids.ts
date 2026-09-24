// The two telemetry-minted handles, wrapping @magna-carta/identifiers so there is ONE source for
// each — the RFC 9457 problem builder delegates errorId minting here rather than calling
// newIdentifier itself, so the prefix and the mint site cannot drift apart.
//   - correlation id (correlation_): created per request, rides every event and every problem response.
//   - error id (error_): minted when an error is captured; the public key joining a user-visible
//     failure to its redacted server trace.
import { makeCustomTokenGenerator, TOKEN_SIZE } from "@magna-carta/identifiers/token";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { ENTITY_PREFIXES } from "@magna-carta/identifiers/registry";
import type { CorrelationId, ErrorId } from "@magna-carta/identifiers/types";
import {
  serviceIdentity,
  SERVICE_CODE_LENGTH,
  SERVICE_CODES,
  type ServiceCode,
} from "./service-identity.ts";

export function newCorrelationId(): CorrelationId {
  return newIdentifier("correlation");
}

/*
 * An Error ID says WHEN it was minted and WHICH Worker minted it, in the id itself.
 *
 * The reason is the support path. A member quotes an id days later; whoever reads it has to decide
 * which Worker's logs to open and whether the window that held the record has already rolled out of
 * retention. Both facts are on the log record — and the log record is the thing being searched for,
 * so neither is available until the search has already succeeded. Putting them in the handle makes
 * the id answer the two questions that decide how to look for it, and makes it self-describing in a
 * filed issue long after the record is gone.
 *
 * THE BODY IS STILL EXACTLY TOKEN_SIZE CHARACTERS FROM THE SAME ALPHABET, and that is load-bearing
 * rather than tidy. The body shape is pinned in three places that know nothing about this file: the
 * per-entity validators in @magna-carta/identifiers/validate, the `pattern` emitted for every
 * identifier field in the OpenAPI document, and — most sharply — the telemetry scrubber's
 * whole-handle exemption in scrub.ts, which is what stops a token containing a digit run from being
 * rewritten to [scrubbed]. An Error ID the scrubber no longer recognises is an Error ID the
 * pipeline corrupts on the way out, which is the precise failure this handle exists to prevent. So
 * the fields are packed INTO the existing budget, not appended to it, and every previously minted
 * id stays well-formed.
 *
 *   error_ | mmmmmmmmm | sss     | rrrrrrrrr
 *          | 9 base36  | service | 9 base62
 *          | ms since  | code    | random
 *          | epoch     |         |
 *
 * Nine base36 characters hold milliseconds since the epoch out to the year 5187. Eight would have
 * been enough for a working lifetime and no longer: the range runs out in 2059, and the failure
 * would not have been a malformed id but a silently truncated one that decodes to a confident wrong
 * date. A test pins both ends of the range rather than trusting the arithmetic in this sentence,
 * which is how the 2059 cliff was found.
 *
 * Nine base62 characters is ~53 bits of randomness, well below the ~126 bits a minted entity handle
 * carries. That is deliberate and safe HERE and would not be anywhere else: an Error ID is a
 * correlation handle, shown to the member who caused it and quoted back to support. It grants
 * nothing, addresses no record, and guessing one buys an attacker a log line they already caused.
 * The unguessability bar belongs to handles that name resources, and those still mint the full
 * token. Do not reach for this shape for anything that authorizes.
 */

const TIMESTAMP_LENGTH = 9;
const RANDOM_LENGTH = TOKEN_SIZE - TIMESTAMP_LENGTH - SERVICE_CODE_LENGTH;

// Base62: the url-safe alphabet without `-` and `_`. Those two are what the scrubber's digit-run
// patterns key their word boundaries on, and dropping them costs under a bit over nine characters.
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const randomPart = makeCustomTokenGenerator(BASE62, RANDOM_LENGTH, cryptoRandomSource);

// Left-padded so a clock before 2059 cannot shorten the field and shift everything after it, and
// sliced so one after 5187 cannot lengthen it. Either would be a wrong answer rather than a
// malformed one, which is worse.
function timestampPart(milliseconds: number): string {
  return Math.max(0, Math.trunc(milliseconds))
    .toString(36)
    .padStart(TIMESTAMP_LENGTH, "0")
    .slice(-TIMESTAMP_LENGTH);
}

export function newErrorId(now: number = Date.now()): ErrorId {
  return `${ENTITY_PREFIXES.error}_${timestampPart(now)}${serviceIdentity()}${randomPart()}` as ErrorId;
}

/** What an Error ID says about itself: when it was minted, and by which Worker. */
export interface ErrorIdFacts {
  readonly mintedAt: Date;
  readonly service: ServiceCode;
}

/*
 * Read an Error ID's own account of itself, or null where it has none — an id minted before the
 * fields existed parses to a nonsense date, so the service code is checked against the registry and
 * a value that is not one is treated as "this id does not carry the fields" rather than guessed at.
 * Support reads these; a confidently wrong timestamp would send someone to the wrong window.
 */
export function describeErrorId(errorId: string): ErrorIdFacts | null {
  const prefix = `${ENTITY_PREFIXES.error}_`;
  if (!errorId.startsWith(prefix)) return null;
  const body = errorId.slice(prefix.length);
  if (body.length !== TOKEN_SIZE) return null;

  const service = body.slice(TIMESTAMP_LENGTH, TIMESTAMP_LENGTH + SERVICE_CODE_LENGTH);
  if (!Object.hasOwn(SERVICE_CODES, service)) return null;

  const milliseconds = Number.parseInt(body.slice(0, TIMESTAMP_LENGTH), 36);
  if (!Number.isFinite(milliseconds)) return null;

  return { mintedAt: new Date(milliseconds), service: service as ServiceCode };
}
