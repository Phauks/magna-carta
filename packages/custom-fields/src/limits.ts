// Ceilings checked against the load profile's custom-field volume: a realistic established firm runs a
// single-digit field count per matter type / entity category and a low-double-digit picklist, so these
// sit comfortably above real usage and far below where the per-record current-value read (which fans
// over a scope's fields) shows any cost. Recalibrate against the load profile before raising them.
export const MAX_FIELDS_PER_SCOPE = 60;
export const MAX_FIELDS_PER_FIRM = 600;
export const MAX_OPTIONS_PER_FIELD = 200;
