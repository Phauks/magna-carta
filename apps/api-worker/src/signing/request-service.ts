import {
  guarded,
  type EffectStatement,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  MatterId,
  SigningRequestId,
  SigningSignerId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { AttributionLevel } from "@magna-carta/signing/esign";
import {
  send,
  voidRequest,
  type RequestSigner,
  type SigningFieldKind,
  type SigningOrder,
  type SigningRequestState,
} from "@magna-carta/signing/request";
import {
  MAXIMUM_FIELDS,
  MAXIMUM_SIGNERS,
  clearDraftStatements,
  insertEventStatement,
  insertFieldStatement,
  insertRequestStatement,
  insertSignerStatement,
  markRemindedStatement,
  markSentStatement,
  readEvents,
  readFields,
  readRequest,
  readSigners,
  updateDraftSettingsStatement,
  updateRequestStatusStatement,
  updateSignerStatusStatement,
  type SigningEventRow,
  type SigningFieldRow,
  type SigningRequestRow,
  type SigningSignerRow,
} from "./statements.ts";

// What a member does to a signing request: start a draft, save it, send it, remind, and cancel.
// Each returns the writes for the caller to commit, plus what the caller must do outside the database
// (whom to notify). The decision is the model's (./request.ts); this module reads, asks the model,
// and turns the answer into guarded writes, so a request that moved between the read and the commit
// is refused rather than overwritten.

/** How long a request waits for signatures unless the member says otherwise. */
export const DEFAULT_EXPIRY_DAYS = 30;
/** How often unsigned signers are reminded unless the member says otherwise. */
export const DEFAULT_REMIND_EVERY_DAYS = 3;
/** The longest a request may wait, so a link never outlives the reason it was sent. */
export const MAXIMUM_EXPIRY_DAYS = 120;

export const SIGNING_GUARD = {
  notDraft: "signing-request-not-draft",
  moved: "signing-request-moved",
} as const;

export interface ServiceOptions {
  readonly now: string;
  readonly actorUserId: UserId;
  /** The member's name, written as the actor on the activity lines they cause. */
  readonly actorName: string;
}

export class SigningRequestRefusal extends Error {
  readonly code: "not-found" | "not-draft" | "invalid" | "closed";
  constructor(code: SigningRequestRefusal["code"], message: string) {
    super(message);
    this.name = "SigningRequestRefusal";
    this.code = code;
  }
}

export interface SigningRequestDetail {
  readonly request: SigningRequestRow;
  readonly signers: readonly SigningSignerRow[];
  readonly fields: readonly SigningFieldRow[];
  readonly events: readonly SigningEventRow[];
}

export async function readRequestDetail(
  database: SqlDatabase,
  id: SigningRequestId,
): Promise<SigningRequestDetail | undefined> {
  const request = await readRequest(database, id);
  if (request === undefined) return undefined;
  const [signers, fields, events] = await Promise.all([
    readSigners(database, id),
    readFields(database, id),
    readEvents(database, id),
  ]);
  return { request, signers, fields, events };
}

/** The model's view of a stored request. */
export function stateOf(
  detail: Pick<SigningRequestDetail, "request" | "signers" | "fields">,
): SigningRequestState {
  return {
    status: detail.request.status,
    order: detail.request.signingOrder,
    expiresAt: detail.request.expiresAt,
    signers: detail.signers.map((signer): RequestSigner => ({
      id: signer.id,
      position: signer.position,
      name: signer.name,
      email: signer.email,
      attribution: signer.attributionLevel,
      ...(signer.userId === null ? {} : { userId: signer.userId }),
      status: signer.status,
    })),
    fields: detail.fields.map((field) => ({
      id: field.id,
      signerId: field.signerId,
      kind: field.kind,
      page: field.page,
      rect: field.rect,
      required: field.required,
    })),
  };
}

function addDays(instant: string, days: number): string {
  return new Date(Date.parse(instant) + days * 86_400_000).toISOString();
}

/** One activity line, stamped with a fresh id. */
export function event(
  requestId: SigningRequestId,
  kind: SigningEventRow["kind"],
  at: string,
  extra: Partial<
    Pick<SigningEventRow, "signerId" | "actor" | "observedIp" | "userAgent" | "detail">
  > = {},
): SigningEventRow {
  return {
    id: newIdentifier("signingEvent"),
    requestId,
    signerId: extra.signerId ?? null,
    kind,
    at,
    actor: extra.actor ?? null,
    observedIp: extra.observedIp ?? null,
    userAgent: extra.userAgent ?? null,
    detail: extra.detail ?? null,
  };
}

/** "Settlement Agreement.pdf" -> "Please sign: Settlement Agreement". */
export function defaultSubject(title: string): string {
  const dot = title.lastIndexOf(".");
  const stem = dot > 0 ? title.slice(0, dot) : title;
  return `Please sign: ${stem}`;
}

export function createDraft(
  database: SqlDatabase,
  input: {
    readonly matterId: MatterId;
    readonly fileId: FileId;
    readonly fileVersionId: FileVersionId;
    readonly title: string;
  },
  options: ServiceOptions,
): { readonly id: SigningRequestId; readonly effect: EffectWrite } {
  const id = newIdentifier("signingRequest");
  return {
    id,
    effect: {
      statements: [
        insertRequestStatement(database, {
          id,
          matterId: input.matterId,
          fileId: input.fileId,
          fileVersionId: input.fileVersionId,
          title: input.title,
          subject: defaultSubject(input.title),
          message: "",
          signingOrder: "in-order",
          expiresAt: addDays(options.now, DEFAULT_EXPIRY_DAYS),
          remindEveryDays: DEFAULT_REMIND_EVERY_DAYS,
          createdByUserId: options.actorUserId,
          createdAt: options.now,
        }),
        insertEventStatement(
          database,
          event(id, "created", options.now, { actor: options.actorName }),
        ),
      ],
      outboxMessages: [],
    },
  };
}

export interface DraftSigner {
  /** The caller's own handle for the signer, which its fields name. */
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly attribution: AttributionLevel;
  readonly userId?: UserId;
}

export interface DraftField {
  readonly signerKey: string;
  readonly kind: SigningFieldKind;
  readonly page: number;
  readonly rect: readonly [number, number, number, number];
  readonly required: boolean;
}

export interface DraftContents {
  readonly subject: string;
  readonly message: string;
  readonly order: SigningOrder;
  readonly expiresAt: string;
  readonly remindEveryDays: number | null;
  readonly signers: readonly DraftSigner[];
  readonly fields: readonly DraftField[];
}

/** Replace everything on a draft. Refused once it has been sent. */
export async function saveDraft(
  database: SqlDatabase,
  id: SigningRequestId,
  contents: DraftContents,
  options: ServiceOptions,
): Promise<EffectWrite> {
  const request = await readRequest(database, id);
  if (request === undefined) throw new SigningRequestRefusal("not-found", "No such request.");
  if (request.status !== "draft") {
    throw new SigningRequestRefusal("not-draft", "This request has already been sent.");
  }
  if (contents.signers.length > MAXIMUM_SIGNERS) {
    throw new SigningRequestRefusal(
      "invalid",
      `A request can name at most ${MAXIMUM_SIGNERS} signers.`,
    );
  }
  if (contents.fields.length > MAXIMUM_FIELDS) {
    throw new SigningRequestRefusal(
      "invalid",
      `A request can hold at most ${MAXIMUM_FIELDS} fields.`,
    );
  }
  const latest = addDays(options.now, MAXIMUM_EXPIRY_DAYS);
  if (!(Date.parse(contents.expiresAt) > Date.parse(options.now)) || contents.expiresAt > latest) {
    throw new SigningRequestRefusal(
      "invalid",
      `Choose an expiry after today and within ${MAXIMUM_EXPIRY_DAYS} days.`,
    );
  }
  const ids = new Map<string, SigningSignerId>();
  for (const signer of contents.signers) {
    if (ids.has(signer.key)) throw new SigningRequestRefusal("invalid", "Two signers share a key.");
    ids.set(signer.key, newIdentifier("signingSigner"));
  }
  const statements: EffectStatement[] = [
    guarded(
      updateDraftSettingsStatement(
        database,
        id,
        {
          subject: contents.subject.trim(),
          message: contents.message,
          signingOrder: contents.order,
          expiresAt: contents.expiresAt,
          remindEveryDays: contents.remindEveryDays,
        },
        options.now,
      ),
      SIGNING_GUARD.notDraft,
    ),
    ...clearDraftStatements(database, id),
  ];
  contents.signers.forEach((signer, index) => {
    statements.push(
      insertSignerStatement(
        database,
        {
          id: ids.get(signer.key) as SigningSignerId,
          requestId: id,
          position: index + 1,
          name: signer.name.trim(),
          email: signer.email.trim(),
          attributionLevel: signer.attribution,
          userId: signer.attribution === "firm-authenticated" ? (signer.userId ?? null) : null,
        },
        options.now,
      ),
    );
  });
  for (const field of contents.fields) {
    const signerId = ids.get(field.signerKey);
    if (signerId === undefined) {
      throw new SigningRequestRefusal(
        "invalid",
        "A field belongs to a signer who is not on the request.",
      );
    }
    statements.push(
      insertFieldStatement(
        database,
        {
          id: newIdentifier("signingField"),
          requestId: id,
          signerId,
          kind: field.kind,
          page: field.page,
          rect: field.rect,
          required: field.required,
        },
        options.now,
      ),
    );
  }
  return { statements, outboxMessages: [] };
}

/** Send a draft. The caller hashes the version's bytes and counts its pages, and notifies `notify`. */
export async function sendRequest(
  database: SqlDatabase,
  id: SigningRequestId,
  document: { readonly sha256: string; readonly pageCount: number },
  options: ServiceOptions,
): Promise<{ readonly effect: EffectWrite; readonly notify: readonly SigningSignerRow[] }> {
  const detail = await readRequestDetail(database, id);
  if (detail === undefined) throw new SigningRequestRefusal("not-found", "No such request.");
  const outcome = send(stateOf(detail), document.pageCount);
  if (!outcome.ok) {
    throw new SigningRequestRefusal(
      detail.request.status === "draft" ? "invalid" : "not-draft",
      outcome.reason,
    );
  }
  const notifyIds = new Set(outcome.notify.map((signer) => signer.id));
  const notify = detail.signers.filter((signer) => notifyIds.has(signer.id));
  const statements: EffectStatement[] = [
    guarded(markSentStatement(database, id, document.sha256, options.now), SIGNING_GUARD.notDraft),
    insertEventStatement(
      database,
      event(id, "sent", options.now, {
        actor: options.actorName,
        detail: `to ${detail.signers.length === 1 ? "1 signer" : `${detail.signers.length} signers`}`,
      }),
    ),
  ];
  statements.push(...deliveredStatements(database, id, notify, options.now));
  return { effect: { statements, outboxMessages: [] }, notify };
}

/** Each signer whose turn has come is marked asked, with an activity line saying how. */
export function deliveredStatements(
  database: SqlDatabase,
  id: SigningRequestId,
  notify: readonly SigningSignerRow[],
  now: string,
): EffectStatement[] {
  return notify.flatMap((signer) => [
    guarded(
      updateSignerStatusStatement(database, signer.id, "waiting", "notified", now),
      SIGNING_GUARD.moved,
    ),
    insertEventStatement(
      database,
      event(id, "delivered", now, {
        signerId: signer.id,
        actor: signer.name,
        detail: signer.attributionLevel === "firm-authenticated" ? "in the app" : signer.email,
      }),
    ),
  ]);
}

/** Cancel a request that is a draft or still out for signing. */
export async function cancelRequest(
  database: SqlDatabase,
  id: SigningRequestId,
  reason: string,
  options: ServiceOptions,
): Promise<{ readonly effect: EffectWrite; readonly told: readonly SigningSignerRow[] }> {
  const detail = await readRequestDetail(database, id);
  if (detail === undefined) throw new SigningRequestRefusal("not-found", "No such request.");
  const outcome = voidRequest(stateOf(detail));
  if (!outcome.ok) throw new SigningRequestRefusal("closed", outcome.reason);
  const told = detail.signers.filter(
    (signer) =>
      signer.status === "notified" || signer.status === "opened" || signer.status === "signed",
  );
  return {
    told,
    effect: {
      statements: [
        guarded(
          updateRequestStatusStatement(
            database,
            id,
            detail.request.status,
            "voided",
            options.now,
            reason.trim() === "" ? null : reason.trim(),
          ),
          SIGNING_GUARD.moved,
        ),
        insertEventStatement(
          database,
          event(id, "voided", options.now, { actor: options.actorName }),
        ),
      ],
      outboxMessages: [],
    },
  };
}

/** Remind every signer who has been asked and has not signed. */
export async function remindSigners(
  database: SqlDatabase,
  id: SigningRequestId,
  options: ServiceOptions,
): Promise<{ readonly effect: EffectWrite; readonly remind: readonly SigningSignerRow[] }> {
  const detail = await readRequestDetail(database, id);
  if (detail === undefined) throw new SigningRequestRefusal("not-found", "No such request.");
  if (detail.request.status !== "sent") {
    throw new SigningRequestRefusal(
      "closed",
      "Only a request still out for signing can be reminded.",
    );
  }
  const remind = detail.signers.filter(
    (signer) => signer.status === "notified" || signer.status === "opened",
  );
  const statements: EffectStatement[] = [
    guarded(markRemindedStatement(database, id, options.now), SIGNING_GUARD.moved),
  ];
  for (const signer of remind) {
    statements.push(
      insertEventStatement(
        database,
        event(id, "reminded", options.now, {
          signerId: signer.id,
          actor: options.actorName,
          detail: signer.attributionLevel === "firm-authenticated" ? signer.name : signer.email,
        }),
      ),
    );
  }
  return { effect: { statements, outboxMessages: [] }, remind };
}
