// A stored source file as text, in the order it is stored and a piece at a time, which is what the
// reader in @magna-carta/record-transfer takes. Nothing is buffered: the size of a file is not a
// limit on reading it.
//
// The bytes are read as UTF-8. A file in another encoding still reads as rows, because the
// delimiters and line endings are the same bytes, and a letter outside ASCII arrives as the
// replacement character; a named encoding per file is the reader's next option when a real export
// needs one.
export async function sourceFileText(
  bucket: R2Bucket,
  objectKey: string,
): Promise<AsyncIterable<string> | null> {
  const object = await bucket.get(objectKey);
  if (object === null) return null;
  return decoded(object.body);
}

async function* decoded(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text.length > 0) yield text;
    }
    const rest = decoder.decode();
    if (rest.length > 0) yield rest;
  } finally {
    // Reached when the caller stops early (a preview reads three rows) as well as at the end, so
    // the object's stream is never left open.
    await reader.cancel().catch(() => undefined);
  }
}
