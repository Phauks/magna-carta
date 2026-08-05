import type { Address, ParsedMessage, SourceFormat } from "@magna-carta/email";
import type {
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
} from "@magna-carta/identifiers/types";
import type { DkimVerdict, DkimVerdictReason, DkimVerification } from "./dkim.ts";
import { normalizeSubject } from "./thread.ts";

// Which entrance recorded a capture. `sync` is placed now for the later slice that fills it; the
// forward path, the authenticated API, and the add-in posting to that API are what is written today.
export type CapturedVia = "forward" | "api" | "addin" | "sync";

export type MessageIdProvenance = "header" | "mapi" | "absent";
export type { DkimVerdict, DkimVerdictReason };
export type ParticipantKind = "from" | "to" | "cc" | "bcc";

// The email_message row shape (a subset of columns; created_at/updated_at are set by the writer). The
// verbatim DKIM/Authentication-Results/Received facts ride `integrity` as serialized JSON, exactly as
// the parse engine surfaced them; the adjudication of those facts is the separate `dkim*` columns, so
// the evidence and the verdict over it never get confused for one another.
export interface EmailMessageRow {
  readonly id: EmailMessageId;
  readonly messageIdValue: string | null;
  readonly messageIdProvenance: MessageIdProvenance;
  readonly subject: string | null;
  readonly sentAt: string | null;
  readonly receivedAt: string;
  readonly fromDisplay: string | null;
  readonly fromAddress: string | null;
  readonly threadId: EmailThreadId;
  readonly inReplyTo: string | null;
  readonly contentSha256: string;
  readonly dedupKey: string;
  readonly originalR2Key: string;
  readonly referencesRemoteContent: boolean;
  readonly integrity: string;
  readonly dkimVerdict: DkimVerdict;
  // Why the verdict is what it is, and — on a pass — whose signature carried it. Null when nothing has
  // adjudicated the message yet, which is a different state from "adjudicated and inconclusive".
  readonly dkimVerdictReason: DkimVerdictReason | null;
  readonly dkimVerifiedDomain: string | null;
  readonly sourceFormat: SourceFormat;
  readonly capturedVia: CapturedVia;
}

export interface EmailThreadRow {
  readonly id: EmailThreadId;
  readonly subjectNormalized: string | null;
  readonly firstSeenAt: string;
}

export interface EmailParticipantRow {
  readonly id: EmailParticipantId;
  readonly emailMessageId: EmailMessageId;
  readonly kind: ParticipantKind;
  readonly displayName: string | null;
  readonly address: string | null;
  readonly directoryEntityId: string | null;
}

// The typed total mapping from one parsed message to its record rows. The message + thread row +
// participant rows are produced here; attachment rows are produced later in the consumer, once the
// File Manager has minted each document's file id.
export interface RecordRows {
  readonly message: EmailMessageRow;
  // Present only when this capture opened a new thread; a reply that joined an existing thread has none.
  readonly thread: EmailThreadRow | null;
  readonly participants: readonly EmailParticipantRow[];
}

// Everything the pure mapping needs that it cannot read off the parsed message: the minted ids, the
// dedup/thread decisions, the content hash and R2 key computed by the writer, the capture clock, and
// the optional Directory resolution (normalized address → entity id; absent → left null, the graceful
// degradation the record model is built for).
export interface RecordContext {
  readonly emailMessageId: EmailMessageId;
  readonly threadId: EmailThreadId;
  readonly isNewThread: boolean;
  readonly dedupKey: string;
  readonly contentSha256: string;
  readonly originalR2Key: string;
  readonly capturedVia: CapturedVia;
  readonly receivedAt: string;
  readonly mintParticipantId: () => EmailParticipantId;
  readonly directoryEntityIdByAddress?: ReadonlyMap<string, string>;
  // The signature adjudication, when a verifier ran. Absent leaves the row unverified with no reason —
  // the state a message is in when nothing has looked at it.
  readonly dkim?: DkimVerification;
}

export function toRecordRows(message: ParsedMessage, context: RecordContext): RecordRows {
  const primaryFrom = message.from[0] ?? null;
  const messageRow: EmailMessageRow = {
    id: context.emailMessageId,
    messageIdValue: message.messageIdentifier.value,
    messageIdProvenance: message.messageIdentifier.provenance,
    subject: message.subject,
    sentAt: parseSentAt(message.dateRaw),
    receivedAt: context.receivedAt,
    fromDisplay: primaryFrom?.displayName ?? null,
    fromAddress: primaryFrom?.address ?? null,
    threadId: context.threadId,
    inReplyTo: message.inReplyTo,
    contentSha256: context.contentSha256,
    dedupKey: context.dedupKey,
    originalR2Key: context.originalR2Key,
    referencesRemoteContent: message.referencesRemoteContent,
    integrity: JSON.stringify(message.integrity),
    dkimVerdict: context.dkim?.verdict ?? "unverified",
    dkimVerdictReason: context.dkim?.reason ?? null,
    // Only a passing signature names a domain: recording the claimed `d=` of a signature that failed
    // would read as an attribution the cryptography did not support.
    dkimVerifiedDomain: context.dkim?.verdict === "pass" ? context.dkim.signingDomain : null,
    sourceFormat: message.sourceFormat,
    capturedVia: context.capturedVia,
  };

  const thread: EmailThreadRow | null = context.isNewThread
    ? {
        id: context.threadId,
        subjectNormalized: normalizeSubject(message.subject),
        firstSeenAt: context.receivedAt,
      }
    : null;

  const participants: EmailParticipantRow[] = [];
  const addParticipants = (kind: ParticipantKind, addresses: readonly Address[]): void => {
    for (const address of addresses) {
      participants.push({
        id: context.mintParticipantId(),
        emailMessageId: context.emailMessageId,
        kind,
        displayName: address.displayName,
        address: address.address,
        directoryEntityId: resolveDirectoryEntityId(address.address, context),
      });
    }
  };
  addParticipants("from", message.from);
  addParticipants("to", message.to);
  addParticipants("cc", message.cc);
  addParticipants("bcc", message.bcc);

  return { message: messageRow, thread, participants };
}

// trim + lowercase — the same normalization the Directory reverse lookup keys on, so a resolver map
// built from `findEntitiesByEmailAddress` lines up with the participant addresses here.
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function resolveDirectoryEntityId(address: string | null, context: RecordContext): string | null {
  if (address === null || context.directoryEntityIdByAddress === undefined) return null;
  return context.directoryEntityIdByAddress.get(normalizeAddress(address)) ?? null;
}

// The Date header as an ISO-8601 instant, or null when absent/unparseable. `sent_at` is a best-effort
// record of what the sender claimed; `received_at` (the capture clock) is the authoritative instant.
function parseSentAt(dateRaw: string | null): string | null {
  if (dateRaw === null) return null;
  const parsed = new Date(dateRaw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
