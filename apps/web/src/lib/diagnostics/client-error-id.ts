/*
 * The handle for a failure the platform never saw.
 *
 * A crash inside a component, an unhandled rejection, a throw in an event handler — none of these
 * reach the API, so none of them get an `error_…` from the server's error boundary. Without a handle
 * there is nothing for a person to quote and nothing for support to search, which is how a crash
 * becomes "it just stopped working" and stays that way.
 *
 * The prefix is DELIBERATELY not the platform's. `error_` handles resolve to a server-side trace;
 * a client-minted one resolves to nothing, and a handle that looks like it should resolve and does
 * not costs somebody a search. It is also why the incident route never receives one in `errorIds` —
 * that field is validated against the platform's own shape, so a `client_` handle travels in the
 * report's words instead, where it is honest about what it is.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A short, transcribable handle. Crockford-style: no I, L, O or U, so nothing is misread over the
 * phone or mistyped out of a screenshot.
 */
export function newClientErrorId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // A handle with less entropy still beats no handle: this exists so a crash on a platform without
    // the Web Crypto API is reportable rather than anonymous.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let handle = "";
  for (const byte of bytes) handle += ALPHABET[byte % ALPHABET.length];
  return `client_${handle}`;
}
