// The shared R2-to-zip input source for the bulk-download paths. Both the inline ZIP stream
// (apps/api-worker routes/files/downloads.ts) and the async background build (apps/api-worker
// downloads/bundle-consumer.ts) turn a resolved set of {r2Key, path} entries into the
// {name, input} stream client-zip's makeZip consumes — fetching each object's body from R2 and
// skipping any that was reaped between resolution and streaming. Extracted so the two paths share one
// implementation of "fetch these keys, skip the gone ones, name them by their archive path" rather
// than carrying the generator twice.

// The minimal R2 read seam this needs: fetch an object's streaming body by key, or null when the
// object is gone. The Worker passes its real R2 binding, which is structurally a superset; modelling
// only `get` keeps this package free of @cloudflare/workers-types, like its other seams.
export interface ZipSourceBucket {
  get(key: string): Promise<{ readonly body: ReadableStream<Uint8Array> } | null>;
}

// The minimal entry shape: an opaque R2 key to fetch and the archive path to name it by. Both the
// resolved ZipEntry (zip-composition.ts) and the bundle-build message entry satisfy it structurally.
export interface ZipSourceEntry {
  readonly r2Key: string;
  readonly path: string;
}

// Streams each entry's R2 object body as a named zip input. A null object (reaped between resolve and
// stream) is skipped, never thrown — a single missing file must not abort the whole archive. Order is
// preserved, so the archive matches the resolved (sorted, disambiguated) entry order.
export async function* zipEntriesFromR2(
  bucket: ZipSourceBucket,
  entries: Iterable<ZipSourceEntry>,
): AsyncGenerator<{ name: string; input: ReadableStream<Uint8Array> }> {
  for (const entry of entries) {
    const object = await bucket.get(entry.r2Key);
    if (object === null) continue;
    yield { name: entry.path, input: object.body };
  }
}
