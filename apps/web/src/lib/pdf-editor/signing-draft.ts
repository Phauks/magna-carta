/*
 * A signing request as the PDF Editor edits it before it is sent: who signs, how each proves who
 * they are, and the boxes each completes on the pages.
 *
 * The draft lives on this screen until it is saved, and is saved whole: the server replaces what the
 * draft held, so there is no partial state to reconcile. Whether a draft can be SENT is decided on
 * the server, which names what is missing; this module only keeps the screen from offering a send
 * that cannot work at all.
 */
import type { PdfPageSize } from "$lib/documents/pdf-pages.ts";
import type { SaveSigningDraftRequest, SigningRequestDetail } from "./signing-api.ts";

export type FieldKind = SaveSigningDraftRequest["fields"][number]["kind"];
export type Attribution = SaveSigningDraftRequest["signers"][number]["attribution"];
export type SigningOrder = SaveSigningDraftRequest["order"];

/** A rect in PDF points from the page's bottom left: left, bottom, right, top. */
export type PointRect = readonly [number, number, number, number];

export interface DraftSigner {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly attribution: Attribution;
  readonly userId?: string;
}

export interface DraftField {
  readonly key: string;
  readonly signerKey: string;
  readonly kind: FieldKind;
  /** Counted from 1, as the engine and the server count pages. */
  readonly page: number;
  readonly rect: PointRect;
  readonly required: boolean;
}

export interface SigningDraft {
  readonly subject: string;
  readonly message: string;
  readonly order: SigningOrder;
  /** The last day the request can be signed, as YYYY-MM-DD in the member's own zone. */
  readonly expiresOn: string;
  readonly remindEveryDays: number | null;
  readonly signers: readonly DraftSigner[];
  readonly fields: readonly DraftField[];
}

/** The palette, in the order the mockup shows it. */
export const FIELD_KINDS: readonly { readonly kind: FieldKind; readonly label: string }[] = [
  { kind: "signature", label: "Signature" },
  { kind: "initials", label: "Initials" },
  { kind: "date-signed", label: "Date Signed" },
  { kind: "full-name", label: "Full Name" },
  { kind: "text", label: "Text" },
  { kind: "checkbox", label: "Checkbox" },
];

export function fieldLabel(kind: FieldKind): string {
  return FIELD_KINDS.find((one) => one.kind === kind)?.label ?? kind;
}

/** The size a field takes when dropped with a click, in points. */
const DEFAULT_SIZE: Record<FieldKind, readonly [number, number]> = {
  signature: [180, 36],
  initials: [60, 30],
  "date-signed": [110, 20],
  "full-name": [160, 20],
  text: [160, 20],
  checkbox: [14, 14],
};

/** The ways of proving identity this build offers, as the screen names and explains them. */
export const ATTRIBUTIONS: readonly {
  readonly value: Attribution;
  readonly label: string;
  readonly detail: string;
}[] = [
  { value: "email-link", label: "Emailed Link", detail: "Anyone who opens the email can sign" },
  {
    value: "access-code",
    label: "Link and Email Code",
    detail: "Also needs a one-time code sent by email",
  },
  { value: "firm-authenticated", label: "Signed In to the Firm", detail: "Firm members only" },
];

export function attributionLabel(value: string): string {
  return ATTRIBUTIONS.find((one) => one.value === value)?.label ?? value;
}

/**
 * Each signer's colour on the page, by position. Status tokens, because the page is otherwise
 * black and white and the colours have to tell signers apart at a glance; danger is left out so a
 * signer's box never reads as an error.
 */
export const SIGNER_TONES: readonly { readonly box: string; readonly chip: string }[] = [
  {
    box: "border-accent-default bg-accent-subtle/70",
    chip: "bg-accent-strong text-accent-strong-foreground",
  },
  {
    box: "border-status-info bg-status-info-subtle/70",
    chip: "bg-status-info text-status-info-foreground",
  },
  {
    box: "border-status-success bg-status-success-subtle/70",
    chip: "bg-status-success text-status-success-foreground",
  },
  {
    box: "border-status-warning bg-status-warning-subtle/70",
    chip: "bg-status-warning text-status-warning-foreground",
  },
];

export function toneOf(index: number): (typeof SIGNER_TONES)[number] {
  return (
    SIGNER_TONES[index % SIGNER_TONES.length] ?? (SIGNER_TONES[0] as (typeof SIGNER_TONES)[number])
  );
}

/** "Jordan Smith" -> "JS", for the chip on a box too small for a name. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** A field of `kind` centred on a point of the page, kept inside the page. */
export function fieldAt(
  kind: FieldKind,
  centre: { readonly x: number; readonly y: number },
  page: PdfPageSize,
): PointRect {
  const [width, height] = DEFAULT_SIZE[kind];
  const left = Math.min(Math.max(0, centre.x - width / 2), Math.max(0, page.widthPt - width));
  const bottom = Math.min(Math.max(0, centre.y - height / 2), Math.max(0, page.heightPt - height));
  return [
    left,
    bottom,
    Math.min(page.widthPt, left + width),
    Math.min(page.heightPt, bottom + height),
  ];
}

/** Today plus `days`, as YYYY-MM-DD in the member's own zone. */
export function dayAfter(days: number, from: Date = new Date()): string {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

/** The end of a day in the member's own zone, as the instant the server stores. */
export function endOfDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, 23, 59, 59).toISOString();
}

/** The draft a stored request holds, keyed for this screen. */
export function draftFromDetail(detail: SigningRequestDetail): SigningDraft {
  const expires = new Date(detail.expiresAt);
  return {
    subject: detail.subject,
    message: detail.message,
    order: detail.order,
    expiresOn: dayAfter(0, expires),
    remindEveryDays: detail.remindEveryDays,
    signers: detail.signers.map((signer) => ({
      key: signer.id,
      name: signer.name,
      email: signer.email,
      attribution: signer.attribution,
      ...(signer.userId === null ? {} : { userId: signer.userId }),
    })),
    fields: detail.fields.map((field) => ({
      key: field.id,
      signerKey: field.signerId,
      kind: field.kind,
      page: field.page,
      rect: [field.rect[0], field.rect[1], field.rect[2], field.rect[3]],
      required: field.required,
    })),
  };
}

/** What the server is sent to save the draft. */
export function draftRequest(draft: SigningDraft): SaveSigningDraftRequest {
  return {
    subject: draft.subject.trim() === "" ? "Please sign" : draft.subject.trim(),
    message: draft.message,
    order: draft.order,
    expiresAt: endOfDay(draft.expiresOn),
    remindEveryDays: draft.remindEveryDays,
    signers: draft.signers.map((signer) => ({
      key: signer.key,
      name: signer.name,
      email: signer.attribution === "firm-authenticated" ? "" : signer.email,
      attribution: signer.attribution,
      ...(signer.userId === undefined ? {} : { userId: signer.userId }),
    })),
    fields: draft.fields.map((field) => ({
      signerKey: field.signerKey,
      kind: field.kind,
      page: field.page,
      rect: [field.rect[0], field.rect[1], field.rect[2], field.rect[3]],
      required: field.required,
    })),
  };
}

/** How many fields each signer has, by key. */
export function fieldCounts(draft: SigningDraft): Map<string, number> {
  const counts = new Map<string, number>();
  for (const field of draft.fields)
    counts.set(field.signerKey, (counts.get(field.signerKey) ?? 0) + 1);
  return counts;
}

/** Remove a signer and every field they held. */
export function withoutSigner(draft: SigningDraft, key: string): SigningDraft {
  return {
    ...draft,
    signers: draft.signers.filter((signer) => signer.key !== key),
    fields: draft.fields.filter((field) => field.signerKey !== key),
  };
}

/** Move a signer one place earlier or later in the order. */
export function moveSigner(draft: SigningDraft, key: string, by: -1 | 1): SigningDraft {
  const index = draft.signers.findIndex((signer) => signer.key === key);
  const target = index + by;
  if (index < 0 || target < 0 || target >= draft.signers.length) return draft;
  const signers = [...draft.signers];
  const [moved] = signers.splice(index, 1);
  if (moved !== undefined) signers.splice(target, 0, moved);
  return { ...draft, signers };
}
