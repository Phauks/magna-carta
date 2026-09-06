---
category: Changed
audience: internal
---

**An identifier is a shape, checked before it is sealed.** `packages/directory/src/identifier-shape.ts` declares what each kind is made of — SSN nine digits, EIN nine in two groups, licence region + number, bar number jurisdiction + number, account held-with + number + username + secret — and `checkIdentifier` refuses a value that does not fit with the sentence the screen shows beside the field; the API runs the same check on `AddIdentifierRequest` (now `type`, `label`, `number`, `username`, `secret`) and on every identifier in a create. `directory_identifier` gains a nullable plaintext `label` (migration `20260903T090000_directory-identifier-label`) so the enumeration can say what a sealed value is of. An account's sealed value is the JSON of its three parts; its blind index normalizes the number alone, so the username and secret never reach an index; the reveal route hands the parts back apart.

**The `dob` kind is gone.** A date of birth is a date on the person, in the clear, beside the date of death; a sealed birthday could be neither shown nor used to tell two people apart. The sealed `client.dateOfBirth` merge field went with it — a plain field from the person's date column is a document-assembly follow-up.

**Email and phone rules are shared.** `packages/directory/src/email-address.ts` is the one email check, used by the API's `prepareAddress` and the screen's live refusal. The web app takes `libphonenumber-js` (already in the lockfile through `class-validator`) for dial codes, as-you-type national formatting and E.164 submission; the server's own parser is unchanged and receives the international form with the region beside it.
