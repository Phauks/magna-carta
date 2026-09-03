/*
 * A way to reach someone, as it is drafted and as it is listed.
 *
 * The KIND comes first and decides the fields: an email is an address and a use; a telephone and a
 * fax are a country, a number, an extension and a use, and fax is its own kind rather than a
 * flavour of telephone, because whether a line answers with a fax tone is what a delivery path asks;
 * an address is its lines and what it is used for. Each kind checks its own shape before the row can
 * be added, by the same rules the API applies, so a refusal never arrives after the fact.
 *
 * The LIST is one line per contact point, whatever its kind: the kind as a glyph, the value formatted,
 * the use beside it, the record's marks after. Three tables, one per channel, each with its own
 * heading, was the previous shape; it spent a screen on what fits in four rows.
 */
import { EMAIL_ADDRESS_REFUSAL, isEmailAddress } from "@magna-carta/directory/email-address";
import type { CountryCode } from "libphonenumber-js/min";
import type {
  DirectoryAddressType,
  DirectoryAddressUse,
  DirectoryContactPointState,
  DirectoryContactPoints,
  DirectoryContactUse,
} from "./directory-api.ts";
import { addressLines, addressUseLabel, contactUseLabel } from "./directory-vocabulary.ts";
import { checkPhoneEntry, DEFAULT_PHONE_REGION, formatStoredPhone } from "./phone-entry.ts";

export type ContactKind = "email" | "telephone" | "fax" | "address";

export const CONTACT_KINDS: readonly { value: ContactKind; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "telephone", label: "Telephone" },
  { value: "fax", label: "Fax" },
  { value: "address", label: "Address" },
];

export function contactKindLabel(kind: ContactKind): string {
  return CONTACT_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

/** What a telephone is used for. Mobile first: it is the number most people give. */
export const TELEPHONE_USES: readonly { value: DirectoryContactUse; label: string }[] = [
  { value: "mobile", label: "Mobile" },
  { value: "work", label: "Work" },
  { value: "home", label: "Home" },
  { value: "other", label: "Other" },
];

export const FAX_USES: readonly { value: DirectoryContactUse; label: string }[] = [
  { value: "work", label: "Office" },
  { value: "home", label: "Home" },
  { value: "other", label: "Other" },
];

export interface EmailDraft {
  readonly kind: "email";
  readonly address: string;
  readonly use: DirectoryContactUse;
}

export interface NumberDraft {
  readonly kind: "telephone" | "fax";
  readonly region: CountryCode;
  /** As typed, in the country's national form; checkContactDraft turns it into the stored form. */
  readonly number: string;
  readonly extension: string;
  readonly use: DirectoryContactUse;
}

export interface AddressDraft {
  readonly kind: "address";
  readonly street: string;
  readonly streetTwo: string;
  readonly city: string;
  readonly region: string;
  readonly postal: string;
  /** Two-letter country code. */
  readonly country: string;
  readonly use: DirectoryAddressUse;
  readonly type: DirectoryAddressType;
}

export type ContactDraft = EmailDraft | NumberDraft | AddressDraft;

export function emptyContactDraft(kind: ContactKind): ContactDraft {
  switch (kind) {
    case "email":
      return { kind, address: "", use: "work" };
    case "telephone":
      return { kind, region: DEFAULT_PHONE_REGION, number: "", extension: "", use: "mobile" };
    case "fax":
      return { kind, region: DEFAULT_PHONE_REGION, number: "", extension: "", use: "work" };
    case "address":
      return {
        kind,
        street: "",
        streetTwo: "",
        city: "",
        region: "",
        postal: "",
        country: DEFAULT_PHONE_REGION,
        use: "business",
        type: "physical",
      };
  }
}

/** Whether anything has been typed into the draft. A blank draft has nothing to lose. */
export function contactDraftStarted(draft: ContactDraft): boolean {
  switch (draft.kind) {
    case "email":
      return draft.address.trim() !== "";
    case "telephone":
    case "fax":
      return draft.number.trim() !== "" || draft.extension.trim() !== "";
    case "address":
      return [draft.street, draft.streetTwo, draft.city, draft.region, draft.postal].some(
        (part) => part.trim() !== "",
      );
  }
}

/** One sentence naming what the draft still needs, or null when it can be added. */
export function contactDraftRefusal(draft: ContactDraft): string | null {
  switch (draft.kind) {
    case "email":
      return isEmailAddress(draft.address) ? null : EMAIL_ADDRESS_REFUSAL;
    case "telephone":
    case "fax": {
      const checked = checkPhoneEntry(draft.region, draft.number);
      return checked.ok ? null : checked.reason;
    }
    case "address":
      return draft.street.trim() === "" && draft.city.trim() === "" ? "A street or a city." : null;
  }
}

/** The create request's three arrays, from the drafts, in the shape each add route takes. */
export interface ContactRequests {
  readonly emails: {
    address: string;
    contactUse: DirectoryContactUse;
  }[];
  readonly phones: {
    number: string;
    contactSystem: "voice" | "fax";
    contactUse: DirectoryContactUse;
    extension: string | null;
    countryRegionCode: string;
  }[];
  readonly addresses: {
    street: string | null;
    streetTwo: string | null;
    city: string | null;
    region: string | null;
    postal: string | null;
    country: string | null;
    addressUse: DirectoryAddressUse;
    addressType: DirectoryAddressType;
  }[];
}

function part(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function contactRequestsFrom(drafts: readonly ContactDraft[]): ContactRequests {
  const requests: ContactRequests = { emails: [], phones: [], addresses: [] };
  for (const draft of drafts) {
    switch (draft.kind) {
      case "email":
        requests.emails.push({ address: draft.address.trim(), contactUse: draft.use });
        break;
      case "telephone":
      case "fax": {
        const checked = checkPhoneEntry(draft.region, draft.number);
        if (!checked.ok) continue;
        requests.phones.push({
          number: checked.number,
          contactSystem: draft.kind === "fax" ? "fax" : "voice",
          contactUse: draft.use,
          extension: part(draft.extension),
          countryRegionCode: checked.region,
        });
        break;
      }
      case "address":
        requests.addresses.push({
          street: part(draft.street),
          streetTwo: part(draft.streetTwo),
          city: part(draft.city),
          region: part(draft.region),
          postal: part(draft.postal),
          country: part(draft.country),
          addressUse: draft.use,
          addressType: draft.type,
        });
        break;
    }
  }
  return requests;
}

/** One line of the list, whatever the kind. */
export interface ContactRow {
  readonly id: string;
  readonly kind: ContactKind;
  /** The value, formatted for reading: the address, the number in its form, the address on one line. */
  readonly value: string;
  /** What it is used for, beside the value. */
  readonly use: string | null;
  readonly state: DirectoryContactPointState;
  readonly isPrimary: boolean;
}

/** The record's contact points as one list: emails, then numbers, then addresses. */
export function contactRowsFrom(points: DirectoryContactPoints): readonly ContactRow[] {
  const rows: ContactRow[] = [];
  for (const email of points.emails) {
    rows.push({
      id: email.id,
      kind: "email",
      value: email.address,
      use: email.contactUse === null ? null : contactUseLabel(email.contactUse),
      state: email.state,
      isPrimary: email.isPrimary,
    });
  }
  for (const phone of points.phones) {
    const kind: ContactKind = phone.contactSystem === "fax" ? "fax" : "telephone";
    const use = phone.contactUse === null ? null : contactUseLabel(phone.contactUse);
    rows.push({
      id: phone.id,
      kind,
      value: formatStoredPhone(phone),
      use: kind === "fax" && use !== null ? `${use} fax` : use,
      state: phone.state,
      isPrimary: phone.isPrimary,
    });
  }
  for (const address of points.addresses) {
    rows.push({
      id: address.id,
      kind: "address",
      value: addressLines(address).join(", "),
      use: address.addressUse === null ? null : addressUseLabel(address.addressUse),
      state: address.state,
      isPrimary: address.isPrimary,
    });
  }
  return rows;
}

/** A drafted contact point, listed the way a recorded one is, so the dialog's list reads as the pane's. */
export function contactRowFromDraft(draft: ContactDraft, id: string): ContactRow {
  const state: DirectoryContactPointState = {
    permitted: true,
    preferred: false,
    note: null,
    verificationStatus: "unverified",
    verifiedAt: null,
    verificationDetail: null,
  };
  switch (draft.kind) {
    case "email":
      return {
        id,
        kind: "email",
        value: draft.address.trim(),
        use: contactUseLabel(draft.use),
        state,
        isPrimary: false,
      };
    case "telephone":
    case "fax": {
      const checked = checkPhoneEntry(draft.region, draft.number);
      const value = checked.ok
        ? formatStoredPhone({
            number: checked.number,
            countryRegionCode: checked.region,
            extension: part(draft.extension),
          })
        : draft.number;
      const use = contactUseLabel(draft.use);
      return {
        id,
        kind: draft.kind,
        value,
        use: draft.kind === "fax" ? `${use} fax` : use,
        state,
        isPrimary: false,
      };
    }
    case "address":
      return {
        id,
        kind: "address",
        value: addressLines({
          recipient: null,
          organizationName: null,
          street: part(draft.street),
          streetTwo: part(draft.streetTwo),
          dependentLocality: null,
          city: part(draft.city),
          region: part(draft.region),
          postal: part(draft.postal),
          sortingCode: null,
          country: part(draft.country),
        }).join(", "),
        use: addressUseLabel(draft.use),
        state,
        isPrimary: false,
      };
  }
}
