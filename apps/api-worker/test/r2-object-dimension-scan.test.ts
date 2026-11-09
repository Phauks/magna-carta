// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import {
  FIRM_SCOPED_OBJECT_CLASSES,
  MATTER_SCOPED_OBJECT_CLASSES,
  RESERVED_DIMENSIONS,
  RESERVED_OBJECT_CLASSES,
} from "@magna-carta/object-dimensions/dimensions";
import { describe, expect, it } from "vitest";

// Fitness function (the append-only-source-scan pattern, twin of file-version-status-scan.ts): every
// object written into a firm's bucket carries the dimensions that say which matter it belongs to and
// what class of object it is. The scope is not in the key — `files/{fileId}/{versionId}` is opaque by
// design — so an object written without the stamp is an object nothing can scope, and the only repair
// is a rewrite of its metadata. The point of this scan is that a NEW write path fails here on the day
// it is written rather than being discovered later by a reader that finds nothing.
//
// What it enforces, at each `put` and each `createMultipartUpload` and each `presignPut` in the worker
// source: the call passes object dimensions, either as `customMetadata` (the Workers binding) or as the
// signed dimension headers (the S3 path). A write that legitimately carries none — development staging
// state, a self-test fixture — is allowlisted by an inline `fitness:allow-no-dimensions` marker with
// its reason immediately above it, exactly as a status-spanning read is allowlisted in the twin scan.
//
// The worker's tests run inside the workerd pool, whose node:fs cannot read the host source tree, so
// the sources are pulled in as raw text at build time. import.meta.glob is a Vite build-time macro: it
// inlines the matched files and MUST be referenced by its full literal name, so it cannot be aliased.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const SOURCES = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Each call site: the source file, the call's position, and the text of its argument list up to a
// bounded lookahead — enough to see the options object a `put` passes without parsing TypeScript.
interface WriteCall {
  readonly file: string;
  readonly index: number;
  readonly text: string;
}

const WRITE_CALL_PATTERN = /\.(put|createMultipartUpload|presignPut)\(/g;
const CALL_LOOKAHEAD = 400;
const MARKER_LOOKBEHIND = 400;

function writeCalls(file: string, source: string): WriteCall[] {
  const calls: WriteCall[] = [];
  let match: RegExpExecArray | null;
  WRITE_CALL_PATTERN.lastIndex = 0;
  while ((match = WRITE_CALL_PATTERN.exec(source)) !== null) {
    calls.push({
      file,
      index: match.index,
      text: source.slice(match.index, match.index + CALL_LOOKAHEAD),
    });
  }
  return calls;
}

// Three other things in this codebase are spelled `.put(` and none of them writes an object into a
// bucket. Each is excluded by what it is, never by where it lives, so the scan stays fail-closed: a
// receiver this list does not recognize is treated as a bucket and must stamp.
//
//   a Durable Object's own transactional storage — `ctx.storage.put("state", …)`, coordinator state;
//   a key-value namespace — `env.STATUS_KV.put(…)`, the status snapshot;
//   an HTTP route registration — `app.put("/api/…", handler)`, whose first argument is a path.
function isNotABucketWrite(call: WriteCall, source: string): boolean {
  const receiver = source.slice(Math.max(0, call.index - 40), call.index).trimEnd();
  if (/(^|[.\s(])[\w$]*(storage|KV)$/i.test(receiver)) return true;
  return /^\.put\(\s*["'`]\//.test(call.text);
}

function carriesDimensions(call: WriteCall): boolean {
  return /customMetadata|dimensions|Dimensions/.test(call.text);
}

function isAllowlisted(call: WriteCall, source: string): boolean {
  return source
    .slice(Math.max(0, call.index - MARKER_LOOKBEHIND), call.index)
    .includes("fitness:allow-no-dimensions");
}

describe("every object written into a firm's bucket carries its dimensions", () => {
  it("no bucket write in the worker source omits the stamp", () => {
    // Non-vacuity floor: the glob actually saw the worker source, and it actually saw write calls (a
    // regression that swept either to empty would otherwise pass silently).
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0);

    const offenders: string[] = [];
    let inspected = 0;
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const call of writeCalls(file, source)) {
        if (isNotABucketWrite(call, source)) continue;
        inspected++;
        if (carriesDimensions(call)) continue;
        if (isAllowlisted(call, source)) continue;
        offenders.push(`${file}: ${call.text.slice(0, 90).replace(/\s+/g, " ")}…`);
      }
    }
    expect(inspected).toBeGreaterThan(10);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no write path emits a reserved class or a reserved dimension name", () => {
    // The reservations are the whole reason a closed vocabulary is worth having: a filter that excludes
    // work product can be written and can run before the first such object exists, which is only true
    // while nothing writes one by accident.
    const reserved = [...RESERVED_OBJECT_CLASSES, ...RESERVED_DIMENSIONS];
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      // Two places a reserved name could reach an object: inside a write call's own arguments, or as
      // a metadata header on the S3 path. A reserved word appearing anywhere else in the source is a
      // different word — `client` is an ordinary noun in a rate card — and is not this scan's business.
      for (const token of reserved) {
        if (source.includes(`x-amz-meta-${token}`)) offenders.push(`${file}: header "${token}"`);
        for (const call of writeCalls(file, source)) {
          if (call.text.includes(`"${token}"`)) offenders.push(`${file}: writes "${token}"`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  // The scan's own proof. A fitness function that cannot fail is decoration, and the way this one
  // would silently stop working is an exclusion rule that grows until it swallows real writes — so the
  // rules are exercised here against sources written to trip them.
  it("detects an unstamped bucket write, and still ignores what is not one", () => {
    const unstamped = `await bucket.put(key, bytes);`;
    const stamped = `await bucket.put(key, bytes, { customMetadata: dimensions });`;
    const durableObjectState = `await this.ctx.storage.put("state", state);`;
    const keyValue = `await env.STATUS_KV.put(STATUS_KV_KEYS.derived, body);`;
    const routeRegistration = `app.put("/api/v1/things/{id}", handler);`;
    const allowlisted = `// fitness:allow-no-dimensions — staging state\nawait bucket.put(key, bytes);`;

    const flagged = (source: string): boolean =>
      writeCalls("probe.ts", source).some(
        (call) =>
          !isNotABucketWrite(call, source) &&
          !carriesDimensions(call) &&
          !isAllowlisted(call, source),
      );

    expect(flagged(unstamped)).toBe(true);
    expect(flagged(stamped)).toBe(false);
    expect(flagged(durableObjectState)).toBe(false);
    expect(flagged(keyValue)).toBe(false);
    expect(flagged(routeRegistration)).toBe(false);
    expect(flagged(allowlisted)).toBe(false);
  });

  it("keeps the writable vocabulary and the reserved vocabulary disjoint", () => {
    const writable = new Set<string>([
      ...MATTER_SCOPED_OBJECT_CLASSES,
      ...FIRM_SCOPED_OBJECT_CLASSES,
    ]);
    for (const reserved of RESERVED_OBJECT_CLASSES) {
      expect(writable.has(reserved)).toBe(false);
    }
  });
});
