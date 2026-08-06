import type { DictionaryItemField } from "./catalog/entry.ts";
import { MERGE_SUBJECTS, type MergeSubject } from "./catalog/subjects.ts";
import type { MatterAssetMergeRow } from "./merge-statements.ts";
import type { MergeListItem, MergeValue } from "./types.ts";

// The asset register, as merge fields.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: an asset subject is COLLECTION-ONLY. It declares `.all` and
// nothing else — no `realProperty.parcelNumber`, no `assets.totalValue`, no scalar of any kind.
//
// The reason is the ambiguity rule, applied honestly rather than mechanically. A party subject has a
// singular slot because a matter has one client; an estate with two houses is the NORMAL case, so a
// scalar `realProperty.parcelNumber` would resolve to an absence naming the count on most real
// matters. That is the ambiguity rule producing a technically correct answer that is useless every
// time, which is a slot that should not have been created. So the register creates none, and
// `test/asset-subjects.test.ts` asserts that no `assetClass` subject ever declares one.
//
// Totals are the same argument from the other end: anything the expression language can compute is
// not a key, and `{{= sum assets.all.value}}` already folds through the money helpers — refusing,
// visibly, on a mixed-currency register rather than summing.
//
// NO PROTECTED VALUE IS EVER A FACET. `accountSuffix` is the facet and the full account number has no
// key at all. A merge field that decrypted an identifier into an assembled document would write the
// secret into a file whose confidentiality is then the file's problem, and the audit row would say a
// decrypt happened without saying where the value went. The suffix is what a letter needs ("account
// ending 4417").

// The field an asset subject's collection is named by — the same one segment every other collection
// uses, so `realProperty.all` is a dictionary key of the same dotted shape and an item's field inside
// a repeating block reads `realProperty.all.parcelNumber`.
export const ASSET_LIST_FIELD = "all";

// The subject key each platform class fills, and the aggregate that takes them all. The mapping is
// explicit rather than derived from the class name because two of them differ: the register's `other`
// class fills `otherAssets` (a bare `other` at the top of the merge namespace would be a reserved
// word nobody could guess the meaning of), and `assets` is not a class at all.
export const ASSET_SUBJECT_BY_CLASS: Readonly<Record<string, string>> = {
  realProperty: "realProperty",
  financialAccount: "financialAccount",
  vehicle: "vehicle",
  firearm: "firearm",
  businessInterest: "businessInterest",
  insurancePolicy: "insurancePolicy",
  receivable: "receivable",
  digitalAsset: "digitalAsset",
  personalProperty: "personalProperty",
  other: "otherAssets",
};

// The aggregate. Every asset appears here AND under its class's subject, from the same read.
export const ASSET_AGGREGATE_SUBJECT = "assets";

// The item fields every asset carries, whichever class it is. `value` and `valueAsOf` are DECLARED
// TOGETHER and a test asserts neither exists without the other: an undated figure in a filed document
// is the failure mode with the worst consequences, so a template that prints one without the other is
// a template bug the user documentation names in those words.
export const COMMON_ASSET_ITEM_FIELDS: readonly DictionaryItemField[] = [
  { name: "description", valueType: "text", description: "What the thing is." },
  { name: "className", valueType: "text", description: "The kind of thing it is." },
  {
    name: "typeName",
    valueType: "text",
    description: "The firm's own name for this kind of thing, where one was chosen.",
  },
  {
    name: "value",
    valueType: "money",
    description: "What it was worth as of the date the document was assembled for.",
  },
  {
    name: "valueAsOf",
    valueType: "date",
    description: "The date that figure speaks to, which may be earlier than the date asked for.",
  },
  {
    name: "valueBasis",
    valueType: "text",
    description: "What the figure rests on — an appraisal, a statement, a sale.",
  },
  {
    name: "estateTreatment",
    valueType: "text",
    description: "How the firm recorded the thing as passing. Asserted by a person, never derived.",
  },
  { name: "disposition", valueType: "text", description: "What became of it." },
];

// What each class's items carry BEYOND the common set — its own attribute columns, which is literally
// the column list. A class with no attribute table adds nothing and is not a defect.
const CLASS_ITEM_FIELDS: Readonly<Record<string, readonly DictionaryItemField[]>> = {
  realProperty: [
    { name: "address", valueType: "text", description: "The property's address." },
    {
      name: "parcelNumber",
      valueType: "text",
      description: "The assessor's parcel number, as recorded on the public roll.",
    },
    { name: "legalDescription", valueType: "text", description: "The recorded legal description." },
    { name: "county", valueType: "text", description: "The county the property sits in." },
  ],
  financialAccount: [
    { name: "institutionName", valueType: "text", description: "The institution holding it." },
    {
      name: "accountSuffix",
      valueType: "text",
      // The FULL number has no key at all — see the module comment.
      description: "The last four characters of the account number, where the firm recorded them.",
    },
  ],
  vehicle: [
    { name: "make", valueType: "text", description: "The vehicle's make." },
    { name: "model", valueType: "text", description: "The vehicle's model." },
    { name: "modelYear", valueType: "number", description: "The vehicle's model year." },
    {
      name: "vehicleIdentificationNumber",
      valueType: "text",
      description: "The vehicle identification number, as it appears on the title.",
    },
  ],
  firearm: [
    { name: "make", valueType: "text", description: "The firearm's make." },
    { name: "model", valueType: "text", description: "The firearm's model." },
    { name: "caliberOrGauge", valueType: "text", description: "The calibre or gauge." },
    {
      name: "serialNumber",
      valueType: "text",
      description: "The serial number, as it appears on the transfer paperwork.",
    },
  ],
  businessInterest: [
    { name: "entityName", valueType: "text", description: "The company's name." },
    {
      name: "jurisdictionOfOrganization",
      valueType: "text",
      description: "Where the company was organised.",
    },
    { name: "entityForm", valueType: "text", description: "The form the company takes." },
  ],
  insurancePolicy: [
    { name: "carrierName", valueType: "text", description: "The carrier." },
    {
      name: "faceAmount",
      valueType: "money",
      // A TERM OF THE CONTRACT, not a valuation. What the policy is worth is `value`, which is dated.
      description: "The policy's face amount — a term of the policy, not what it is worth today.",
    },
  ],
  receivable: [
    {
      name: "principalAmount",
      valueType: "money",
      description: "The principal of the obligation, as agreed.",
    },
    { name: "maturityOn", valueType: "date", description: "When it falls due." },
  ],
  digitalAsset: [
    { name: "platformName", valueType: "text", description: "The platform it sits on." },
    {
      name: "accountHandle",
      valueType: "text",
      description: "The public handle on that platform.",
    },
  ],
};

// The item fields one asset subject's collection declares: the common set, plus that class's own. The
// aggregate declares the common set alone, because the columns a house has and the columns a car has
// are not fields the same list can carry.
export function assetItemFieldsFor(subjectKey: string): readonly DictionaryItemField[] {
  if (subjectKey === ASSET_AGGREGATE_SUBJECT) return COMMON_ASSET_ITEM_FIELDS;
  const assetClass = Object.entries(ASSET_SUBJECT_BY_CLASS).find(
    ([, subject]) => subject === subjectKey,
  )?.[0];
  return [...COMMON_ASSET_ITEM_FIELDS, ...(CLASS_ITEM_FIELDS[assetClass ?? ""] ?? [])];
}

export const ASSET_SUBJECTS: readonly MergeSubject[] = MERGE_SUBJECTS.filter(
  (subject) => subject.kind === "assetClass",
);

// The asset subjects a manifest actually names. Nothing here narrows the READ — every asset subject
// is answered by one pass over rows already in memory — it decides only which collections are built.
export function assetSubjectsIn(wantedKeys: ReadonlySet<string>): readonly MergeSubject[] {
  return ASSET_SUBJECTS.filter((subject) => wantedKeys.has(`${subject.key}.${ASSET_LIST_FIELD}`));
}

function textField(value: string | null): MergeValue | undefined {
  return value === null || value === "" ? undefined : { kind: "text", text: value };
}

function moneyField(amountMinor: number | null, currency: string | null): MergeValue | undefined {
  if (amountMinor === null || currency === null || currency === "") return undefined;
  return { kind: "money", amountMinor, currencyCode: currency };
}

// The address as one rendered block. Assembled from the parts the property row carries, joining only
// what is present, so a property recorded with a city and no street prints the city rather than a
// string of stray commas.
function addressField(row: MatterAssetMergeRow): MergeValue | undefined {
  const parts = [row.street, row.city, row.region, row.postal].filter(
    (part): part is string => part !== null && part !== "",
  );
  return parts.length === 0 ? undefined : { kind: "text", text: parts.join(", ") };
}

// One asset, as the fields its subject's items declare. Every field is set only when the register
// actually carries it: an item missing a field is an ordinary absence inside a repeating block, and
// the aggregates refuse to fold over one rather than skipping it.
export function assetListItem(row: MatterAssetMergeRow, subjectKey: string): MergeListItem {
  const fields = new Map<string, MergeValue>();
  const set = (name: string, value: MergeValue | undefined): void => {
    if (value !== undefined) fields.set(name, value);
  };
  set("description", textField(row.description));
  set("className", textField(row.class));
  set("typeName", textField(row.type_name));
  // THE VALUE AND ITS DATE, TOGETHER OR NOT AT ALL. Never one without the other — an undated figure
  // in a filed document is the worst thing this subsystem can produce, so the two are set in one
  // guarded step rather than independently.
  if (
    row.value_amount_minor !== null &&
    row.value_currency !== null &&
    row.value_as_of_date !== null
  ) {
    set("value", moneyField(row.value_amount_minor, row.value_currency));
    set("valueAsOf", { kind: "date", isoDate: row.value_as_of_date });
    set("valueBasis", textField(row.value_basis));
  }
  set("estateTreatment", textField(row.estate_treatment));
  set("disposition", textField(row.disposition));

  if (subjectKey === ASSET_AGGREGATE_SUBJECT) return { fields };

  switch (row.class) {
    case "realProperty":
      set("address", addressField(row));
      set("parcelNumber", textField(row.parcel_number));
      set("legalDescription", textField(row.legal_description));
      set("county", textField(row.county));
      break;
    case "financialAccount":
      set("institutionName", textField(row.institution_name));
      // The SUFFIX, and there is no key that could carry the full number.
      set("accountSuffix", textField(row.account_suffix));
      break;
    case "vehicle":
      set("make", textField(row.make));
      set("model", textField(row.model));
      if (row.model_year !== null)
        set("modelYear", { kind: "number", value: row.model_year, scale: 0 });
      set("vehicleIdentificationNumber", textField(row.vehicle_identification_number));
      break;
    case "firearm":
      set("make", textField(row.make));
      set("model", textField(row.model));
      set("caliberOrGauge", textField(row.caliber_or_gauge));
      set("serialNumber", textField(row.serial_number));
      break;
    case "businessInterest":
      set("entityName", textField(row.entity_name));
      set("jurisdictionOfOrganization", textField(row.jurisdiction_of_organization));
      set("entityForm", textField(row.entity_form));
      break;
    case "insurancePolicy":
      set("carrierName", textField(row.carrier_name));
      set("faceAmount", moneyField(row.face_amount_minor, row.face_currency));
      break;
    case "receivable":
      set("principalAmount", moneyField(row.principal_amount_minor, row.principal_currency));
      if (row.maturity_on !== null && row.maturity_on !== "") {
        set("maturityOn", { kind: "date", isoDate: row.maturity_on });
      }
      break;
    case "digitalAsset":
      set("platformName", textField(row.platform_name));
      set("accountHandle", textField(row.account_handle));
      break;
    default:
      // `personalProperty` and `other` carry the core row and nothing else, by design.
      break;
  }
  return { fields };
}

// Every asset subject a manifest names, filled from ONE list of rows. The aggregate takes them all;
// a class subject takes the rows of its class. Both are passes over an array already in memory, which
// is what makes eleven subjects cost one read.
export function assetSubjectValues(
  rows: readonly MatterAssetMergeRow[],
  subjects: readonly MergeSubject[],
): Map<string, MergeValue> {
  const values = new Map<string, MergeValue>();
  for (const subject of subjects) {
    const relevant =
      subject.key === ASSET_AGGREGATE_SUBJECT
        ? rows
        : rows.filter((row) => ASSET_SUBJECT_BY_CLASS[row.class] === subject.key);
    // AN EMPTY LIST IS A CORRECT DOCUMENT, not an absence: a repeating block over an estate with no
    // vehicles simply produces nothing, which is the catalogue's declared rule for collections.
    values.set(`${subject.key}.${ASSET_LIST_FIELD}`, {
      kind: "list",
      items: relevant.map((row) => assetListItem(row, subject.key)),
    });
  }
  return values;
}
