import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LocationId, MatterId } from "@magna-carta/identifiers/types";

// The reads the merge-context resolver issues, one per source. Table names are tracked against
// @magna-carta/database's per-firm schema by the schema-name-sync fitness test.
//
// Each projection lists exactly the columns the dictionary's entries for that source read. That is not
// tidiness: a `SELECT *` here would silently widen what an assembly pulls into memory every time a table
// gained a column, including a column nothing in a document should ever carry.

export const MATTER_TABLE = "matter";
export const LOCATION_TABLE = "location";
export const MATTER_PARTY_TABLE = "matter_party";
export const DIRECTORY_PERSON_TABLE = "directory_person";
export const DIRECTORY_ORGANIZATION_TABLE = "directory_organization";
export const MATTER_ASSET_TABLE = "matter_asset";
export const MATTER_ASSIGNMENT_TABLE = "matter_assignment";
export const MEMBER_TABLE = "member";
export const MEMBER_PROFESSIONAL_PROFILE_TABLE = "member_professional_profile";
export const MATTER_COURT_CASE_TABLE = "matter_court_case";
export const MATTER_ESTATE_TABLE = "matter_estate";

// The matter's staffing, in ONE statement — the whole of the `staffing` source.
//
// FIVE MEMBER SUBJECTS RIDE THIS READ. The first arm is the matter row's own responsible member —
// that column stays the responsible attorney's one home, and the arm labels the row with the
// subject's own token so resolution treats it exactly as it treats an assignment row. The second
// arm is the current assignment rows, validity-windowed against the assembly's own instant. Both
// arms join the member row, the professional profile, and the member's mapped Directory person —
// the mapped person is resolved through a correlated sub-select so a duplicate mapping can never
// multiply a staffing row into a false ambiguity.
//
// The mapped person's id is projected because a protected bar number has to name WHOSE sealed
// identifier it wants; it is never a merge value itself.
export interface MatterStaffingMergeRow {
  readonly role: string;
  readonly memberUserId: string;
  readonly displayName: string | null;
  readonly title: string | null;
  readonly professionalEmail: string | null;
  readonly directDial: string | null;
  // The member's mapped Directory person, or null for a member the Directory does not mirror.
  readonly entityId: string | null;
  readonly namePrefix: string | null;
  readonly nameGiven: string | null;
  readonly nameMiddle: string | null;
  readonly nameFamily: string | null;
  readonly nameSuffix: string | null;
}

export interface MatterStaffingMergeColumns {
  role: string;
  member_user_id: string;
  display_name: string | null;
  title: string | null;
  professional_email: string | null;
  direct_dial: string | null;
  entity_id: string | null;
  name_prefix: string | null;
  name_given: string | null;
  name_middle: string | null;
  name_family: string | null;
  name_suffix: string | null;
}

const STAFFING_MEMBER_PROJECTION =
  `${MEMBER_TABLE}.user_id AS member_user_id, ${MEMBER_TABLE}.display_name AS display_name, ` +
  `profile.title AS title, profile.professional_email AS professional_email, profile.direct_dial AS direct_dial, ` +
  `person.id AS entity_id, person.name_prefix AS name_prefix, person.name_given AS name_given, ` +
  `person.name_middle AS name_middle, person.name_family AS name_family, person.name_suffix AS name_suffix`;

const STAFFING_MEMBER_JOINS =
  `LEFT JOIN ${MEMBER_PROFESSIONAL_PROFILE_TABLE} AS profile ON profile.member_user_id = ${MEMBER_TABLE}.user_id ` +
  `LEFT JOIN ${DIRECTORY_PERSON_TABLE} AS person ON person.id = ` +
  `(SELECT candidate.id FROM ${DIRECTORY_PERSON_TABLE} AS candidate ` +
  `WHERE candidate.member_id = ${MEMBER_TABLE}.user_id AND candidate.deleted_at IS NULL ` +
  `ORDER BY candidate.created_at ASC, candidate.id ASC LIMIT 1)`;

export function selectMatterStaffingForMergeStatement(
  database: SqlDatabase,
  matterId: MatterId,
  // The assembly's own instant — the moment the assignment validity window is evaluated at, so a
  // resolved staffing answer is reproducible for a given assembly rather than drifting with the
  // clock between retries.
  asOfInstant: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT 'responsibleAttorney' AS role, ${STAFFING_MEMBER_PROJECTION} ` +
        `FROM ${MATTER_TABLE} ` +
        `JOIN ${MEMBER_TABLE} ON ${MEMBER_TABLE}.user_id = ${MATTER_TABLE}.responsible_member_id ` +
        `${STAFFING_MEMBER_JOINS} ` +
        `WHERE ${MATTER_TABLE}.id = ?1 ` +
        `UNION ALL ` +
        `SELECT assignment.assignment_role AS role, ${STAFFING_MEMBER_PROJECTION} ` +
        `FROM ${MATTER_ASSIGNMENT_TABLE} AS assignment ` +
        `JOIN ${MEMBER_TABLE} ON ${MEMBER_TABLE}.user_id = assignment.member_user_id ` +
        `${STAFFING_MEMBER_JOINS} ` +
        `WHERE assignment.matter_id = ?1 ` +
        // The window's two recorded forms, told apart by length. A bound written at creation is a
        // CIVIL DATE (YYYY-MM-DD, enforced by packages/matters/src/matter-assignment.ts) and is
        // inclusive of its whole day — an assignment "through 2026-08-07" still staffs the matter
        // at 23:59 that day, so a civil valid_to compares against the instant's own calendar date.
        // A valid_to stamped by the end-assignment path is the ending INSTANT, exclusive from that
        // moment. Both comparisons are lexicographic, which is chronological for both forms; a
        // civil valid_from needs no case split because the date sorts before every instant within
        // its day. The assembly instant is UTC, so a civil bound's day boundary is its UTC day —
        // evaluating it in the office's zone would make this read depend on the location read it
        // is batched beside, for at most an offset's width at the window's edges.
        `AND (assignment.valid_from IS NULL OR assignment.valid_from <= ?2) ` +
        `AND (assignment.valid_to IS NULL ` +
        `OR (length(assignment.valid_to) = 10 AND assignment.valid_to >= substr(?2, 1, 10)) ` +
        `OR (length(assignment.valid_to) > 10 AND assignment.valid_to > ?2)) ` +
        `ORDER BY role ASC, member_user_id ASC`,
    )
    .bind(matterId, asOfInstant);
}

export function toMatterStaffingMergeRow(row: MatterStaffingMergeColumns): MatterStaffingMergeRow {
  return {
    role: row.role,
    memberUserId: row.member_user_id,
    displayName: row.display_name ?? null,
    title: row.title ?? null,
    professionalEmail: row.professional_email ?? null,
    directDial: row.direct_dial ?? null,
    entityId: row.entity_id ?? null,
    namePrefix: row.name_prefix ?? null,
    nameGiven: row.name_given ?? null,
    nameMiddle: row.name_middle ?? null,
    nameFamily: row.name_family ?? null,
    nameSuffix: row.name_suffix ?? null,
  };
}

// The matter's court-and-case identity, in ONE statement — the whole of the `court` source, shared
// by the `court` and `case` subjects. The court's name comes from its Directory organisation and
// the judge's name parts from their Directory person, so a court's identity is recorded once in the
// Directory rather than restated per matter.
export interface MatterCourtCaseMergeRow {
  readonly courtName: string | null;
  readonly caseNumber: string | null;
  readonly division: string | null;
  readonly department: string | null;
  readonly filedOn: string | null;
  readonly clientDesignation: string | null;
  readonly opposingDesignation: string | null;
  readonly judgeDisplayName: string | null;
  readonly judgeNamePrefix: string | null;
  readonly judgeNameGiven: string | null;
  readonly judgeNameMiddle: string | null;
  readonly judgeNameFamily: string | null;
  readonly judgeNameSuffix: string | null;
}

export interface MatterCourtCaseMergeColumns {
  court_name: string | null;
  case_number: string | null;
  division: string | null;
  department: string | null;
  filed_on: string | null;
  client_designation: string | null;
  opposing_designation: string | null;
  judge_display_name: string | null;
  judge_name_prefix: string | null;
  judge_name_given: string | null;
  judge_name_middle: string | null;
  judge_name_family: string | null;
  judge_name_suffix: string | null;
}

export function selectMatterCourtCaseForMergeStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(court.display_name, court.legal_name) AS court_name, ` +
        `court_case.case_number AS case_number, court_case.division AS division, ` +
        `court_case.department AS department, court_case.filed_on AS filed_on, ` +
        `court_case.client_designation AS client_designation, ` +
        `court_case.opposing_designation AS opposing_designation, ` +
        `judge.display_name AS judge_display_name, judge.name_prefix AS judge_name_prefix, ` +
        `judge.name_given AS judge_name_given, judge.name_middle AS judge_name_middle, ` +
        `judge.name_family AS judge_name_family, judge.name_suffix AS judge_name_suffix ` +
        `FROM ${MATTER_COURT_CASE_TABLE} AS court_case ` +
        `LEFT JOIN ${DIRECTORY_ORGANIZATION_TABLE} AS court ` +
        `ON court.id = court_case.court_entity_id AND court.deleted_at IS NULL ` +
        `LEFT JOIN ${DIRECTORY_PERSON_TABLE} AS judge ` +
        `ON judge.id = court_case.judge_entity_id AND judge.deleted_at IS NULL ` +
        `WHERE court_case.matter_id = ?1 AND court_case.deleted_at IS NULL`,
    )
    .bind(matterId);
}

export function toMatterCourtCaseMergeRow(
  row: MatterCourtCaseMergeColumns,
): MatterCourtCaseMergeRow {
  return {
    courtName: row.court_name ?? null,
    caseNumber: row.case_number ?? null,
    division: row.division ?? null,
    department: row.department ?? null,
    filedOn: row.filed_on ?? null,
    clientDesignation: row.client_designation ?? null,
    opposingDesignation: row.opposing_designation ?? null,
    judgeDisplayName: row.judge_display_name ?? null,
    judgeNamePrefix: row.judge_name_prefix ?? null,
    judgeNameGiven: row.judge_name_given ?? null,
    judgeNameMiddle: row.judge_name_middle ?? null,
    judgeNameFamily: row.judge_name_family ?? null,
    judgeNameSuffix: row.judge_name_suffix ?? null,
  };
}

// The matter's estate record, in ONE statement — the whole of the `estate` source. The styles are
// STORED designations projected as recorded; the decedent's name parts come from their Directory
// person, so every name format applies to `estate.decedent` with no new machinery.
export interface MatterEstateMergeRow {
  readonly estateStyle: string | null;
  readonly shortStyle: string | null;
  readonly dateOfDeath: string | null;
  readonly proceedingType: string | null;
  readonly lettersIssuedOn: string | null;
  readonly decedentDisplayName: string | null;
  readonly decedentNamePrefix: string | null;
  readonly decedentNameGiven: string | null;
  readonly decedentNameMiddle: string | null;
  readonly decedentNameFamily: string | null;
  readonly decedentNameSuffix: string | null;
}

export interface MatterEstateMergeColumns {
  estate_style: string | null;
  short_style: string | null;
  date_of_death: string | null;
  proceeding_type: string | null;
  letters_issued_on: string | null;
  decedent_display_name: string | null;
  decedent_name_prefix: string | null;
  decedent_name_given: string | null;
  decedent_name_middle: string | null;
  decedent_name_family: string | null;
  decedent_name_suffix: string | null;
}

export function selectMatterEstateForMergeStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT estate.estate_style AS estate_style, estate.short_style AS short_style, ` +
        `estate.date_of_death AS date_of_death, estate.proceeding_type AS proceeding_type, ` +
        `estate.letters_issued_on AS letters_issued_on, ` +
        `decedent.display_name AS decedent_display_name, decedent.name_prefix AS decedent_name_prefix, ` +
        `decedent.name_given AS decedent_name_given, decedent.name_middle AS decedent_name_middle, ` +
        `decedent.name_family AS decedent_name_family, decedent.name_suffix AS decedent_name_suffix ` +
        `FROM ${MATTER_ESTATE_TABLE} AS estate ` +
        `LEFT JOIN ${DIRECTORY_PERSON_TABLE} AS decedent ` +
        `ON decedent.id = estate.decedent_entity_id AND decedent.deleted_at IS NULL ` +
        `WHERE estate.matter_id = ?1 AND estate.deleted_at IS NULL`,
    )
    .bind(matterId);
}

export function toMatterEstateMergeRow(row: MatterEstateMergeColumns): MatterEstateMergeRow {
  return {
    estateStyle: row.estate_style ?? null,
    shortStyle: row.short_style ?? null,
    dateOfDeath: row.date_of_death ?? null,
    proceedingType: row.proceeding_type ?? null,
    lettersIssuedOn: row.letters_issued_on ?? null,
    decedentDisplayName: row.decedent_display_name ?? null,
    decedentNamePrefix: row.decedent_name_prefix ?? null,
    decedentNameGiven: row.decedent_name_given ?? null,
    decedentNameMiddle: row.decedent_name_middle ?? null,
    decedentNameFamily: row.decedent_name_family ?? null,
    decedentNameSuffix: row.decedent_name_suffix ?? null,
  };
}

// The one estate fact a caller needs BEFORE resolution runs: the asset register's as-of date is
// the estate's date of death, and the asset read takes that date as an input rather than reading
// it itself. The assembly consumer issues this ahead of resolveMergeContext; it lives here so the
// estate table's name stays inside this module's schema-name-synced statements instead of being
// restated inline at the composition root.
export function selectMatterEstateDateOfDeathStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT date_of_death FROM ${MATTER_ESTATE_TABLE} WHERE matter_id = ?1 AND deleted_at IS NULL`,
    )
    .bind(matterId);
}

// The matter's asset register, in ONE statement — the whole of the `asset` source.
//
// ELEVEN SUBJECTS RIDE THIS READ. Every class subject and the aggregate are passes over the rows it
// returns, so a template naming every asset key issues exactly this one query and a template naming
// one issues exactly the same query. Adding the twelfth class adds a left join and no read, which is
// the property the catalogue's shape exists to preserve.
//
// The left joins are per-class attribute tables, each one-to-one on `asset_id`, so the row count is
// the asset count and no join multiplies it. The as-of valuation resolution rides a correlated
// sub-select rather than a second read: it walks (asset_id, as_of_date, recorded_at) backwards and
// stops at the first row, and a valuation a correction supersedes can never be that row.
//
// `account_suffix` is the LAST FOUR CHARACTERS and there is no projection here from which a full
// account number could be produced. No sealed column is named anywhere in this statement, and none
// may be: a merge field that decrypted one would write the secret into an assembled file whose
// confidentiality is then the file's problem, and the audit row would say a decrypt happened without
// saying where the value went. The registry of sealed columns and the scan that holds this line live
// in @magna-carta/data-access; the one legitimate reader is the protected-field chokepoint, reached
// through src/protected-bindings.ts and through nothing else.
export interface MatterAssetMergeRow {
  readonly id: string;
  readonly class: string;
  readonly description: string;
  readonly type_name: string | null;
  readonly estate_treatment: string;
  readonly disposition: string;
  readonly value_amount_minor: number | null;
  readonly value_currency: string | null;
  readonly value_as_of_date: string | null;
  readonly value_basis: string | null;
  // Real property.
  readonly street: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly county: string | null;
  readonly parcel_number: string | null;
  readonly legal_description: string | null;
  // Financial account.
  readonly institution_name: string | null;
  readonly account_suffix: string | null;
  // Vehicle and firearm share make/model.
  readonly make: string | null;
  readonly model: string | null;
  readonly model_year: number | null;
  readonly vehicle_identification_number: string | null;
  readonly caliber_or_gauge: string | null;
  readonly serial_number: string | null;
  // Business interest.
  readonly entity_name: string | null;
  readonly jurisdiction_of_organization: string | null;
  readonly entity_form: string | null;
  // Insurance policy.
  readonly carrier_name: string | null;
  readonly face_amount_minor: number | null;
  readonly face_currency: string | null;
  // Receivable.
  readonly principal_amount_minor: number | null;
  readonly principal_currency: string | null;
  readonly maturity_on: string | null;
  // Digital asset.
  readonly platform_name: string | null;
  readonly account_handle: string | null;
}

export function selectMatterAssetsForMergeStatement(
  database: SqlDatabase,
  matterId: MatterId,
  asOfDate: string,
  limit: number,
): SqlStatement {
  // The one resolved valuation per asset, as of the date. Written once and reused four times so the
  // four projected columns cannot drift out of step with each other and print an amount beside a
  // different row's date.
  const resolvedValuation = (column: string): string =>
    `(SELECT valuation.${column} FROM matter_asset_valuation AS valuation ` +
    `WHERE valuation.asset_id = asset.id AND valuation.encumbrance_id IS NULL ` +
    `AND valuation.as_of_date <= ?2 ` +
    `AND NOT EXISTS (SELECT 1 FROM matter_asset_valuation AS correction ` +
    `WHERE correction.corrects_valuation_id = valuation.id) ` +
    `ORDER BY valuation.as_of_date DESC, valuation.recorded_at DESC, valuation.id DESC LIMIT 1)`;
  return database
    .prepare(
      `SELECT asset.id AS id, asset.class AS class, asset.description AS description, ` +
        `asset_type.name AS type_name, asset.estate_treatment AS estate_treatment, ` +
        `asset.disposition AS disposition, ` +
        `${resolvedValuation("amount_minor")} AS value_amount_minor, ` +
        `${resolvedValuation("currency")} AS value_currency, ` +
        `${resolvedValuation("as_of_date")} AS value_as_of_date, ` +
        `${resolvedValuation("basis")} AS value_basis, ` +
        `real_property.street AS street, real_property.city AS city, real_property.region AS region, ` +
        `real_property.postal AS postal, real_property.county AS county, ` +
        `real_property.parcel_number AS parcel_number, real_property.legal_description AS legal_description, ` +
        `financial_account.institution_name AS institution_name, ` +
        `(SELECT identifier.display_suffix FROM matter_asset_identifier AS identifier ` +
        `WHERE identifier.asset_id = asset.id ORDER BY identifier.created_at ASC, identifier.id ASC LIMIT 1) AS account_suffix, ` +
        `COALESCE(vehicle.make, firearm.make) AS make, COALESCE(vehicle.model, firearm.model) AS model, ` +
        `vehicle.model_year AS model_year, vehicle.vehicle_identification_number AS vehicle_identification_number, ` +
        `firearm.caliber_or_gauge AS caliber_or_gauge, firearm.serial_number AS serial_number, ` +
        `business_interest.entity_name AS entity_name, ` +
        `business_interest.jurisdiction_of_organization AS jurisdiction_of_organization, ` +
        `business_interest.entity_form AS entity_form, ` +
        `insurance_policy.carrier_name AS carrier_name, insurance_policy.face_amount_minor AS face_amount_minor, ` +
        `insurance_policy.face_currency AS face_currency, ` +
        `receivable.principal_amount_minor AS principal_amount_minor, ` +
        `receivable.principal_currency AS principal_currency, receivable.maturity_on AS maturity_on, ` +
        `digital_asset.platform_name AS platform_name, digital_asset.account_handle AS account_handle ` +
        `FROM ${MATTER_ASSET_TABLE} AS asset ` +
        `LEFT JOIN matter_asset_type AS asset_type ON asset_type.id = asset.asset_type_id ` +
        `LEFT JOIN matter_asset_real_property AS real_property ON real_property.asset_id = asset.id ` +
        `LEFT JOIN matter_asset_financial_account AS financial_account ON financial_account.asset_id = asset.id ` +
        `LEFT JOIN matter_asset_vehicle AS vehicle ON vehicle.asset_id = asset.id ` +
        `LEFT JOIN matter_asset_firearm AS firearm ON firearm.asset_id = asset.id ` +
        `LEFT JOIN matter_asset_business_interest AS business_interest ON business_interest.asset_id = asset.id ` +
        `LEFT JOIN matter_asset_insurance_policy AS insurance_policy ON insurance_policy.asset_id = asset.id ` +
        `LEFT JOIN matter_asset_receivable AS receivable ON receivable.asset_id = asset.id ` +
        `LEFT JOIN matter_asset_digital_asset AS digital_asset ON digital_asset.asset_id = asset.id ` +
        `WHERE asset.matter_id = ?1 AND asset.deleted_at IS NULL ` +
        `ORDER BY asset.class ASC, asset.created_at ASC, asset.id ASC LIMIT ?3`,
    )
    .bind(matterId, asOfDate, limit);
}

export interface MatterMergeRow {
  readonly id: MatterId;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly locationId: LocationId | null;
  readonly clientDisplayName: string | null;
  readonly clientCode: string | null;
  readonly matterNumber: string | null;
  readonly openedAt: string | null;
  readonly eBilling: number;
}

export function selectMatterForMergeStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, title, description, status, location_id, client_display_name, client_code, matter_number, opened_at, e_billing FROM ${MATTER_TABLE} WHERE id = ?1`,
    )
    .bind(matterId);
}

export interface MatterMergeColumns {
  id: string;
  title: string;
  description: string | null;
  status: string;
  location_id: string | null;
  client_display_name: string | null;
  client_code: string | null;
  matter_number: string | null;
  opened_at: string | null;
  e_billing: number;
}

export function toMatterMergeRow(row: MatterMergeColumns): MatterMergeRow {
  return {
    id: row.id as MatterId,
    title: row.title,
    description: row.description,
    status: row.status,
    locationId: row.location_id as LocationId | null,
    clientDisplayName: row.client_display_name,
    clientCode: row.client_code,
    matterNumber: row.matter_number,
    openedAt: row.opened_at,
    eBilling: row.e_billing ?? 0,
  };
}

export interface LocationMergeRow {
  readonly id: LocationId;
  readonly name: string;
  readonly jurisdiction: string | null;
  // The office's IANA time zone, or null for an office recorded before the column existed. Read here
  // because it is the fact timeZoneForLocation resolves — one column on a read that already happens.
  readonly timeZone: string | null;
  readonly addressBlock: string | null;
  readonly footer: string | null;
  readonly remitTo: string | null;
  // The letterhead logo, as a REFERENCE rather than as bytes: the object key plus the box the office set
  // for it. The bytes live in the firm's own bucket and are fetched through the reader the caller
  // supplies, so this module keeps its one job — reading the firm's database — and no merge read ever
  // pulls a megabyte of image out of D1. The stored content type is deliberately NOT read: resolution
  // decides what the bytes are by reading them, so carrying the claim here would only invite trusting it.
  readonly letterheadLogoObjectKey: string | null;
  readonly letterheadLogoWidthEmu: number | null;
}

export function selectLocationForMergeStatement(
  database: SqlDatabase,
  locationId: LocationId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, name, jurisdiction, time_zone, address_block, footer, remit_to, letterhead_logo_object_key, letterhead_logo_width_emu FROM ${LOCATION_TABLE} WHERE id = ?1`,
    )
    .bind(locationId);
}

export interface LocationMergeColumns {
  id: string;
  name: string;
  jurisdiction: string | null;
  time_zone: string | null;
  address_block: string | null;
  footer: string | null;
  remit_to: string | null;
  letterhead_logo_object_key: string | null;
  letterhead_logo_width_emu: number | null;
}

// The matter's linked parties, as ONE read for the whole collection. A repeating block over a
// collection never costs a read per item — that is the same batching rule every other source obeys, and
// a repeat is the first place it could plausibly be broken.
//
// The Directory name is joined here rather than fetched per party for the same reason. A party whose
// Directory entity is soft-deleted or missing still appears, with no name: a document that silently
// omitted a party would be worse than one that shows the gap.
export interface MatterPartyMergeRow {
  readonly displayName: string | null;
  readonly role: string;
  // The capacity the party acts in on this matter, as the firm recorded it on the link — or null
  // where none was recorded, which resolution reports as an honest absence, never a guess.
  readonly capacity: string | null;
  readonly kind: "person" | "organisation" | "unknown";
  // The recorded name PARTS, projected on the read that already joins the Directory name tables for the
  // display name. A format can only render what the value carries — "Ashcroft, Rowan" is not derivable
  // from "Rowan Ashcroft" — so the parts ride here rather than becoming a second read, and a part the
  // record does not separate out stays null, which is a declared absence at rendering rather than a
  // guess. An organisation has none of them.
  readonly namePrefix: string | null;
  readonly nameGiven: string | null;
  readonly nameMiddle: string | null;
  readonly nameFamily: string | null;
  readonly nameSuffix: string | null;
  // The Directory entity the link points at. Read because a protected merge field has to name WHOSE
  // sealed identifier it wants, and the client's link is the fact that says so — one column on a read
  // that already happens, rather than a second query to find out who the client is. It is never a merge
  // VALUE: a handle is not a fact a document can state, which is the same reason a reference custom
  // field prints its record's label instead.
  readonly entityId: string;
}

export function selectMatterPartiesForMergeStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT matter_party.role AS role,
              matter_party.capacity AS capacity,
              matter_party.entity_id AS entity_id,
              COALESCE(directory_person.display_name, directory_organization.display_name, directory_organization.legal_name) AS display_name,
              directory_person.name_prefix AS name_prefix,
              directory_person.name_given AS name_given,
              directory_person.name_middle AS name_middle,
              directory_person.name_family AS name_family,
              directory_person.name_suffix AS name_suffix,
              CASE
                WHEN directory_person.id IS NOT NULL THEN 'person'
                WHEN directory_organization.id IS NOT NULL THEN 'organisation'
                ELSE 'unknown'
              END AS kind
         FROM ${MATTER_PARTY_TABLE} AS matter_party
         LEFT JOIN ${DIRECTORY_PERSON_TABLE} AS directory_person
                ON directory_person.id = matter_party.entity_id AND directory_person.deleted_at IS NULL
         LEFT JOIN ${DIRECTORY_ORGANIZATION_TABLE} AS directory_organization
                ON directory_organization.id = matter_party.entity_id AND directory_organization.deleted_at IS NULL
        WHERE matter_party.matter_id = ?1
          AND matter_party.deleted_at IS NULL
        ORDER BY matter_party.role, matter_party.created_at, matter_party.id`,
    )
    .bind(matterId);
}

export interface MatterPartyMergeColumns {
  role: string;
  capacity?: string | null;
  entity_id: string;
  display_name: string | null;
  name_prefix: string | null;
  name_given: string | null;
  name_middle: string | null;
  name_family: string | null;
  name_suffix: string | null;
  kind: string;
}

export function toMatterPartyMergeRow(row: MatterPartyMergeColumns): MatterPartyMergeRow {
  return {
    displayName: row.display_name,
    role: row.role,
    capacity: row.capacity ?? null,
    entityId: row.entity_id,
    namePrefix: row.name_prefix ?? null,
    nameGiven: row.name_given ?? null,
    nameMiddle: row.name_middle ?? null,
    nameFamily: row.name_family ?? null,
    nameSuffix: row.name_suffix ?? null,
    kind:
      row.kind === "person" ? "person" : row.kind === "organisation" ? "organisation" : "unknown",
  };
}

export function toLocationMergeRow(row: LocationMergeColumns): LocationMergeRow {
  return {
    id: row.id as LocationId,
    name: row.name,
    jurisdiction: row.jurisdiction,
    timeZone: row.time_zone,
    addressBlock: row.address_block,
    footer: row.footer,
    remitTo: row.remit_to,
    letterheadLogoObjectKey: row.letterhead_logo_object_key,
    letterheadLogoWidthEmu: row.letterhead_logo_width_emu,
  };
}
