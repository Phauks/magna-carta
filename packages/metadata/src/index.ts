export const PACKAGE_NAME = "@magna-carta/metadata";
export { createMetadataPort } from "./metadata.ts";
export { SCRUB_ALL } from "./options.ts";
export type { ScrubOptions } from "./options.ts";
export type { Finding, FindingCategory, MetadataReport, RiskLevel } from "./model.ts";
export type {
  InspectOutcome,
  MetadataFailure,
  MetadataInput,
  MetadataPort,
  ScrubOutcome,
} from "./port.ts";
export type { SupportedFormat } from "./detect.ts";
