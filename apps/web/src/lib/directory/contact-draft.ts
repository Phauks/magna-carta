/*
 * A way to reach someone, as it is drafted and as it is listed.
 *
 * The KIND comes first and decides the fields: an email is an address and a use; a telephone and a
 * fax are a country, a number, an extension and a use, and fax is its own kind rather than a
 * flavour of telephone, because whether a line answers with a fax tone is what a delivery path asks;
 * an address is its lines and what it is used for. Each kind checks its own shape before the row can
 * be added, by the same rules the API applies, so a refusal never arrives after the fact.
 *
 * A POSTAL ADDRESS IS ONE OF THE KINDS HERE AND IT IS ENTERED SOMEWHERE ELSE. It belongs in this
 * module because it is a contact point on the record and shares every one of a contact point's
 * facts — the permission, the preference, the verification, the channel default. It is entered on
 * its own section because it is not one field: it is a form of six to nine boxes whose shape is the
 * country's, and squeezing that under a kind dropdown beside a one-line email made the kinds look
 * alike when only one of them is a form. Both halves are here so a screen never has to decide.
 *
 * The LIST is one line per contact point, whatever its kind: the kind as a glyph, the value formatted,
 * the use beside it, the record's marks after. Three tables, one per channel, each with its own
 * heading, was the previous shape; it spent a screen on what fits in four rows.
 */
import { EMAIL_ADDRESS_REFUSAL, isEmailAddress } from "@magna-carta/directory/email-address";
import type { CountryCode } from "libphonenumber-js/min";
import type {
  DirectoryAddressEntry,
  DirectoryAddressType,
  DirectoryAddressUse,
  DirectoryContactPointState,
  DirectoryContactPoints,
  DirectoryContactUse,
  DirectoryEmailEntry,
  DirectoryPhoneEntry,
} from "./directory-api.ts";
import type { updateDirectoryContactPoint } from "./directory-api.ts";
import { addressLines, addressUseLabel, contactUseLabel } from "./directory-vocabulary.ts";
import {
  checkPhoneEntry,
  DEFAULT_PHONE_REGION,
  formatStoredPhone,
  nationalFormOf,
} from "./phone-entry.ts";

export type ContactKind = "email" | "telephone" | "fax" | "address";

export const CONTACT_KINDS: readonly { value: ContactKind; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "telephone", label: "Telephone" },
  { value: "fax", label: "Fax" },
  { value: "address", label: "Address" },
];

/** The kinds the one-line Contact section enters. An address has a form and a section of its own. */
export const REACHABLE_KINDS: readonly { value: ContactKind; label: string }[] =
  CONTACT_KINDS.filter((entry) => entry.value !== "address");

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

/**
 * A postal address as it is drafted: the WHOLE international field set, not the American subset.
 *
 * Every line the record can hold is here, because which of them a country uses is the address
 * form's business (`@magna-carta/design-system/address-fields`) and not this draft's. A draft that
 * carried only street, city, region and postal could not hold a Brazilian neighbourhood or a French
 * CEDEX at all, so the form could offer the box and the value would be dropped on its way out.
 */
export interface AddressDraft {
  readonly kind: "address";
  readonly recipient: string;
  readonly organizationName: string;
  readonly street: string;
  readonly streetTwo: string;
  readonly dependentLocality: string;
  readonly city: string;
  readonly region: string;
  readonly postal: string;
  readonly sortingCode: string;
  /** Two-letter country code. The field that decides what every field above is called. */
  readonly country: string;
  readonly use: DirectoryAddressUse;
  readonly type: DirectoryAddressType;
}

export type ContactDraft = EmailDraft | NumberDraft | AddressDraft;

/** The address lines, in the order an address is written. The country is not one of them: it is
 * always set, so a draft carrying only a country holds no address yet. */
const ADDRESS_PARTS = [
  "recipient",
  "organizationName",
  "street",
  "streetTwo",
  "dependentLocality",
  "city",
  "region",
  "postal",
  "sortingCode",
] as const;

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
        recipient: "",
        organizationName: "",
        street: "",
        streetTwo: "",
        dependentLocality: "",
        city: "",
        region: "",
        postal: "",
        sortingCode: "",
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
      return ADDRESS_PARTS.some((part) => draft[part].trim() !== "");
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
      // One line of it is enough. An address a firm holds half of is still the address it holds,
      // and refusing it sends it into a note where no envelope and no duplicate check can reach it.
      return ADDRESS_PARTS.some((part) => draft[part].trim() !== "")
        ? null
        : "At least one line of the address.";
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
    recipient: string | null;
    organizationName: string | null;
    street: string | null;
    streetTwo: string | null;
    dependentLocality: string | null;
    city: string | null;
    region: string | null;
    postal: string | null;
    sortingCode: string | null;
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
          recipient: part(draft.recipient),
          organizationName: part(draft.organizationName),
          street: part(draft.street),
          streetTwo: part(draft.streetTwo),
          dependentLocality: part(draft.dependentLocality),
          city: part(draft.city),
          region: part(draft.region),
          postal: part(draft.postal),
          sortingCode: part(draft.sortingCode),
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
          recipient: part(draft.recipient),
          organizationName: part(draft.organizationName),
          street: part(draft.street),
          streetTwo: part(draft.streetTwo),
          dependentLocality: part(draft.dependentLocality),
          city: part(draft.city),
          region: part(draft.region),
          postal: part(draft.postal),
          sortingCode: part(draft.sortingCode),
          country: part(draft.country),
        }).join(", "),
        use: addressUseLabel(draft.use),
        state,
        isPrimary: false,
      };
  }
}

/*
 * ---- editing what is already recorded ----------------------------------------------------------
 *
 * A recorded contact point used to be correctable only by deleting it and typing it again — which
 * is not a correction: the removal is itself a fact the record keeps, the permission and preference
 * attached to the value are lost with it, and a mistyped digit becomes two rows where there was one
 * way to reach somebody. The write path has taken a changed VALUE from the beginning; nothing on
 * screen ever asked for one.
 *
 * These turn a recorded row back into the draft its own add row edits, so a correction is entered in
 * exactly the fields the value was entered in.
 */

/** A recorded email, as the draft its own field edits. */
export function emailDraftFrom(entry: DirectoryEmailEntry): EmailDraft {
  return { kind: "email", address: entry.address, use: entry.contactUse ?? "work" };
}

/**
 * A recorded number, as the draft its own fields edit.
 *
 * The number is put back in the country's NATIONAL form, because that is the form it was typed in
 * and the form the field formats as it is typed; the stored international form is what the record
 * keeps, and re-deriving it on the way out is `checkPhoneEntry`'s job.
 */
export function numberDraftFrom(entry: DirectoryPhoneEntry): NumberDraft {
  const region = (entry.countryRegionCode as CountryCode | null) ?? DEFAULT_PHONE_REGION;
  return {
    kind: entry.contactSystem === "fax" ? "fax" : "telephone",
    region,
    number: nationalFormOf(entry.number, region),
    extension: entry.extension ?? "",
    use: entry.contactUse ?? (entry.contactSystem === "fax" ? "work" : "mobile"),
  };
}

/** A recorded address, as the draft the address form edits. Every line, including the empty ones. */
export function addressDraftFrom(entry: DirectoryAddressEntry): AddressDraft {
  return {
    kind: "address",
    recipient: entry.recipient ?? "",
    organizationName: entry.organizationName ?? "",
    street: entry.street ?? "",
    streetTwo: entry.streetTwo ?? "",
    dependentLocality: entry.dependentLocality ?? "",
    city: entry.city ?? "",
    region: entry.region ?? "",
    postal: entry.postal ?? "",
    sortingCode: entry.sortingCode ?? "",
    country: entry.country ?? DEFAULT_PHONE_REGION,
    use: entry.addressUse ?? "business",
    type: entry.addressType,
  };
}

/** What a correction sends: the fields of whichever channel the value belongs to. */
export type ContactPointUpdate = Parameters<typeof updateDirectoryContactPoint>[3];

/**
 * The body of the update request one draft makes, in the shape its channel's route takes.
 *
 * Null for a number the parser will not accept — the caller has already refused that draft, and a
 * write built from it would send the record something it cannot store.
 */
export function contactUpdateFrom(draft: ContactDraft): ContactPointUpdate | null {
  switch (draft.kind) {
    case "email":
      return { address: draft.address.trim(), contactUse: draft.use };
    case "telephone":
    case "fax": {
      const checked = checkPhoneEntry(draft.region, draft.number);
      if (!checked.ok) return null;
      return {
        number: checked.number,
        contactSystem: draft.kind === "fax" ? "fax" : "voice",
        contactUse: draft.use,
        extension: part(draft.extension),
        countryRegionCode: checked.region,
      };
    }
    case "address":
      return {
        recipient: part(draft.recipient),
        organizationName: part(draft.organizationName),
        street: part(draft.street),
        streetTwo: part(draft.streetTwo),
        dependentLocality: part(draft.dependentLocality),
        city: part(draft.city),
        region: part(draft.region),
        postal: part(draft.postal),
        sortingCode: part(draft.sortingCode),
        country: part(draft.country),
        addressUse: draft.use,
        addressType: draft.type,
      };
  }
}
