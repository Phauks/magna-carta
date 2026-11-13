/*
 * The verbs of a bill, decided once.
 *
 * EVERY OPERATION LIVES IN THE INVOICE WINDOW. The window's bottom bar carries the acts that change
 * the document — finalize, void, adjust, record a delivery, print, export — and its money tab
 * carries the acts that move money against it. The list keeps only the two verbs that belong to a
 * list: open the thing, and copy its number. Anything else offered from a row would be a second
 * place to learn where an act lives, and the two would drift.
 *
 * ONE ACTION BAR, FIXED GEOMETRY. Every invoice state renders its actions in the same place at the
 * same size. Within a state, an act the bill refuses is DISABLED WITH THE REASON, never absent, so
 * the bar never jumps as a reader moves between bills. That is why `invoiceBarActions` returns a
 * state's whole set rather than filtering it down to what happens to be possible.
 *
 * THREE KINDS OF "CANNOT", AND THEY READ DIFFERENTLY.
 *   - A STATE refusal: this bill cannot take this verb (a finalized bill is not voided).
 *   - A PERMISSION refusal: this account may not take it. Named by the capability the route names,
 *     because a firm administrator has to know which one to grant.
 *   - A DEPENDENCY: nobody can yet, because the thing it needs is not built. It carries the Soon
 *     mark and stays on screen, so the shape of what is coming is visible and unmistakable.
 * All three leave the verb rendered. A verb that disappears teaches a reader that the menu has a
 * mind of its own.
 */
import Ban from "@lucide/svelte/icons/ban";
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import FileMinus from "@lucide/svelte/icons/file-minus";
import HandCoins from "@lucide/svelte/icons/hand-coins";
import Printer from "@lucide/svelte/icons/printer";
import Receipt from "@lucide/svelte/icons/receipt";
import Send from "@lucide/svelte/icons/send";
import Shield from "@lucide/svelte/icons/shield";
import SquarePen from "@lucide/svelte/icons/square-pen";
import Stamp from "@lucide/svelte/icons/stamp";
import Undo2 from "@lucide/svelte/icons/undo-2";

// The MODEL module, not the catalogue's index: the index also exports the rendering component, and
// pulling a Svelte component into a pure catalogue drags the whole UI runtime behind it.
import {
  menuOf,
  type RecordMenuAction,
  type RecordMenuModel,
} from "$lib/records/record-menu-model.ts";
import { BILLING_PERMISSIONS } from "./billing-api.ts";
import { billUnpaidMinor, matterUnpaidMinor, type InvoiceRow } from "./invoice-standing.ts";
import { permissionRefusal } from "$lib/access/refusal.ts";

/** Every act the register and the invoice window can offer. Surfaces switch on the identifier. */
export type BillActionIdentifier =
  | "open"
  | "copyNumber"
  | "finalize"
  | "voidDraft"
  | "adjust"
  | "recordDelivery"
  | "applyTrust"
  | "recordPayment"
  | "applyClientCredit"
  | "writeOff"
  | "creditNote"
  | "print"
  | "exportLedes";

export interface BillActionContext {
  /**
   * The matter the register is standing in, or null on the firm's own register.
   *
   * NULL MEANS THIS SURFACE READS AND DOES NOT ACT, and every verb that writes says so rather than
   * disappearing. Two reasons converge on the same answer. Some of these acts are a MATTER'S by
   * nature — a firm applies a client's trust funds to what one matter was charged, writes off what
   * one matter still owes, and credits one matter's lines — and none of them has a meaning without
   * one. The rest simply live where the work does: a bill is finalized, voided or recorded as
   * delivered from the matter whose work it claims, which is also where the reader who does it is
   * standing. Refused, a verb tells somebody where the act lives; absent, it teaches them the menu
   * has a mind of its own, and an enabled control on a screen with no dialog behind it is worse
   * than either.
   */
  readonly matterId: string | null;
  /**
   * The capabilities the session holds, or null where they have not been read. Null means nothing
   * is refused on permission grounds — the server still refuses, in its own words, and inventing a
   * refusal from an unread answer would hide verbs an account actually holds.
   */
  readonly permissions: readonly string[] | null;
  /** An open client credit this bill could be set against, or null where the client has none. */
  readonly openClientCreditMinor: number | null;
  /** How an amount reads, for the sentences that quote one. */
  readonly money: (amountMinor: number) => string;
}

/** What each not-yet-served act waits on, as the noun phrase the Soon composition completes. */
export const BILL_DEPENDENCIES = {
  payment:
    "the payments slice, whose first step is the manually recorded receipt — a cheque, wire, cash " +
    "or terminal payment",
  print: "the invoice artifact: the render model is served, but no renderer consumes it yet",
  ledes: "the LEDES export path and the guideline validation that goes with it",
  adjustment:
    "the revised billing model — a finalized bill with nothing applied becomes adjustable with a " +
    "recorded revision, which the accepted finalized-is-immutable decision has to be revised for " +
    "before the line-edit and revision routes exist",
  applications:
    "a read of what has been applied to a bill, which the invoice detail does not carry yet",
  claims: "a read of the claims a draft is holding, which the invoice detail does not carry yet",
  history: "an endpoint that serves an invoice's recorded events",
  reminders: "the billing automations slice, where reminder schedules and payment plans live",
} as const;

function lacks(context: BillActionContext, capability: string): boolean {
  return context.permissions !== null && !context.permissions.includes(capability);
}

/**
 * Whether a finalized bill can still be adjusted.
 *
 * The rule is the owner's: a finalized invoice with NO payment applied can be corrected, and the
 * edit lands as a numbered, reasoned revision — the number never changes. The moment ANY payment or
 * trust application lands, the bill locks and the correction path is the credit note beside it.
 */
export function isAdjustable(row: InvoiceRow): boolean {
  return row.summary.status === "final" && row.summary.appliedMinor === 0;
}

/** Why adjusting is offered or refused, in the sentence the control carries either way. */
export function adjustReason(row: InvoiceRow): string {
  if (row.summary.status !== "final") {
    return "Only a finalized bill can be adjusted. A draft can simply be edited.";
  }
  if (isAdjustable(row)) {
    return (
      "Change a line's wording or its amount. The edit is recorded as a visible revision and the " +
      "number never changes."
    );
  }
  return "A payment has been applied to this bill, so it's locked. To correct it, add a credit note.";
}

/**
 * The verbs for one bill, in the order they are met.
 *
 * Order is deliberate and does not change with the bill's state: a reader who has learned where
 * Credit Note sits finds it in the same place on every bill that can take one.
 */
export function billActions(
  row: InvoiceRow,
  context: BillActionContext,
): readonly RecordMenuAction[] {
  const invoice = row.summary;
  const isDraft = invoice.status === "draft";
  const isFinal = invoice.status === "final";
  const unpaid = isFinal ? billUnpaidMinor(row) : 0;
  const matterId = context.matterId;
  const matterUnpaid = matterId === null ? 0 : (matterUnpaidMinor(row, matterId) ?? 0);
  /** The one refusal every act that WRITES shares on the firm's register. */
  const noMatterHere = matterId === null ? "Open the bill from its matter to act on it." : null;
  const detailUnread = row.detail === null;
  const standingWord = isDraft ? "a draft" : invoice.status === "void" ? "a voided draft" : "final";

  const actions: RecordMenuAction[] = [
    {
      kind: "action",
      identifier: "open",
      label: "Open Bill",
      icon: Receipt,
    },
  ];

  actions.push({
    kind: "action",
    identifier: "copyNumber",
    label:
      invoice.invoiceNumber === null
        ? "Copy Bill Number"
        : `Copy Invoice Number: ${invoice.invoiceNumber}`,
    icon: Copy,
    ...(invoice.invoiceNumber === null
      ? { disabledReason: "A draft has no number until it's finalized." }
      : {}),
  });

  actions.push({
    kind: "action",
    identifier: "finalize",
    label: "Finalize…",
    icon: Stamp,
    ...(noMatterHere !== null
      ? { disabledReason: noMatterHere }
      : !isDraft
        ? { disabledReason: `Only a draft can be finalized. This bill is ${standingWord}.` }
        : lacks(context, BILLING_PERMISSIONS.finalize)
          ? { disabledReason: permissionRefusal("Finalizing a bill", BILLING_PERMISSIONS.finalize) }
          : detailUnread
            ? { disabledReason: "This draft's lines have not been read yet." }
            : {}),
  });

  actions.push({
    kind: "action",
    identifier: "voidDraft",
    label: "Void Draft…",
    icon: Ban,
    ...(noMatterHere !== null
      ? { disabledReason: noMatterHere }
      : !isDraft
        ? {
            disabledReason:
              "Only a draft can be voided. To correct a finalized bill, add a credit note.",
          }
        : lacks(context, BILLING_PERMISSIONS.draft)
          ? { disabledReason: permissionRefusal("Voiding a draft bill", BILLING_PERMISSIONS.draft) }
          : {}),
  });

  /*
   * Adjusting is designed and settled and has no route: the accepted billing model says a finalized
   * bill is immutable, and revising that is a decision the routes wait on. It renders where it
   * belongs, marked, rather than being left out of a bar the owner settled the shape of.
   */
  actions.push({
    kind: "action",
    identifier: "adjust",
    label: "Adjust Bill…",
    icon: SquarePen,
    ...(isAdjustable(row)
      ? { soonDependency: BILL_DEPENDENCIES.adjustment }
      : { disabledReason: adjustReason(row) }),
  });

  actions.push({
    kind: "action",
    identifier: "recordDelivery",
    label: "Record Delivery…",
    icon: Send,
    ...(noMatterHere !== null
      ? { disabledReason: noMatterHere }
      : !isFinal
        ? { disabledReason: "Only a finalized bill can be delivered." }
        : lacks(context, BILLING_PERMISSIONS.draft)
          ? { disabledReason: permissionRefusal("Recording delivery", BILLING_PERMISSIONS.draft) }
          : {}),
  });

  actions.push({
    kind: "action",
    identifier: "applyTrust",
    label: "Apply Trust Funds…",
    icon: Shield,
    ...(noMatterHere !== null
      ? { disabledReason: noMatterHere }
      : !isFinal
        ? { disabledReason: "Only a finalized bill takes an application." }
        : unpaid <= 0
          ? { disabledReason: "This bill is settled: there is nothing left to apply against." }
          : lacks(context, BILLING_PERMISSIONS.apply)
            ? {
                disabledReason: permissionRefusal(
                  "Applying trust funds",
                  BILLING_PERMISSIONS.apply,
                ),
              }
            : {}),
  });

  actions.push({
    kind: "action",
    identifier: "recordPayment",
    label: "Record Payment",
    icon: Receipt,
    soonDependency: BILL_DEPENDENCIES.payment,
  });

  const openCredit = context.openClientCreditMinor;
  actions.push({
    kind: "action",
    identifier: "applyClientCredit",
    label:
      openCredit === null || openCredit <= 0
        ? "Apply Client Credit"
        : `Apply Client Credit (${context.money(openCredit)})`,
    icon: HandCoins,
    // The scope refusal leads, because outside a matter the credits were never read: saying the
    // client holds none would be a claim this surface cannot make.
    ...(noMatterHere !== null
      ? { disabledReason: noMatterHere }
      : openCredit === null || openCredit <= 0
        ? { disabledReason: "The client holds no open credit." }
        : !isFinal || unpaid <= 0
          ? { disabledReason: "Nothing is owed on this bill." }
          : lacks(context, BILLING_PERMISSIONS.apply)
            ? {
                disabledReason: permissionRefusal("Recording a payment", BILLING_PERMISSIONS.apply),
              }
            : {}),
  });

  actions.push({
    kind: "action",
    identifier: "writeOff",
    label: "Write Off…",
    icon: FileMinus,
    ...(noMatterHere !== null
      ? { disabledReason: noMatterHere }
      : matterUnpaid <= 0
        ? { disabledReason: "This matter owes nothing on this bill." }
        : lacks(context, BILLING_PERMISSIONS.credit)
          ? {
              disabledReason: permissionRefusal(
                "Writing off a balance",
                BILLING_PERMISSIONS.credit,
              ),
            }
          : {}),
  });

  actions.push({
    kind: "action",
    identifier: "creditNote",
    label: "Credit Note…",
    icon: Undo2,
    // A credit note credits one matter's LINES, so it is anchored the same way the write-off is.
    ...(noMatterHere !== null
      ? { disabledReason: noMatterHere }
      : !isFinal
        ? {
            disabledReason:
              "A finalized bill is corrected with a credit note. A draft can simply be edited.",
          }
        : lacks(context, BILLING_PERMISSIONS.credit)
          ? {
              disabledReason: permissionRefusal(
                "Recording a credit note",
                BILLING_PERMISSIONS.credit,
              ),
            }
          : {}),
  });

  actions.push({
    kind: "action",
    identifier: "print",
    label: "Print / PDF",
    icon: Printer,
    soonDependency: BILL_DEPENDENCIES.print,
  });

  actions.push({
    kind: "action",
    identifier: "exportLedes",
    label: "Export LEDES",
    icon: Download,
    soonDependency: BILL_DEPENDENCIES.ledes,
  });

  return actions;
}

/** One act out of the catalogue, by name. */
export function billAction(
  actions: readonly RecordMenuAction[],
  identifier: BillActionIdentifier,
): RecordMenuAction | null {
  return actions.find((action) => action.identifier === identifier) ?? null;
}

/**
 * The action bar's contents for one bill, in the one order the bar draws them.
 *
 * The set is chosen by the invoice's own state, and everything in the set renders — an act this
 * bill refuses is disabled with its reason. That is what makes the bar's geometry fixed: a reader
 * moving from a settled bill to an unpaid one finds the same controls in the same places.
 */
export function invoiceBarActions(
  row: InvoiceRow,
  context: BillActionContext,
): readonly RecordMenuAction[] {
  const actions = billActions(row, context);
  const wanted: BillActionIdentifier[] =
    row.summary.status === "draft"
      ? ["finalize", "voidDraft"]
      : row.summary.status === "final"
        ? ["adjust", "recordDelivery", "print", "exportLedes"]
        : [];
  return wanted
    .map((identifier) => billAction(actions, identifier))
    .filter((action): action is RecordMenuAction => action !== null);
}

/**
 * The money acts, which live in the invoice window's Payments & Credits tab and nowhere else.
 *
 * They are the dangerous ones — money leaving a client's trust ledger, a balance given up, a
 * correction recorded forever — so they sit behind an opened invoice rather than one row-click away
 * on a list.
 */
export function invoiceMoneyActions(
  row: InvoiceRow,
  context: BillActionContext,
): readonly RecordMenuAction[] {
  const actions = billActions(row, context);
  const wanted: BillActionIdentifier[] = [
    "applyTrust",
    "recordPayment",
    "applyClientCredit",
    "writeOff",
    "creditNote",
  ];
  return wanted
    .map((identifier) => billAction(actions, identifier))
    .filter((action): action is RecordMenuAction => action !== null);
}

/**
 * The verbs of a bill as the ROW MENU draws them.
 *
 * Two groups and no more: open it and copy its number, then the four acts a firm reaches for
 * straight off a list. Everything else — the money, the artifact, the correction — is in the window,
 * because that is where the reader can see what they are acting on.
 */
export function billRecordMenu(row: InvoiceRow, context: BillActionContext): RecordMenuModel {
  const actions = billActions(row, context);
  const at = (identifier: BillActionIdentifier): RecordMenuAction | null =>
    billAction(actions, identifier);

  return menuOf([
    { identifier: "record", items: [at("open"), at("copyNumber")] },
    { identifier: "draft", items: [at("finalize"), at("voidDraft")] },
    { identifier: "final", items: [at("recordDelivery"), at("applyTrust")] },
  ]);
}
