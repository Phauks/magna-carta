// On-demand self-test for the bundle container, exercised after a Cloudflare deploy (the container is a
// Docker image that can't run under the local test pool, so this is how we prove the deployed image
// works end to end). It drives the real container through both lanes against the real R2 binding — the
// outbound-Workers mediation the local Python stub only approximates — and cleans up after itself.
//
// The checks VERIFY CONTENT, not just plumbing, so a green report can be trusted: the buffered archive is
// a complete ZIP that actually contains the seeded bytes; the encrypted lane's archive must NOT contain
// those bytes (proving encryption really happened); the 7z split volumes are read back from R2 and
// reassemble into a real 7z. Every CONTAINER call is time-bounded, so a wedged container — the exact
// thing this exists to catch — yields a failed report rather than a hang. (The R2 binding calls are not
// separately bounded; they rely on R2's own reliability.)
//
// It is GUARDED and disabled by default: the route returns 404 unless BUNDLE_SELF_TEST_KEY is set on the
// worker AND the request presents it. Safe to ship on every environment; only an operator who sets the
// secret and sends it can run it. The guard + cleanup-and-assert PATTERN here is the template other
// container subsystems can copy; the checks themselves are bundle-specific and must be rewritten per
// subsystem.
import type { BundleContainerFetcher } from "./forward-build.ts";

export interface SelfTestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestReport {
  ok: boolean;
  runId: string;
  checks: SelfTestCheck[];
  elapsedMs: number;
}

// Compare the configured key against the presented one without leaking length or timing: hash both with
// SHA-256 (fixed 32-byte digests) and compare in constant time. Fail-closed when no key is configured.
export async function selfTestAuthorized(
  expected: string | undefined,
  provided: string | null,
): Promise<boolean> {
  if (!expected || provided === null) return false;
  const encoder = new TextEncoder();
  const [expectedDigest, providedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
  ]);
  const expectedBytes = new Uint8Array(expectedDigest);
  const providedBytes = new Uint8Array(providedDigest);
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= (expectedBytes[i] ?? 0) ^ (providedBytes[i] ?? 0);
  }
  return diff === 0;
}

// Per-container-call time budgets. A build can take minutes for large inputs; /ready should answer fast.
const READY_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 5 * 60_000;

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — a ZIP entry
const ZIP_EOCD = [0x50, 0x4b, 0x05, 0x06]; // "PK\x05\x06" — End Of Central Directory (a complete ZIP)
const SEVEN_Z_SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]; // "7z\xBC\xAF\x27\x1C"

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

function containsSequence(haystack: Uint8Array, needle: number[]): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// A complete (non-truncated) ZIP: starts with a local file header and carries the End Of Central
// Directory record — far stronger than a 4-byte magic match.
function isCompleteZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, ZIP_LOCAL_HEADER) && containsSequence(bytes, ZIP_EOCD);
}

async function bytesOf(object: R2ObjectBody): Promise<Uint8Array> {
  return new Uint8Array(await object.arrayBuffer());
}

// List every key under `prefix`, following the list cursor (never assume a single page).
async function listKeys(r2: R2Bucket, prefix: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const listed: R2Objects = await r2.list({ prefix, cursor });
    for (const object of listed.objects) keys.add(object.key);
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return keys;
}

// Delete every object under `prefix` (R2 delete takes up to 1000 keys per call).
async function deletePrefix(r2: R2Bucket, prefix: string): Promise<void> {
  const keys = [...(await listKeys(r2, prefix))];
  for (let i = 0; i < keys.length; i += 1000) {
    await r2.delete(keys.slice(i, i + 1000));
  }
}

function jsonRequest(url: string, body: unknown, timeoutMs: number): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Run the full container round-trip and return a structured pass/fail report. Never throws — any error
 * (including a per-call timeout) is recorded as a failed check naming the step — and always cleans up the
 * R2 objects it created, success or failure, asserting afterward that nothing was left behind.
 */
export async function runSelfTest(
  container: BundleContainerFetcher,
  r2: R2Bucket,
): Promise<SelfTestReport> {
  const start = Date.now();
  const runId = crypto.randomUUID();
  // Trailing slash makes the cleanup bound explicit; isolation rests on the random run id.
  const prefix = `selftest/${runId}/`;
  const checks: SelfTestCheck[] = [];
  const record = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });
  // A distinctive content marker that cannot appear by coincidence: the buffered (store) archive must
  // contain it verbatim; the encrypted archive must NOT (that is how we prove encryption happened).
  const marker = `magna-selftest-marker-${runId}`;
  const markerBytes = new TextEncoder().encode(marker);

  let step = "start";
  try {
    // 1. The container is up.
    step = "/ready";
    const ready = await container.fetch(
      new Request("http://bundle/ready", { signal: AbortSignal.timeout(READY_TIMEOUT_MS) }),
    );
    record("container /ready responds 200", ready.status === 200, `status ${ready.status}`);

    // 2. Seed an input object in R2 (the container reaches it through the outbound handler).
    const inputKey = `${prefix}inputs/a`;
    await r2.put(inputKey, markerBytes);
    const baseEntries = [
      { archivePath: "a.txt", mtimeEpochSecs: null, source: "r2", r2Key: inputKey },
      {
        archivePath: "CONTENTS.txt",
        mtimeEpochSecs: null,
        source: "inline",
        bytesBase64: btoa("CONTENTS"),
      },
    ];

    // 3. Buffered ZIP build (store, no encryption) → one volume PUT back to R2.
    step = "buffered build";
    const outputKey = `${prefix}out/bundle.zip`;
    const buildResponse = await container.fetch(
      jsonRequest(
        "http://bundle/build",
        {
          jobId: runId,
          format: "zip",
          compression: "store",
          encryption: null,
          split: null,
          entries: baseEntries,
          outputKeyPrefix: outputKey,
        },
        BUILD_TIMEOUT_MS,
      ),
    );
    let reportedSize: number | null = null;
    if (buildResponse.status === 200) {
      const parsed = (await buildResponse.json()) as {
        ok: boolean;
        volumes: { key: string; sizeBytes: number }[];
      };
      const single = parsed.ok === true && parsed.volumes.length === 1;
      record(
        "buffered build returns ok with one volume",
        single,
        `volumes=${parsed.volumes.length}`,
      );
      reportedSize = parsed.volumes[0]?.sizeBytes ?? null;
    } else {
      record("buffered build returns ok with one volume", false, `status ${buildResponse.status}`);
    }

    // 4. The output landed in R2, is a COMPLETE ZIP, contains the seeded bytes, and matches reported size.
    step = "verify buffered output";
    const written = await r2.get(outputKey);
    if (written) {
      const bytes = await bytesOf(written);
      record(
        "buffered output is a complete ZIP in R2",
        isCompleteZip(bytes),
        `bytes=${bytes.length}`,
      );
      record(
        "buffered (store) archive contains the seeded content",
        containsSequence(bytes, [...markerBytes]),
        "marker present",
      );
      if (reportedSize !== null) {
        record(
          "reported volume size matches the R2 object",
          reportedSize === bytes.length,
          `${reportedSize} vs ${bytes.length}`,
        );
      }
    } else {
      record("buffered output is a complete ZIP in R2", false, "object not found");
    }

    // 5. Streaming (encrypted) lane: the archive streams straight back, is a real ZIP, must NOT contain
    //    the plaintext marker (proves encryption), and must persist NOTHING anywhere under the run prefix.
    step = "streaming build";
    const keysBeforeStream = await listKeys(r2, prefix);
    const streamKey = `${prefix}stream/bundle.zip`;
    const streamResponse = await container.fetch(
      jsonRequest(
        "http://bundle/build?stream=1",
        {
          jobId: runId,
          format: "zip",
          compression: "store",
          encryption: { password: "self-test-password", encryptFileNames: false },
          split: null,
          entries: baseEntries,
          outputKeyPrefix: streamKey,
        },
        BUILD_TIMEOUT_MS,
      ),
    );
    if (streamResponse.status === 200) {
      const streamed = new Uint8Array(await streamResponse.arrayBuffer());
      record(
        "streaming lane returns a complete ZIP",
        isCompleteZip(streamed),
        `bytes=${streamed.length}`,
      );
      record(
        "streaming (encrypted) archive does NOT contain the plaintext content",
        !containsSequence(streamed, [...markerBytes]),
        "marker absent → content encrypted",
      );
      const keysAfterStream = await listKeys(r2, prefix);
      const newKeys = [...keysAfterStream].filter((k) => !keysBeforeStream.has(k));
      record(
        "streaming lane persists nothing under the run prefix",
        newKeys.length === 0,
        `new keys: ${newKeys.length}`,
      );
    } else {
      record("streaming lane returns a complete ZIP", false, `status ${streamResponse.status}`);
      record(
        "streaming (encrypted) archive does NOT contain the plaintext content",
        false,
        "stream request failed",
      );
      record(
        "streaming lane persists nothing under the run prefix",
        false,
        "stream request failed",
      );
    }

    // 6. 7z multi-volume split: an incompressible input forced into small parts → several volumes that
    //    EXIST in R2 and reassemble (in order) into a real 7z.
    step = "7z split build";
    const bigKey = `${prefix}inputs/big`;
    // 8000 incompressible bytes ≫ several × the 1024-byte part size below, so a correct 7z store always
    // spans multiple volumes (keep this ratio if either constant changes).
    const big = new Uint8Array(8000);
    crypto.getRandomValues(big);
    await r2.put(bigKey, big);
    const splitPrefix = `${prefix}out/bundle.7z`;
    const splitResponse = await container.fetch(
      jsonRequest(
        "http://bundle/build",
        {
          jobId: runId,
          format: "sevenZip",
          compression: "store",
          encryption: null,
          split: { maxPartBytes: 1024 },
          entries: [{ archivePath: "big.bin", mtimeEpochSecs: null, source: "r2", r2Key: bigKey }],
          outputKeyPrefix: splitPrefix,
        },
        BUILD_TIMEOUT_MS,
      ),
    );
    if (splitResponse.status === 200) {
      const parsed = (await splitResponse.json()) as {
        ok: boolean;
        volumes: { key: string; sizeBytes: number }[];
      };
      const multi =
        parsed.ok === true &&
        parsed.volumes.length > 1 &&
        (parsed.volumes[0]?.key.endsWith(".001") ?? false);
      record("7z split reports multiple .NNN volumes", multi, `volumes=${parsed.volumes.length}`);

      step = "verify 7z volumes";
      const reassembled: Uint8Array[] = [];
      let allExist = true;
      for (const volume of parsed.volumes) {
        const part = await r2.get(volume.key);
        if (!part) {
          allExist = false;
          break;
        }
        const partBytes = await bytesOf(part);
        if (partBytes.length === 0 || partBytes.length !== volume.sizeBytes) {
          allExist = false;
          break;
        }
        reassembled.push(partBytes);
      }
      record(
        "every reported 7z volume exists in R2 at its reported size",
        allExist,
        allExist ? "" : "a volume was missing, empty, or size-mismatched",
      );
      if (allExist) {
        const joined = concat(reassembled);
        record(
          "reassembled 7z volumes start with the 7z signature",
          startsWith(joined, SEVEN_Z_SIGNATURE),
        );
      }
    } else {
      record("7z split reports multiple .NNN volumes", false, `status ${splitResponse.status}`);
    }
  } catch (error) {
    record(`self-test failed during ${step}`, false, String(error));
  } finally {
    // Always clean up, then positively assert nothing was left behind.
    try {
      await deletePrefix(r2, prefix);
      const remaining = await listKeys(r2, prefix);
      record(
        "cleanup removed all self-test objects",
        remaining.size === 0,
        `remaining=${remaining.size}`,
      );
      if (remaining.size > 0) {
        // Surface a leak in Workers Logs (runId + count only — never the marker/password) so orphaned
        // objects under selftest/ are discoverable even if the caller ignores the report.
        console.warn(`bundle self-test left ${remaining.size} object(s) under selftest/${runId}/`);
      }
    } catch (error) {
      record("cleanup removed all self-test objects", false, String(error));
      console.warn(`bundle self-test cleanup failed for selftest/${runId}/`);
    }
  }

  const ok = checks.length > 0 && checks.every((c) => c.ok);
  if (!ok) {
    console.warn(
      `bundle self-test ${runId} reported ${checks.filter((c) => !c.ok).length} failed check(s)`,
    );
  }
  return { ok, runId, checks, elapsedMs: Date.now() - start };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
