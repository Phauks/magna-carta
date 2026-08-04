// Ceilings checked against the load profile's custom-field volume: a realistic established firm runs a
// single-digit field count per matter type / entity category and a low-double-digit picklist, so these
// sit comfortably above real usage and far below where the per-record current-value read (which fans
// over a scope's fields) shows any cost. Recalibrate against the load profile before raising them.
export const MAX_FIELDS_PER_SCOPE = 60;
export const MAX_FIELDS_PER_FIRM = 600;
export const MAX_OPTIONS_PER_FIELD = 200;

// The per-value text ceiling. A custom field is an attribute, not a document: a multi-line note of a
// few thousand characters is generous for the longest real use, while an uncapped value would let a
// single record push hundreds of kilobytes into a D1 row that every per-record read fans over. Bulk
// content belongs in R2 behind a file, never in a value column.
export const MAX_VALUE_TEXT_LENGTH = 4_000;

// The widest minor-unit exponent a field may declare. Past this, 10^scale stops being an exact integer
// and the decimal-to-integer scaling on every write silently loses precision (and at a few hundred it
// reaches Infinity); four places past the currency minor unit already covers the finest rate anyone
// records.
export const MAX_NUMBER_SCALE = 6;
