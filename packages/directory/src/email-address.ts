/*
 * Whether a string is an email address the firm could send to.
 *
 * One mailbox, one @, one domain with a dot in it and nothing a mail server would refuse on sight.
 * It is not the RFC's full grammar — quoted local parts and bracketed literals exist and nobody
 * types them into a contact record — and it is not a deliverability check either: that is what
 * verification is for, after the fact. It is the check that catches the address typed without its
 * domain, with a space in it, or with the @ in the wrong place, before it is recorded.
 *
 * Pure, and imported by both the API's request schema and the screen's live refusal, so the two
 * never disagree about what an address is.
 */

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function isEmailAddress(candidate: string): boolean {
  const value = candidate.trim();
  if (value.length < 3 || value.length > 320) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  const top = labels.at(-1) ?? "";
  return top.length >= 2 && !/^[0-9]+$/.test(top);
}

/** The sentence beside the field when a typed address is not one. */
export const EMAIL_ADDRESS_REFUSAL = "A mailbox and a domain, as name@firm.com.";
