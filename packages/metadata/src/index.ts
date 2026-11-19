export const PACKAGE_NAME = "@magna-carta/metadata";
export { createMetadataPort } from "./metadata.ts";
export { MAX_INPUT_BYTES } from "./guards.ts";
export { SCRUB_ALL } from "./options.ts";
export type { ScrubOptions } from "./options.ts";
export { MAX_FIELD_TEXT_LENGTH, MAX_FIELDS_PER_FINDING } from "./fields.ts";
export { withoutFieldValues } from "./model.ts";
export type {
  DocumentPart,
  FieldMoment,
  FieldValue,
  Finding,
  FindingCategory,
  FindingField,
  MetadataReport,
  RevisionKind,
  RiskLevel,
} from "./model.ts";
export type {
  InspectOutcome,
  MetadataFailure,
  MetadataInput,
  MetadataPort,
  ScrubOutcome,
} from "./port.ts";
export type { SupportedFormat } from "./detect.ts";
