// On-demand self-test for the bundle container, exercised after a Cloudflare deploy (the container is a
// Docker image that can't run under the local test pool, so this is how we prove the deployed image
// works end to end). It drives the real container through both lanes against the real R2 binding — the
// outbound-Workers mediation the local Python stub only approximates — and cleans up after itself.
//
// It is GUARDED and disabled by default: the route returns 404 unless BUNDLE_SELF_TEST_KEY is set on the
// worker AND the request presents it. Safe to ship on every environment; only an operator who sets the
// secret and sends it can run it. This is the template other container subsystems can copy.
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

// Constant-time-ish comparison of the configured key against the presented one. Returns false unless a
// non-empty key is configured and the presented value matches exactly.
export function selfTestAuthorized(expected: string | undefined, provided: string | null): boolean {
  if (!expected || provided === null) return false;
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && ZIP_LOCAL_HEADER.every((b, i) => bytes[i] === b);
}

async function bytesOf(object: R2ObjectBody): Promise<Uint8Array> {
  return new Uint8Array(await object.arrayBuffer());
}

// Delete every object under `prefix`, looping until the listing is exhausted (a self-test run writes only
// a handful, but never assume a single page).
async function deletePrefix(r2: R2Bucket, prefix: string): Promise<void> {
  for (;;) {
    const listed = await r2.list({ prefix });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length > 0) await r2.delete(keys);
    if (!listed.truncated) break;
  }
}

/**
 * Run the full container round-trip and return a structured pass/fail report. Never throws — any error is
 * recorded as a failed check — and always cleans up the R2 objects it created, success or failure.
 */
export async function runSelfTest(
  container: BundleContainerFetcher,
  r2: R2Bucket,
): Promise<SelfTestReport> {
  const start = Date.now();
  const runId = crypto.randomUUID();
  const prefix = `selftest/${runId}`;
  const checks: SelfTestCheck[] = [];
  const record = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  try {
    // 1. The container is up.
    const ready = await container.fetch(new Request("http://bundle/ready"));
    record("container /ready responds 200", ready.status === 200, `status ${ready.status}`);

    // 2. Seed an input object in R2 (reached by the container through the outbound handler).
    const inputKey = `${prefix}/inputs/a`;
    await r2.put(inputKey, new TextEncoder().encode("self-test-input"));

    // 3. Buffered ZIP build: one R2 entry + one inline entry → a single volume PUT back to R2.
    const outputKey = `${prefix}/out/bundle.zip`;
    const baseEntries = [
      { archivePath: "a.txt", mtimeEpochSecs: null, source: "r2", r2Key: inputKey },
      {
        archivePath: "CONTENTS.txt",
        mtimeEpochSecs: null,
        source: "inline",
        bytesBase64: btoa("CONTENTS"),
      },
    ];
    const buildResponse = await container.fetch(
      jsonRequest("http://bundle/build", {
        jobId: runId,
        format: "zip",
        compression: "store",
        encryption: null,
        split: null,
        entries: baseEntries,
        outputKeyPrefix: outputKey,
      }),
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

    // 4. The output landed in R2 and is a real ZIP whose size matches what the container reported.
    const written = await r2.get(outputKey);
    if (written) {
      const bytes = await bytesOf(written);
      record(
        "buffered output is a non-empty ZIP in R2",
        looksLikeZip(bytes) && bytes.length > 0,
        `bytes=${bytes.length}`,
      );
      if (reportedSize !== null) {
        record(
          "reported volume size matches the R2 object",
          reportedSize === bytes.length,
          `${reportedSize} vs ${bytes.length}`,
        );
      }
    } else {
      record("buffered output is a non-empty ZIP in R2", false, "object not found");
    }

    // 5. Streaming (encrypted) lane: the archive streams straight back and NOTHING is persisted.
    const streamKey = `${prefix}/stream/bundle.zip`;
    const streamResponse = await container.fetch(
      jsonRequest("http://bundle/build?stream=1", {
        jobId: runId,
        format: "zip",
        compression: "store",
        encryption: { password: "self-test-password", encryptFileNames: false },
        split: null,
        entries: baseEntries,
        outputKeyPrefix: streamKey,
      }),
    );
    if (streamResponse.status === 200) {
      const streamed = new Uint8Array(await streamResponse.arrayBuffer());
      record(
        "streaming lane returns a non-empty ZIP",
        looksLikeZip(streamed) && streamed.length > 0,
        `bytes=${streamed.length}`,
      );
      const persisted = await r2.get(streamKey);
      record(
        "streaming lane persists nothing in R2",
        persisted === null,
        persisted ? "found a persisted object" : "",
      );
    } else {
      record("streaming lane returns a non-empty ZIP", false, `status ${streamResponse.status}`);
      record("streaming lane persists nothing in R2", false, "stream request failed");
    }

    // 6. 7z multi-volume split: an incompressible input forced into small parts → several volumes.
    const bigKey = `${prefix}/inputs/big`;
    const big = new Uint8Array(8000);
    crypto.getRandomValues(big);
    await r2.put(bigKey, big);
    const splitPrefix = `${prefix}/out/bundle.7z`;
    const splitResponse = await container.fetch(
      jsonRequest("http://bundle/build", {
        jobId: runId,
        format: "sevenZip",
        compression: "store",
        encryption: null,
        split: { maxPartBytes: 1024 },
        entries: [{ archivePath: "big.bin", mtimeEpochSecs: null, source: "r2", r2Key: bigKey }],
        outputKeyPrefix: splitPrefix,
      }),
    );
    if (splitResponse.status === 200) {
      const parsed = (await splitResponse.json()) as { ok: boolean; volumes: { key: string }[] };
      const multi =
        parsed.ok === true &&
        parsed.volumes.length > 1 &&
        (parsed.volumes[0]?.key.endsWith(".001") ?? false);
      record("7z split produces multiple .NNN volumes", multi, `volumes=${parsed.volumes.length}`);
    } else {
      record("7z split produces multiple .NNN volumes", false, `status ${splitResponse.status}`);
    }
  } catch (error) {
    record("self-test ran without throwing", false, String(error));
  } finally {
    // Always clean up — the self-test leaves no objects behind, pass or fail.
    try {
      await deletePrefix(r2, prefix);
    } catch (error) {
      record("cleanup removed all self-test objects", false, String(error));
    }
  }

  const ok = checks.length > 0 && checks.every((c) => c.ok);
  return { ok, runId, checks, elapsedMs: Date.now() - start };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
