import type { ParsedMessage } from "@magna-carta/email";
import type {
  EmailAutoFileRuleId,
  EmailMatterLinkId,
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { AutoFileDecision } from "./auto-file-rules.ts";
import { deriveDedupKey } from "./dedup.ts";
import type { DkimVerdict, DkimVerification } from "./dkim.ts";
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

// What the auto-file evidence gatherer is told about the capture in front of it. Everything here is a
// fact the capture core already holds; the gatherer's job is to turn it into the firm-scoped reads the
// guardrail function needs, never to re-parse the message.
export interface AutoFileEvaluationRequest {
  readonly firmId: string;
  readonly emailMessageId: EmailMessageId;
  readonly threadId: EmailThreadId;
  readonly dedupState: "new" | "existing";
  readonly capturedVia: CapturedVia;
  // The normalized `From` address, or null when the message carries no parseable sender. It is the
  // match value a correspondent rule is looked up by.
  readonly fromAddress: string | null;
  readonly subject: string | null;
  readonly dkimVerdict: DkimVerdict;
  readonly dkimVerifiedDomain: string | null;
  readonly dkimBodyFullyCovered: boolean;
  // Ask the filing-time conflict/ethical-wall hook about one candidate matter. Supplied by the capture
  // core so the hook keeps ONE call site: the gatherer reports the hook's real answer for the matter
  // that would actually be filed, and the same answer decides the link state below — a rule can no
  // more reach `filed` past a hold than a person's accept can.
  readonly conflictHoldFor: (matterId: MatterId) => boolean;
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
  // Optional auto-file evaluation, consulted only for a capture no entrance routed. The port gathers
  // the evidence with firm-scoped reads and returns the pure guardrail function's decision. An absent
  // port means no rules, which is exactly the behaviour before rules existed; a port that throws is
  // caught and degrades to that same behaviour, because a capture is never lost over a rule.
  resolveAutoFileDecision?(request: AutoFileEvaluationRequest): Promise<AutoFileDecision>;
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
  // Null means a person put this message on this matter. Non-null names the rule that did, which is
  // the fact every "why is this here" read starts from and the one the undo feedback counts against.
  readonly autoFileRuleId: EmailAutoFileRuleId | null;
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
  // What the rules decided, for the consumer to record in the evaluation ledger IN THIS SAME BATCH —
  // so a ledger row can never claim a decision whose link rolled back, and a redelivery replays the
  // recorded decision rather than deciding again. Null when no port was wired.
  readonly autoFileDecision: AutoFileDecision | null;
}

export interface CaptureResult {
  readonly emailMessageId: EmailMessageId;
  readonly threadId: EmailThreadId;
  readonly dedupState: "new" | "existing";
  // The matter the capture landed on — the entrance's, or the one a rule chose. Null when nothing
  // routed it.
  readonly matterId: MatterId | null;
  readonly linkState: "staged" | "filed" | "none";
  readonly autoFileDecision: AutoFileDecision | null;
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
  let dkim: DkimVerification | undefined;

  if (existing !== null) {
    emailMessageId = existing.id;
    threadId = existing.threadId;
    dedupState = "existing";
    // A message the firm already holds still needs its signature adjudicated when rules may act on
    // this capture, because the shipped message row records the verdict but not whether the signature
    // covered the whole body — and a partially-covered pass is exactly what a sender-identity rule
    // must decline. Asking the verifier again is cheaper than storing the answer, and it only happens
    // where a rule could actually fire.
    if (request.matterId === null && ports.resolveAutoFileDecision !== undefined) {
      dkim = await adjudicateDkim(request.bytes, parsed, ports);
    }
  } else {
    emailMessageId = ports.newEmailMessageId();
    dedupState = "new";
    const parents = candidateParents(parsed);
    const knownThreads = await ports.findThreadIdsByMessageIds(parents);
    const lookup: ThreadLookup = (value) => knownThreads.get(value);
    const threadLink = linkThread(parsed, lookup, ports.newEmailThreadId());
    threadId = threadLink.threadId;
    const directoryEntityIdByAddress = await resolveDirectory(parsed, ports);
    dkim = await adjudicateDkim(request.bytes, parsed, ports);
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

  // The filing-time conflict/ethical-wall hook, asked at most once per candidate matter. Memoized
  // because two callers ask it here — the auto-file gatherer, so the ledger records the true reason a
  // firing landed staged, and the promotion gate below — and the hook must give one answer per
  // capture. It is a no-op today (always "no conflict"); the conflicts engine drops in behind it and
  // protects the automatic and the manual path identically with no call-site change.
  const conflictHoldByMatter = new Map<string, boolean>();
  const conflictHoldFor = (matterId: MatterId): boolean => {
    const cached = conflictHoldByMatter.get(matterId);
    if (cached !== undefined) return cached;
    const held = checkFilingConflict({
      firmId: request.firmId,
      matterId,
      emailMessageId,
      participantAddresses: participantAddresses(parsed),
    }).hasConflict;
    conflictHoldByMatter.set(matterId, held);
    return held;
  };

  // Auto-file rules are consulted only where nothing routed the capture — the firm catch-all and the
  // unrouted forward, which is where mail lands today with no matter at all and a person has to go
  // find one. An entrance that already resolved a matter has answered the routing question with
  // better evidence than a rule has (a credential naming that matter, or an authenticated member
  // choosing it), so a rule is not invited to second-guess it.
  let matterId = request.matterId;
  let autoFileRuleId: EmailAutoFileRuleId | null = null;
  let autoFileDecision: AutoFileDecision | null = null;
  let linkState: "staged" | "filed" = request.acceptOnCapture ? "filed" : "staged";

  if (matterId === null && ports.resolveAutoFileDecision !== undefined) {
    autoFileDecision = await evaluateAutoFile(ports, {
      firmId: request.firmId,
      emailMessageId,
      threadId,
      dedupState,
      capturedVia: request.capturedVia,
      fromAddress: senderAddress(parsed),
      subject: parsed.subject,
      dkimVerdict: dkim?.verdict ?? "unverified",
      dkimVerifiedDomain: dkim?.verdict === "pass" ? dkim.signingDomain : null,
      dkimBodyFullyCovered: dkim?.bodyFullyCovered ?? false,
      conflictHoldFor,
    });
    if (
      autoFileDecision !== null &&
      autoFileDecision.outcome !== "noRule" &&
      autoFileDecision.matterId !== null
    ) {
      matterId = autoFileDecision.matterId as MatterId;
      autoFileRuleId = autoFileDecision.ruleId as EmailAutoFileRuleId | null;
      linkState = autoFileDecision.outcome === "file" ? "filed" : "staged";
    }
  }

  // Filing to a matter traverses the conflict/ethical-wall hook. A conflict holds the link at staged
  // for review rather than filing — the structural guardrail against the wrong-matter mass-file
  // failure mode, and the reason no path to `filed` in this function skips this gate.
  if (matterId !== null && linkState === "filed" && conflictHoldFor(matterId)) {
    linkState = "staged";
  }

  const link: CaptureLinkPlan | null =
    matterId === null
      ? null
      : {
          id: ports.newEmailMatterLinkId(),
          emailMessageId,
          matterId,
          state: linkState,
          linkedBy: request.linkedBy,
          linkedAt: linkState === "filed" ? now : null,
          capturedVia: request.capturedVia,
          autoFileRuleId,
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
    autoFileDecision,
  });

  return {
    emailMessageId,
    threadId,
    dedupState,
    matterId,
    linkState: link === null ? "none" : link.state,
    autoFileDecision,
    parsed,
    shouldExtractAttachments: dedupState === "new",
  };
}

// Run the auto-file port, or degrade to what the capture did before rules existed. A gatherer that
// throws — an unreachable per-firm read, a malformed row — must never cost the firm the message, so
// the throw is swallowed here and the capture continues exactly as an absent port would leave it.
async function evaluateAutoFile(
  ports: CapturePorts,
  request: AutoFileEvaluationRequest,
): Promise<AutoFileDecision | null> {
  try {
    return (await ports.resolveAutoFileDecision?.(request)) ?? null;
  } catch {
    return null;
  }
}

// The message's normalized sender, which is what a correspondent rule matches on. Null when the
// message declares no parseable `From` — a rule that files on who sent the message has nothing to
// stand on there, and the guardrails read the absence as no match rather than as a wildcard.
function senderAddress(parsed: ParsedMessage): string | null {
  for (const entry of parsed.from) {
    if (entry.address !== null) return normalizeAddress(entry.address);
  }
  return null;
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
