/*
 * The verbs of a bill, decided once.
 *
 * The register offers the same acts in two places — the row menu and the details panel beside the
 * table — and the two must never disagree about which of them a given bill can take, or about why
 * one is refused. So the answer is a pure function over the bill and who is asking, and both
 * surfaces render what it says.
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
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import FileMinus from "@lucide/svelte/icons/file-minus";
import HandCoins from "@lucide/svelte/icons/hand-coins";
import Printer from "@lucide/svelte/icons/printer";
import Receipt from "@lucide/svelte/icons/receipt";
import Send from "@lucide/svelte/icons/send";
import Shield from "@lucide/svelte/icons/shield";
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

/** Every act the register can offer. The identifiers are what a surface switches on. */
export type BillActionIdentifier =
  | "open"
  | "copyNumber"
  | "finalize"
  | "voidDraft"
  | "recordDelivery"
  | "applyTrust"
  | "recordPayment"
  | "applyClientCredit"
  | "writeOff"
  | "creditNote"
  | "print"
  | "exportLedes";

export interface BillActionContext {
  /** The matter the register is standing in: the trust ceiling and the write-off are its own. */
  readonly matterId: string;
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

/** What the payments slice, the invoice artifact and the LEDES path each wait on. */
export const BILL_DEPENDENCIES = {
  payment:
    "the payments slice, whose first step is the manually recorded receipt — a cheque, wire, cash " +
    "or terminal payment",
  print: "the invoice artifact: the render model is served, but no renderer consumes it yet",
  ledes: "the LEDES export path and the guideline validation that goes with it",
  applications:
    "a read of what has been applied to a bill, which the invoice detail does not carry yet",
  claims: "a read of the claims a draft is holding, which the invoice detail does not carry yet",
} as const;

function lacks(context: BillActionContext, capability: string): boolean {
  return context.permissions !== null && !context.permissions.includes(capability);
}

function permissionRefusal(capability: string): string {
  return `This account does not hold the ${capability} capability.`;
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
  const matterUnpaid = matterUnpaidMinor(row, context.matterId) ?? 0;
  const detailUnread = row.detail === null;

  const actions: RecordMenuAction[] = [
    {
      kind: "action",
      identifier: "open",
      label: "Open Details",
      icon: ChevronRight,
    },
  ];

  if (invoice.invoiceNumber !== null) {
    actions.push({
      kind: "action",
      identifier: "copyNumber",
      label: `Copy Invoice Number: ${invoice.invoiceNumber}`,
      icon: Copy,
    });
  }

  if (isDraft) {
    actions.push({
      kind: "action",
      identifier: "finalize",
      label: "Finalize…",
      icon: Stamp,
      ...(lacks(context, BILLING_PERMISSIONS.finalize)
        ? { disabledReason: permissionRefusal(BILLING_PERMISSIONS.finalize) }
        : detailUnread
          ? { disabledReason: "This draft's lines have not been read yet." }
          : {}),
    });
    actions.push({
      kind: "action",
      identifier: "voidDraft",
      label: "Void Draft…",
      icon: Ban,
      ...(lacks(context, BILLING_PERMISSIONS.draft)
        ? { disabledReason: permissionRefusal(BILLING_PERMISSIONS.draft) }
        : {}),
    });
  }

  if (isFinal) {
    actions.push({
      kind: "action",
      identifier: "recordDelivery",
      label: "Record Delivery…",
      icon: Send,
      ...(lacks(context, BILLING_PERMISSIONS.draft)
        ? { disabledReason: permissionRefusal(BILLING_PERMISSIONS.draft) }
        : {}),
    });
    actions.push({
      kind: "action",
      identifier: "applyTrust",
      label: "Apply Trust Funds…",
      icon: Shield,
      ...(unpaid <= 0
        ? { disabledReason: "This bill is settled: there is nothing left to apply against." }
        : lacks(context, BILLING_PERMISSIONS.apply)
          ? { disabledReason: permissionRefusal(BILLING_PERMISSIONS.apply) }
          : {}),
    });
    actions.push({
      kind: "action",
      identifier: "recordPayment",
      label: "Record Payment",
      icon: Receipt,
      soonDependency: BILL_DEPENDENCIES.payment,
    });
    if (context.openClientCreditMinor !== null && context.openClientCreditMinor > 0) {
      actions.push({
        kind: "action",
        identifier: "applyClientCredit",
        label: `Apply Client Credit (${context.money(context.openClientCreditMinor)})`,
        icon: HandCoins,
        ...(unpaid <= 0
          ? {
              disabledReason:
                "This bill is settled: there is nothing left to set a credit against.",
            }
          : lacks(context, BILLING_PERMISSIONS.apply)
            ? { disabledReason: permissionRefusal(BILLING_PERMISSIONS.apply) }
            : {}),
      });
    }
    actions.push({
      kind: "action",
      identifier: "writeOff",
      label: "Write Off…",
      icon: FileMinus,
      ...(matterUnpaid <= 0
        ? { disabledReason: "This matter owes nothing on this bill." }
        : lacks(context, BILLING_PERMISSIONS.credit)
          ? { disabledReason: permissionRefusal(BILLING_PERMISSIONS.credit) }
          : {}),
    });
    actions.push({
      kind: "action",
      identifier: "creditNote",
      label: "Credit Note…",
      icon: Undo2,
      ...(lacks(context, BILLING_PERMISSIONS.credit)
        ? { disabledReason: permissionRefusal(BILLING_PERMISSIONS.credit) }
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
  }

  return actions;
}

/** The verbs of a bill, grouped the way the row menu draws them. */
export function billRecordMenu(row: InvoiceRow, context: BillActionContext): RecordMenuModel {
  const actions = billActions(row, context);
  const at = (identifier: BillActionIdentifier): RecordMenuAction | null =>
    actions.find((action) => action.identifier === identifier) ?? null;

  return menuOf([
    { identifier: "record", items: [at("open"), at("copyNumber")] },
    {
      identifier: "money",
      items: [
        at("recordDelivery"),
        at("applyTrust"),
        at("recordPayment"),
        at("applyClientCredit"),
        at("writeOff"),
        at("creditNote"),
      ],
    },
    { identifier: "artifact", items: [at("print"), at("exportLedes")] },
    { identifier: "draft", items: [at("finalize"), at("voidDraft")] },
  ]);
}
