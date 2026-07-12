export type {
  RegistrationResult,
  DomainRegistration,
  IpNetworkRegistration,
  LegacyWhoisRecord,
  LookupProvenance,
  FieldState,
  RdapContact,
  AbuseContact,
  Nameserver,
  DsData,
  SecureDns,
  RdapEvent,
  Registrar,
  RdapRemark,
  WhoisSocket,
  WhoisDeps,
} from "./types.ts";
export { lookupRegistration } from "./lookup.ts";
export { WhoisTransportError } from "./errors.ts";
