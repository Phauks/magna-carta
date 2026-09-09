/*
 * What an address is made of, WHERE — the field set, the words and the order, per country.
 *
 * AN ADDRESS FORM IS NOT A UNIVERSAL SHAPE WITH LOCAL LABELS. Ireland has no state. Japan writes the
 * postal code first and reads from the largest unit down. Germany, France and most of Europe put the
 * postal code before the town on one line. Brazil and Mexico carry a neighbourhood line that the
 * United States has no field for at all. The United Kingdom's postcode is alphanumeric and its
 * county is optional and shrinking. A form that asks every one of them for "State" and "ZIP Code"
 * is not merely impolite: it produces addresses that do not deliver, and it teaches the person
 * entering them to put the wrong thing in the wrong box, which no later correction can undo.
 *
 * So a country selects a FORMAT: which of the stored fields it uses, what a reader there calls each
 * one, and what order and grouping they read in. The stored columns never change — they are named
 * for their POSITION in an address (`street`, `dependentLocality`, `city`, `region`, `postal`,
 * `sortingCode`), which is the international field set and the reason a format can be a presentation
 * choice rather than a schema. Changing the country re-labels and re-orders the form; it never moves
 * a value from one column to another, because the columns already mean what they mean.
 *
 * NOTHING IS EVER REQUIRED. An address a firm holds half of is still the address it holds, and a
 * form that refuses it sends it into a free-text note where no envelope, no affidavit of service and
 * no duplicate check can reach it. A format says what a country USES, never what it demands.
 *
 * ADDING A COUNTRY IS ONE ENTRY in the table at the foot of this file. A country nobody has entered
 * yet gets `INTERNATIONAL_FORMAT`, which is the widest honest shape: every line, neutral words, no
 * assumption that a state or a numeric postal code exists. That is a better answer than guessing.
 *
 * This file is DATA, and it is deliberately not a reference dataset. The full address-metadata
 * corpus (Google's address-i18n / libaddressinput) covers every territory and carries per-country
 * postal-code patterns and administrative-area lists with it; it is also a live dependency that goes
 * stale and a large one to ship. What is here is the shape — the part that changes how a person
 * enters an address — for the countries a firm meets, with a defensible default for the rest.
 */

/**
 * The stored fields a form can ask for. These are the international field set's own names, so a
 * format never has to say which column a labelled box writes to — the key IS the column.
 */
export type AddressFieldKey =
  | "recipient"
  | "organizationName"
  | "street"
  | "streetTwo"
  | "dependentLocality"
  | "city"
  | "region"
  | "postal"
  | "sortingCode";

/** One box on the form: which field it writes, what it is called here, and how wide it sits. */
export interface AddressFieldSpec {
  readonly key: AddressFieldKey;
  /** What a reader in this country calls it — "ZIP Code", "Postcode", "Eircode", "PIN Code". */
  readonly label: string;
  /**
   * The share of its line the box takes. A postal code is short and a street is long, and giving
   * both half a line makes one cramped and the other a field of empty space.
   */
  readonly span?: number;
}

/** A country's form: its lines, in reading order, each line a row of boxes. */
export interface AddressFormat {
  readonly lines: readonly (readonly AddressFieldSpec[])[];
}

// The lines every format shares, written once. A format is then the country's own arrangement of
// them rather than nine repeated field declarations.
const streetLine: readonly AddressFieldSpec[] = [
  { key: "street", label: "Street Address", span: 2 },
  { key: "streetTwo", label: "Apartment, Suite or Floor" },
];

/** The shape most of the English-speaking world uses: town, then administrative area, then code. */
function cityRegionPostal(
  regionLabel: string,
  postalLabel: string,
  cityLabel = "City",
): AddressFormat {
  return {
    lines: [
      streetLine,
      [
        { key: "city", label: cityLabel, span: 2 },
        { key: "region", label: regionLabel },
        { key: "postal", label: postalLabel },
      ],
    ],
  };
}

/** The shape most of continental Europe uses: the code leads the line, the town follows it. */
function postalThenCity(postalLabel = "Postal Code", cityLabel = "City"): AddressFormat {
  return {
    lines: [
      streetLine,
      [
        { key: "postal", label: postalLabel },
        { key: "city", label: cityLabel, span: 3 },
      ],
    ],
  };
}

/**
 * The default, and the one a country nobody has entered yet gets.
 *
 * Every line the field set has, under words that name the position rather than one country's
 * institution: "Region" rather than "State" or "Province", "Postal Code" rather than "ZIP".
 */
export const INTERNATIONAL_FORMAT: AddressFormat = {
  lines: [
    streetLine,
    [
      { key: "dependentLocality", label: "District or Neighbourhood" },
      { key: "city", label: "City", span: 2 },
    ],
    [
      { key: "region", label: "Region" },
      { key: "postal", label: "Postal Code" },
    ],
  ],
};

/**
 * The countries whose form the product knows, by ISO 3166-1 alpha-2 code.
 *
 * Adding one is a single entry. Removing one is not a tidy-up: it silently re-labels every address a
 * firm has already entered under it.
 */
const FORMATS: Readonly<Record<string, AddressFormat>> = {
  US: cityRegionPostal("State", "ZIP Code"),
  CA: cityRegionPostal("Province", "Postal Code"),
  AU: cityRegionPostal("State or Territory", "Postcode", "Suburb or Town"),
  NZ: {
    lines: [
      streetLine,
      [
        { key: "dependentLocality", label: "Suburb", span: 2 },
        { key: "city", label: "Town or City", span: 2 },
      ],
      [{ key: "postal", label: "Postcode" }],
    ],
  },
  IN: {
    lines: [
      streetLine,
      [
        { key: "city", label: "City", span: 2 },
        { key: "region", label: "State" },
        { key: "postal", label: "PIN Code" },
      ],
    ],
  },
  BR: {
    lines: [
      streetLine,
      [
        { key: "dependentLocality", label: "Neighbourhood", span: 2 },
        { key: "city", label: "City", span: 2 },
      ],
      [
        { key: "region", label: "State" },
        { key: "postal", label: "CEP" },
      ],
    ],
  },
  MX: {
    lines: [
      streetLine,
      [
        { key: "dependentLocality", label: "Colonia", span: 2 },
        { key: "city", label: "City", span: 2 },
      ],
      [
        { key: "region", label: "State" },
        { key: "postal", label: "Postal Code" },
      ],
    ],
  },
  // The county is optional and shrinking in use, and the postcode is alphanumeric and carries the
  // delivery point on its own — so the postcode stands on its own line rather than being crowded
  // beside a field most addresses leave empty.
  GB: {
    lines: [
      streetLine,
      [
        { key: "city", label: "Town or City", span: 2 },
        { key: "region", label: "County" },
      ],
      [{ key: "postal", label: "Postcode" }],
    ],
  },
  IE: {
    lines: [
      streetLine,
      [
        { key: "city", label: "Town or City", span: 2 },
        { key: "region", label: "County" },
      ],
      [{ key: "postal", label: "Eircode" }],
    ],
  },
  DE: postalThenCity("Postleitzahl"),
  AT: postalThenCity("Postleitzahl"),
  CH: postalThenCity("Postleitzahl"),
  NL: postalThenCity("Postcode", "Town or City"),
  BE: postalThenCity(),
  ES: {
    lines: [
      streetLine,
      [
        { key: "postal", label: "Código Postal" },
        { key: "city", label: "City", span: 2 },
        { key: "region", label: "Province" },
      ],
    ],
  },
  IT: {
    lines: [
      streetLine,
      [
        { key: "postal", label: "CAP" },
        { key: "city", label: "City", span: 2 },
        { key: "region", label: "Province" },
      ],
    ],
  },
  // CEDEX is a sorting instruction rather than part of the address, so it has its own box.
  FR: {
    lines: [
      streetLine,
      [
        { key: "postal", label: "Code Postal" },
        { key: "city", label: "City", span: 2 },
      ],
      [{ key: "sortingCode", label: "CEDEX" }],
    ],
  },
  SE: postalThenCity(),
  NO: postalThenCity(),
  DK: postalThenCity(),
  FI: postalThenCity(),
  PL: postalThenCity("Kod Pocztowy"),
  // Read from the largest unit down, which is the order the boxes stand in.
  JP: {
    lines: [
      [{ key: "postal", label: "Postal Code" }],
      [
        { key: "region", label: "Prefecture" },
        { key: "city", label: "City or Ward", span: 2 },
      ],
      streetLine,
    ],
  },
  CN: {
    lines: [
      [
        { key: "region", label: "Province" },
        { key: "city", label: "City", span: 2 },
      ],
      [
        { key: "dependentLocality", label: "District" },
        { key: "postal", label: "Postal Code" },
      ],
      streetLine,
    ],
  },
  ZA: {
    lines: [
      streetLine,
      [
        { key: "dependentLocality", label: "Suburb", span: 2 },
        { key: "city", label: "City or Town", span: 2 },
      ],
      [
        { key: "region", label: "Province" },
        { key: "postal", label: "Postal Code" },
      ],
    ],
  },
};

/** The form a country uses, or the international one where the product has not been told. */
export function addressFormatFor(country: string | null | undefined): AddressFormat {
  if (country === null || country === undefined) return INTERNATIONAL_FORMAT;
  return FORMATS[country.trim().toUpperCase()] ?? INTERNATIONAL_FORMAT;
}

/** Every field a country's form asks for, flattened — what a caller clears when the country moves. */
export function addressFieldsFor(country: string | null | undefined): readonly AddressFieldKey[] {
  return addressFormatFor(country)
    .lines.flat()
    .map((field) => field.key);
}

/** The countries the product knows a form for. A caller may offer more; they take the default. */
export function countriesWithKnownFormat(): readonly string[] {
  return Object.keys(FORMATS);
}
