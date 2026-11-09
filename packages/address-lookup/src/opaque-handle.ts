/*
 * The offer identifier an adapter hands out and takes back: a JSON value carried as base64url text.
 *
 * Every adapter in this package mints identifiers that carry what `resolve` needs, so that resolving
 * needs no lookup table on this side and survives the index being rebuilt between the offer and the
 * choice. That makes an identifier able to hold an address, which is why it travels only in request
 * bodies, never a URL — and why a decoded one is untrusted: it came back from a browser, so an adapter
 * checks the shape of whatever this answers and treats a shape it did not mint as an offer it does not
 * know.
 */
import type { SuggestedAddressParts } from "./port.ts";

export function encodeOpaqueHandle(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** The decoded object, or undefined for anything that is not base64url JSON describing an object. */
export function decodeOpaqueHandle(identifier: string): Record<string, unknown> | undefined {
  let decoded: unknown;
  try {
    const base64 = identifier.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return undefined;
  return decoded as Record<string, unknown>;
}

const PART_KEYS = [
  "street",
  "streetTwo",
  "dependentLocality",
  "city",
  "region",
  "postal",
  "sortingCode",
  "country",
] as const;

/** Only the known string parts survive a round trip through the browser; anything else is dropped. */
export function partsFrom(value: unknown): SuggestedAddressParts | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const parts: Record<string, string> = {};
  for (const key of PART_KEYS) {
    const part = source[key];
    if (typeof part === "string" && part !== "") parts[key] = part;
  }
  return parts;
}
