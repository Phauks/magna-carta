// The version of the disclosure text a member accepts before their first turn. It is a code constant
// rather than a setting because it describes what the platform does, which a firm does not get to
// edit.
//
// Bump it whenever what Magnus can SEE or what Magnus can DO changes — the day it can read matter
// documents is the obvious one. Every member's stored acknowledgement then no longer matches the
// current version, so every member is re-prompted automatically and accepts the new statement before
// their next turn. An acknowledgement without a version is an acknowledgement of an unknown thing,
// which is why the stored row carries this number and the consent resolver compares against it.
//
// Version 2: what Magnus can SEE changed. A member can attach a matter's files to a conversation, and
// the readable text of those files is sent with the question. Nothing else is read.
//
// Version 3: what Magnus can SEE changed again. A member can let one conversation kept on a matter
// read their own other conversations on that matter. It is off until they turn it on, and it never
// reaches a colleague's conversation.
export const MAGNUS_DISCLOSURE_VERSION = 3;
