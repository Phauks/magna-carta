// Generates the trigger-sample corpus the browser harness scans against the live scan container.
// Each file is crafted to drive one specific verdict path in the Rust engine — see the expected
// verdict beside each writer below, cross-referenced to the detection code in ../src.
//
// Run: node generate-samples.mjs            (writes ./samples, skips the multi-GB timing file)
//      node generate-samples.mjs --big 1024 (also writes ./samples/big-1024.bin = 1024 MiB random)
//
// The samples directory is gitignored: it holds the EICAR test string and archive-bomb shapes, which
// must never enter version control (a committed EICAR file trips the developer's own antivirus, and a
// committed bomb is a footgun). Regenerate locally instead.

import { Buffer } from "node:buffer";
import { randomFillSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const samplesDirectory = join(here, "samples");

// --- a minimal ZIP writer (no dependencies) -------------------------------------------------------
// Enough of the format to drive the archive heuristics: STORED and DEFLATE entries, and the
// encrypted-bit flag. Cross-platform CRC-32 comes from zlib (Node 20+). The archive caps the engine
// enforces live in ../src/heuristics/mod.rs (ArchiveCaps::default + scan_archive).

const SIGNATURE_LOCAL = 0x04034b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_EOCD = 0x06054b50;
const DOS_DATE_1980 = 0x21; // month 1, day 1 — a zero date trips strict readers.

function crc32(buffer) {
  return zlib.crc32(buffer) >>> 0;
}

/**
 * Builds a ZIP archive from entry descriptors.
 * @param {{name: string, data: Buffer, method?: 0|8, encrypted?: boolean}[]} entries
 * @returns {Buffer}
 */
function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflate = entry.method === 8;
    const uncompressed = entry.data;
    const compressed = deflate ? zlib.deflateRawSync(uncompressed, { level: 9 }) : uncompressed;
    const crc = crc32(uncompressed);
    const flags = entry.encrypted ? 0x0001 : 0x0000;
    const method = deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIGNATURE_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIGNATURE_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const localBuffer = Buffer.concat(localParts);
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIGNATURE_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

// --- the sample writers ---------------------------------------------------------------------------
// `expect` documents the verdict the live engine should return — the harness page shows it beside the
// observed verdict so a mismatch is obvious.

const samples = [];

// EICAR: the standard antivirus test string. clamd's baked signature database flags it ->
// infected (../src/clamav.rs + verdict::combine). This is the canonical "it caught malware" demo.
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
samples.push({
  name: "eicar.com",
  contentType: "application/octet-stream",
  expect: "infected (Eicar-Test-Signature)",
  data: Buffer.from(EICAR, "ascii"),
});

// A plain clean document: no signature, no active content, not an archive -> clean (../src/verdict.rs).
samples.push({
  name: "clean.txt",
  contentType: "text/plain",
  expect: "clean",
  data: Buffer.from("This is a clean test document. Nothing to see here.\n", "utf8"),
});

// A PDF carrying an /OpenAction that runs /JavaScript. lopdf finds the OpenAction key (or, if it
// cannot parse, the byte-scan fallback finds the marker) -> ActiveContent -> clean+activeContent
// (../src/heuristics/pdf.rs). Active content is a badge, never a quarantine — the safe-delivery
// sandbox is the execution defense.
const ACTIVE_PDF = [
  "%PDF-1.4",
  "1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >> endobj",
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj",
  "4 0 obj << /Type /Action /S /JavaScript /JS (app.alert\\('hello'\\);) >> endobj",
  "trailer << /Root 1 0 R >>",
  "%%EOF",
  "",
].join("\n");
samples.push({
  name: "active.pdf",
  contentType: "application/pdf",
  expect: "clean + activeContent (PDF JavaScript)",
  data: Buffer.from(ACTIVE_PDF, "ascii"),
});

// An OOXML-shaped zip containing a */vbaProject.bin part — the macro marker the archive walker keys on
// -> ActiveContent -> clean+activeContent (../src/heuristics/mod.rs scan_archive).
samples.push({
  name: "macro.docx",
  contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  expect: "clean + activeContent (Office macro)",
  data: makeZip([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>", "utf8"), method: 0 },
    { name: "word/vbaProject.bin", data: Buffer.from("fake macro payload", "utf8"), method: 0 },
  ]),
});

// A decompression bomb by declared/compressed ratio: 50 MiB of zeros deflate to a few KB, a ratio far
// over the 100x cap, caught by the cheap pre-filter WITHOUT decompressing (../src/heuristics/mod.rs).
samples.push({
  name: "bomb-ratio.zip",
  contentType: "application/zip",
  expect: "suspicious / decompression-bomb",
  data: makeZip([{ name: "zeros.bin", data: Buffer.alloc(50 * 1024 * 1024, 0), method: 8 }]),
});

// A nesting attack: ~20 archives deep, past the depth cap of 16. Detection is by content (each entry's
// leading bytes are peeked for an archive magic), so the nesting is found even though every wrapper is
// STORED with a benign name -> suspicious / archive-nesting.
let nested = makeZip([{ name: "core.txt", data: Buffer.from("deep", "utf8"), method: 0 }]);
for (let level = 1; level <= 20; level += 1) {
  nested = makeZip([{ name: `layer-${level}.zip`, data: nested, method: 0 }]);
}
samples.push({
  name: "nested-deep.zip",
  contentType: "application/zip",
  expect: "suspicious / archive-nesting",
  data: nested,
});

// An entry-count attack: more than the 10,000-entry cap -> suspicious / archive-entry-count.
const manyEntries = [];
for (let index = 0; index < 10_050; index += 1) {
  manyEntries.push({ name: `e${index}.txt`, data: Buffer.alloc(0), method: 0 });
}
samples.push({
  name: "many-entries.zip",
  contentType: "application/zip",
  expect: "suspicious / archive-entry-count",
  data: makeZip(manyEntries),
});

// An encrypted zip entry (encryption bit set). The walker cannot read an encrypted entry, so it flags
// and never decompresses -> unscanned / encrypted (../src/heuristics/mod.rs + verdict::combine).
samples.push({
  name: "encrypted.zip",
  contentType: "application/zip",
  expect: "unscanned / encrypted",
  data: makeZip([
    {
      name: "secret.bin",
      data: Buffer.from("ciphertext placeholder", "utf8"),
      method: 0,
      encrypted: true,
    },
  ]),
});

// --- write everything -----------------------------------------------------------------------------

mkdirSync(samplesDirectory, { recursive: true });

const manifest = [];
for (const sample of samples) {
  writeFileSync(join(samplesDirectory, sample.name), sample.data);
  manifest.push({
    name: sample.name,
    bytes: sample.data.length,
    contentType: sample.contentType,
    expect: sample.expect,
  });
  process.stdout.write(
    `  ${sample.name.padEnd(20)} ${String(sample.data.length).padStart(10)} bytes  -> ${sample.expect}\n`,
  );
}

// An optional multi-GB random file for the timing benchmark. Off by default — the proxy's /api/bench
// endpoint can stream arbitrary sizes without ever writing a file, which is the lighter path. This
// exists only if you want to drag a real large file into the browser.
const bigFlag = process.argv.indexOf("--big");
if (bigFlag !== -1) {
  const megabytes = Number.parseInt(process.argv[bigFlag + 1] ?? "1024", 10);
  if (!Number.isFinite(megabytes) || megabytes <= 0) {
    process.stderr.write("--big expects a positive size in MiB\n");
    process.exit(1);
  }
  const path = join(samplesDirectory, `big-${megabytes}.bin`);
  const chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
  randomFillSync(chunk);
  const { openSync, writeSync, closeSync } = await import("node:fs");
  const handle = openSync(path, "w");
  let written = 0;
  const target = megabytes * 1024 * 1024;
  while (written < target) {
    const slice = Math.min(chunk.length, target - written);
    writeSync(handle, chunk, 0, slice);
    written += slice;
  }
  closeSync(handle);
  manifest.push({
    name: `big-${megabytes}.bin`,
    bytes: target,
    contentType: "application/octet-stream",
    expect: "clean (timing)",
  });
  process.stdout.write(`  big-${megabytes}.bin written (${megabytes} MiB)\n`);
}

writeFileSync(join(samplesDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`\nWrote ${manifest.length} samples to ${samplesDirectory}\n`);
