// The custody number itself — CUS-00042 by default — is drawn from the firm's `custody_packet`
// scheme on the firm-wide numbering register (@magna-carta/sequence-numbering/purposes) through the
// shared draw planner, in packet-service.ts. Custodian kept a fixed-shape record of its own here
// until the register consolidated every sequence; nothing ever configured it, so every firm drew
// the default, and the register's default is that same shape so nothing already labelled changes.
//
// What stays custody's own is the item number.

// An item's number is packet-relative — CUS-00042-3 — derived from its ordinal within the packet
// rather than drawn from a counter. An item's identity is only meaningful inside its packet, so a
// second global counter would buy nothing and would be a second race to get right.
export function renderCustodyItemNumber(packetNumber: string, ordinal: number): string {
  return `${packetNumber}-${ordinal}`;
}
