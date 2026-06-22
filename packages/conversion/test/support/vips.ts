// Shared, memoized wasm-vips for test fixtures. Each `Vips()` call allocates a large WebAssembly
// heap, so loading one per fixture call exhausts memory across the suite — this loads it once per
// test file and reuses it.
let vipsPromise: Promise<Awaited<ReturnType<typeof load>>> | undefined;

async function load() {
  const Vips = (await import("wasm-vips")).default;
  return Vips();
}

function vips() {
  vipsPromise ??= load();
  return vipsPromise;
}

// A tiny valid image of the given format (by libvips write suffix, e.g. ".png", ".jpg", ".webp").
// Uint8Array.from yields an ArrayBuffer-backed view so the bytes satisfy BlobPart at call sites.
export async function makeImage(
  suffix: string,
  width = 2,
  height = 3,
): Promise<Uint8Array<ArrayBuffer>> {
  const instance = await vips();
  return Uint8Array.from(instance.Image.black(width, height).writeToBuffer(suffix));
}

// The pixel dimensions of an encoded image (decodes via the same memoized instance).
export async function imageSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const instance = await vips();
  const image = instance.Image.newFromBuffer(bytes);
  return { width: image.width, height: image.height };
}
