import type { ParsedMessage } from "@magna-carta/email";
import type {
  EmailMatterLinkId,
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { deriveDedupKey } from "./dedup.ts";
import type { DkimVerification } from "./dkim.ts";
import {
  normalizeAddress,
  toRecordRows,
  type CapturedVia,
  type EmailMessageRow,
  type EmailParticipantRow,
  type EmailThreadRow,
} from "./record.ts";
import { candidateParents, linkThread, type ThreadLookup } from "./thread.ts";
import { checkFilingConflict } from "./seams.ts";

// The verbatim original written to R2, content-addressed so re-capture is idempotent at the blob layer.
export interface PersistedOriginal {
  readonly originalR2Key: string;
  readonly contentSha256: string;
}

// The ports captureEmail orchestrates over. The worker consumer supplies the real implementations
// (the WASM parser, per-firm R2, the firm-scoped statements, Directory resolution); tests supply
// fakes. Keeping capture pure of those concretions is what lets both entrances converge on it.
export interface CapturePorts {
  parse(bytes: Uint8Array): Promise<ParsedMessage>;
  persistOriginal(bytes: Uint8Array): Promise<PersistedOriginal>;
  findByDedupKey(dedupKey: string): Promise<{ id: EmailMessageId; threadId: EmailThreadId } | null>;
  findThreadIdsByMessageIds(values: readonly string[]): Promise<Map<string, EmailThreadId>>;
  // Optional Directory enrichment: given the message's addresses, return normalized address → entity id
  // for the ones that resolve. Absent port or unresolved address → the participant is written null.
  resolveDirectoryEntities?(addresses: readonly string[]): Promise<Map<string, string>>;
  // Optional signature adjudication over the raw bytes. Absent (or throwing) leaves the record
  // unverified rather than failing the capture: a message the firm needs is never lost because a DNS
  // lookup was unavailable, and the verdict is informational either way.
  verifyDkim?(bytes: Uint8Array): Promise<DkimVerification>;
  newEmailMessageId(): EmailMessageId;
  newEmailThreadId(): EmailThreadId;
  newEmailParticipantId(): EmailParticipantId;
  newEmailMatterLinkId(): EmailMatterLinkId;
  now(): string;
  // Commit the capture atomically (thread + message + participants + link, or just the link + a touch
  // when the message already existed). The consumer wraps this in its idempotent batch.
  writeCapture(plan: CaptureWritePlan): Promise<void>;
}

export interface CaptureRequest {
  readonly bytes: Uint8Array;
  readonly firmId: string;
  readonly capturedVia: CapturedVia;
  // The candidate matter to link, or null for an unrouted catch-all capture (staff route it later).
  readonly matterId: MatterId | null;
  readonly linkedBy: UserId | null;
  // The API entrance, already authenticated to a matter with emails:file, may file in one step per firm
  // policy; the Email Worker entrance always lands staged.
  readonly acceptOnCapture: boolean;
}

export interface CaptureLinkPlan {
  readonly id: EmailMatterLinkId;
  readonly emailMessageId: EmailMessageId;
  readonly matterId: MatterId;
  readonly state: "staged" | "filed";
  readonly linkedBy: UserId | null;
  readonly linkedAt: string | null;
  readonly capturedVia: CapturedVia;
}

// What the consumer commits in one batch. On a dedup hit the message/thread/participants are absent and
// `touchMessageId` records the re-confirmation instead; the link is always attempted (a second filer
// adds a link, never a second message).
export interface CaptureWritePlan {
  readonly dedupState: "new" | "existing";
  readonly thread: EmailThreadRow | null;
  readonly message: EmailMessageRow | null;
  readonly participants: readonly EmailParticipantRow[];
  readonly touchMessageId: EmailMessageId | null;
  readonly link: CaptureLinkPlan | null;
  // Where this capture landed, stated outright rather than left to be reassembled from the rows
  // above: on a dedup hit `message` and `thread` are both null, so a consumer that wants to report
  // the outcome of the job it just ran has nothing to read the identity off otherwise.
  readonly emailMessageId: EmailMessageId;
  readonly threadId: EmailThreadId;
}

export interface CaptureResult {
  readonly emailMessageId: EmailMessageId;
  readonly threadId: EmailThreadId;
  readonly dedupState: "new" | "existing";
  readonly linkState: "staged" | "filed" | "none";
  // The parsed message, returned so the consumer can extract attachments without a second parse. Only
  // a newly-captured message needs extraction; a dedup hit already has its documents.
  readonly parsed: ParsedMessage;
  readonly shouldExtractAttachments: boolean;
}

// The single convergent capture operation both entrances (forward/CC Email Worker and the authenticated
// API) call. Parse once, persist the verbatim original, dedup on the derived key, link the thread DAG,
// map the record rows, and commit — staging the matter link (or filing it in one step for the API
// entrance). A re-capture of a message the firm already holds adds only a link and never a second row.
export async function captureEmail(
  request: CaptureRequest,
  ports: CapturePorts,
): Promise<CaptureResult> {
  const parsed = await ports.parse(request.bytes);
  const persisted = await ports.persistOriginal(request.bytes);
  const { key: dedupKey } = await deriveDedupKey(parsed);
  const now = ports.now();

  const existing = await ports.findByDedupKey(dedupKey);

  let emailMessageId: EmailMessageId;
  let threadId: EmailThreadId;
  let dedupState: "new" | "existing";
  let thread: EmailThreadRow | null = null;
  let message: EmailMessageRow | null = null;
  let participants: readonly EmailParticipantRow[] = [];

  if (existing !== null) {
    emailMessageId = existing.id;
    threadId = existing.threadId;
    dedupState = "existing";
  } else {
    emailMessageId = ports.newEmailMessageId();
    dedupState = "new";
    const parents = candidateParents(parsed);
    const knownThreads = await ports.findThreadIdsByMessageIds(parents);
    const lookup: ThreadLookup = (value) => knownThreads.get(value);
    const threadLink = linkThread(parsed, lookup, ports.newEmailThreadId());
    threadId = threadLink.threadId;
    const directoryEntityIdByAddress = await resolveDirectory(parsed, ports);
    const dkim = await adjudicateDkim(request.bytes, parsed, ports);
    const rows = toRecordRows(parsed, {
      emailMessageId,
      threadId,
      isNewThread: threadLink.isNewThread,
      dedupKey,
      contentSha256: persisted.contentSha256,
      originalR2Key: persisted.originalR2Key,
      capturedVia: request.capturedVia,
      receivedAt: now,
      mintParticipantId: () => ports.newEmailParticipantId(),
      directoryEntityIdByAddress,
      dkim,
    });
    thread = rows.thread;
    message = rows.message;
    participants = rows.participants;
  }

  // Filing to a matter traverses the conflict/ethical-wall hook. A conflict holds the link at staged
  // for review rather than auto-filing — the structural guardrail against the wrong-matter mass-file
  // failure mode. The hook is a no-op today (always "no conflict"); the engine drops in behind it.
  let linkState: "staged" | "filed" = request.acceptOnCapture ? "filed" : "staged";
  if (request.matterId !== null && linkState === "filed") {
    const conflict = checkFilingConflict({
      firmId: request.firmId,
      matterId: request.matterId,
      emailMessageId,
      participantAddresses: participantAddresses(parsed),
    });
    if (conflict.hasConflict) linkState = "staged";
  }

  const link: CaptureLinkPlan | null =
    request.matterId === null
      ? null
      : {
          id: ports.newEmailMatterLinkId(),
          emailMessageId,
          matterId: request.matterId,
          state: linkState,
          linkedBy: request.linkedBy,
          linkedAt: linkState === "filed" ? now : null,
          capturedVia: request.capturedVia,
        };

  await ports.writeCapture({
    dedupState,
    thread,
    message,
    participants,
    touchMessageId: dedupState === "existing" ? emailMessageId : null,
    link,
    emailMessageId,
    threadId,
  });

  return {
    emailMessageId,
    threadId,
    dedupState,
    linkState: link === null ? "none" : link.state,
    parsed,
    shouldExtractAttachments: dedupState === "new",
  };
}

// Collect every address on the message and ask the Directory resolver for the ones it knows. Missing
// resolver or a firm with no contact-details corpus yet → an empty map, and every participant is
// written with a null entity id (the graceful degradation the record model is built for).
async function resolveDirectory(
  parsed: ParsedMessage,
  ports: CapturePorts,
): Promise<Map<string, string> | undefined> {
  if (ports.resolveDirectoryEntities === undefined) return undefined;
  const addresses = new Set<string>();
  for (const group of [parsed.from, parsed.to, parsed.cc, parsed.bcc]) {
    for (const entry of group) {
      if (entry.address !== null) addresses.add(normalizeAddress(entry.address));
    }
  }
  if (addresses.size === 0) return undefined;
  return ports.resolveDirectoryEntities([...addresses]);
}

// Adjudicate the message's DKIM signatures, if a verifier is wired. Two degradations are deliberate:
// a `.msg` export carries no RFC 5322 octets to canonicalize, so it can only ever be `noRawMessage`;
// and a verifier that throws (a resolver outage, a runtime without a primitive) records that the
// question could not be put rather than propagating and losing the capture. Recording an honest
// "unverified" beats failing to file a message the firm needs.
async function adjudicateDkim(
  bytes: Uint8Array,
  parsed: ParsedMessage,
  ports: CapturePorts,
): Promise<DkimVerification | undefined> {
  if (ports.verifyDkim === undefined) return undefined;
  if (parsed.sourceFormat === "msg") {
    return {
      verdict: "unverified",
      reason: "noRawMessage",
      signingDomain: null,
      selector: null,
      bodyFullyCovered: false,
      signedHeaderNames: [],
    };
  }
  try {
    return await ports.verifyDkim(bytes);
  } catch {
    return {
      verdict: "unverified",
      reason: "dnsTemporaryFailure",
      signingDomain: null,
      selector: null,
      bodyFullyCovered: false,
      signedHeaderNames: [],
    };
  }
}

// The distinct participant addresses on the message, for the filing-time conflict hook.
function participantAddresses(parsed: ParsedMessage): string[] {
  const addresses = new Set<string>();
  for (const group of [parsed.from, parsed.to, parsed.cc, parsed.bcc]) {
    for (const entry of group) {
      if (entry.address !== null) addresses.add(normalizeAddress(entry.address));
    }
  }
  return [...addresses];
}
