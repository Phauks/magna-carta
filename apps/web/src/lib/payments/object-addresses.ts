/*
 * A chosen file's object URL, made once per file and handed back on every later ask, so a list that
 * redraws does not mint a new URL (and leak the old one) each time. `releaseObjectAddress` frees it
 * when the file is taken off the form.
 */
const addresses = new WeakMap<Blob, string>();

export function objectAddress(file: Blob): string {
  const known = addresses.get(file);
  if (known !== undefined) return known;
  const made = URL.createObjectURL(file);
  addresses.set(file, made);
  return made;
}

export function releaseObjectAddress(file: Blob): void {
  const known = addresses.get(file);
  if (known === undefined) return;
  URL.revokeObjectURL(known);
  addresses.delete(file);
}
