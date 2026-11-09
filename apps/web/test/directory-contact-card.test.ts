/*
 * The contact card a directory record downloads as, pinned.
 *
 * A card leaves the platform and lands in someone else's address book, so each case below is a
 * place where a slip would hand on something it should not — a number the person asked the firm
 * not to use, a former address — or hand on a file another program cannot read.
 */
import { describe, expect, it } from "vitest";
import { contactCard, contactCardFilename } from "../src/lib/directory/contact-card.ts";
import type {
  DirectoryAddressEntry,
  DirectoryContactPointState,
  DirectoryContactPoints,
  DirectoryEmailEntry,
  DirectoryEntityDetail,
  DirectoryPersonDetail,
  DirectoryPhoneEntry,
} from "../src/lib/directory/directory-api.ts";

const STATE: DirectoryContactPointState = {
  permitted: true,
  preferred: false,
  note: null,
  verificationStatus: "unverified",
  verifiedAt: null,
  verificationDetail: null,
};

function person(overrides: Partial<DirectoryPersonDetail> = {}): DirectoryEntityDetail {
  return {
    kind: "person",
    person: {
      id: "directoryPerson_one",
      prefix: null,
      given: "Rosalind",
      middle: null,
      family: "Chase",
      suffix: null,
      displayName: null,
      status: "active",
      mergedIntoId: null,
      pronouns: null,
      dateOfBirth: null,
      dateOfDeath: null,
      deceased: false,
      ...overrides,
    },
  };
}

function email(overrides: Partial<DirectoryEmailEntry> = {}): DirectoryEmailEntry {
  return {
    id: "email_one",
    address: "rosalind@example.com",
    contactUse: "work",
    isPrimary: true,
    state: STATE,
    ...overrides,
  };
}

function phone(overrides: Partial<DirectoryPhoneEntry> = {}): DirectoryPhoneEntry {
  return {
    id: "phone_one",
    number: "(555) 010-2000",
    contactSystem: "voice",
    contactUse: "mobile",
    countryCallingCode: "1",
    nationalNumber: "5550102000",
    extension: null,
    countryRegionCode: "US",
    isPrimary: false,
    state: STATE,
    ...overrides,
  };
}

function address(overrides: Partial<DirectoryAddressEntry> = {}): DirectoryAddressEntry {
  return {
    id: "address_one",
    recipient: null,
    organizationName: null,
    street: "12 High Street",
    streetTwo: "Suite 4",
    dependentLocality: null,
    city: "Springfield",
    region: "IL",
    postal: "62701",
    sortingCode: null,
    country: "US",
    addressUse: "business",
    addressType: "physical",
    isPrimary: true,
    state: STATE,
    ...overrides,
  };
}

function points(overrides: Partial<DirectoryContactPoints> = {}): DirectoryContactPoints {
  return { emails: [], phones: [], addresses: [], ...overrides };
}

function lines(card: string): string[] {
  return card.replace(/\r\n /g, "").split("\r\n");
}

describe("a person's contact card", () => {
  it("opens and closes as a version 4.0 card, every line ended with CRLF", () => {
    const card = contactCard(person(), null);
    expect(card.startsWith("BEGIN:VCARD\r\nVERSION:4.0\r\n")).toBe(true);
    expect(card.endsWith("END:VCARD\r\n")).toBe(true);
    expect(card.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("carries the name whole and in its parts", () => {
    const card = lines(contactCard(person({ prefix: "Dr", suffix: "Jr" }), null));
    expect(card).toContain("FN:Dr Rosalind Chase Jr");
    expect(card).toContain("N:Chase;Rosalind;;Dr;Jr");
  });

  it("states a date of birth in the card's date form and leaves a missing one off", () => {
    expect(lines(contactCard(person({ dateOfBirth: "1980-04-15" }), null))).toContain(
      "BDAY:19800415",
    );
    expect(contactCard(person(), null)).not.toContain("BDAY");
  });

  it("lists the live ways of reaching the person, the default first-preferred", () => {
    const card = lines(
      contactCard(
        person(),
        points({ emails: [email()], phones: [phone({ extension: "12" })], addresses: [address()] }),
      ),
    );
    expect(card).toContain("EMAIL;TYPE=work;PREF=1:rosalind@example.com");
    expect(card).toContain("TEL;TYPE=cell,voice:(555) 010-2000 x12");
    expect(card).toContain(
      "ADR;TYPE=work;PREF=1:;;12 High Street\\nSuite 4;Springfield;IL;62701;US",
    );
  });

  it("leaves off a contact point the person withdrew permission for, or one recorded as former", () => {
    const card = contactCard(
      person(),
      points({
        emails: [email({ state: { ...STATE, permitted: false } })],
        phones: [phone({ contactUse: "former" })],
        addresses: [address({ addressUse: "former" })],
      }),
    );
    expect(card).not.toContain("EMAIL");
    expect(card).not.toContain("TEL");
    expect(card).not.toContain("ADR");
  });

  it("escapes the characters a card reserves", () => {
    const card = lines(contactCard(person({ displayName: "Chase, Rosalind; Esq" }), null));
    expect(card).toContain("FN:Chase\\, Rosalind\\; Esq");
  });

  it("folds a long line at 75 octets without splitting a character", () => {
    const card = contactCard(person({ displayName: "é".repeat(60) }), null);
    for (const line of card.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(lines(card)).toContain(`FN:${"é".repeat(60)}`);
  });
});

describe("an organization's contact card", () => {
  it("marks the card as an organization's and names it by its legal name", () => {
    const card = lines(
      contactCard(
        {
          kind: "organization",
          organization: {
            id: "directoryOrganization_one",
            legalName: "Acme Holdings LLC",
            displayName: "Acme",
            status: "active",
            mergedIntoId: null,
          },
        },
        null,
      ),
    );
    expect(card).toContain("KIND:org");
    expect(card).toContain("FN:Acme");
    expect(card).toContain("ORG:Acme Holdings LLC");
    expect(card.some((line) => line.startsWith("N:"))).toBe(false);
  });
});

describe("the file a card is saved as", () => {
  it("is the record's name, without what a file system refuses", () => {
    expect(contactCardFilename(person())).toBe("Rosalind Chase.vcf");
    expect(contactCardFilename(person({ displayName: "A/B: C?" }))).toBe("A B C.vcf");
  });
});

describe("a card with a picture", () => {
  it("carries it as a data address, folded like every other line", () => {
    const base64 = "A".repeat(200);
    const card = contactCard(person(), null, { contentType: "image/jpeg", base64 });
    expect(lines(card)).toContain(`PHOTO:data:image/jpeg;base64,${base64}`);
    for (const line of card.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
