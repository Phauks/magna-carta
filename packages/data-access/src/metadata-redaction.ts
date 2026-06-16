// Shared redaction canary for audit metadata. The audit builders are dumb — they canonical-stringify
// whatever they are given — so redaction discipline lives at the call sites. This canary refuses any
// key CONTAINING `password` as a substring, anywhere in the metadata (case-insensitive, nested) —
// catching `newPassword`, `currentPassword`, `passwordHash`, not just the bare word. It is a tripwire
// for the most obvious leak, not a guarantee. A *value* mentioning the word is fine — only a key
// trips it. No benign key currently contains the substring; if one ever legitimately does, add an
// explicit allowlist here.
export function refuseUnredactedMetadata(value: unknown, tableLabel: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) refuseUnredactedMetadata(entry, tableLabel);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase().includes("password")) {
        throw new Error(
          `${tableLabel} metadata key '${key}' contains 'password' — redact at the call site before logging`,
        );
      }
      refuseUnredactedMetadata(entry, tableLabel);
    }
  }
}
