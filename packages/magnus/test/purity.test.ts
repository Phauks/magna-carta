import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as audit from "../src/audit.ts";

// This package stays pure: it holds no database binding, no HTTP framework, no `env`, and no Workers
// runtime type. It composes statements and returns typed results for the caller to commit. Everything
// runtime-shaped — the queue, the socket, the composition root — lives in the worker.

const importPattern = /\b(?:import|from)\b\s*["']([^"']+)["']/g;

const allowedPackages = new Set([
  "@magna-carta/data-access/audit-statements",
  "@magna-carta/data-access/cursor-pagination",
  "@magna-carta/data-access/effect-batch",
  "@magna-carta/data-access/idempotency-statements",
  "@magna-carta/data-access/like-search",
  "@magna-carta/data-access/setting-statements",
  "@magna-carta/identifiers/field",
  "@magna-carta/identifiers/generate",
  "@magna-carta/identifiers/random",
  "@magna-carta/identifiers/types",
  "zod",
]);

// Anything that would drag a runtime into a package whose whole point is not having one.
const forbiddenSubstrings = [
  "@cloudflare/workers-types",
  "cloudflare:",
  "hono",
  "@hono/",
  "drizzle",
  "node:",
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function importSpecifiers(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const specifiers: string[] = [];
  for (const match of text.matchAll(importPattern)) specifiers.push(match[1]!);
  return specifiers;
}

const srcDir = join(import.meta.dirname, "..", "src");
const packageJsonPath = join(import.meta.dirname, "..", "package.json");

describe("purity (fitness)", () => {
  it("actually inspects the source files", () => {
    expect(tsFiles(srcDir).length).toBeGreaterThanOrEqual(8);
  });

  it("every import is relative or an allowed workspace package", () => {
    for (const file of tsFiles(srcDir)) {
      for (const specifier of importSpecifiers(file)) {
        const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
        expect(
          isRelative || allowedPackages.has(specifier),
          `${file.replaceAll("\\", "/")} imports disallowed specifier: "${specifier}"`,
        ).toBe(true);
      }
    }
  });

  it("declares no dependency on a Workers runtime, an HTTP framework, or a database driver", () => {
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    for (const name of declared) {
      for (const forbidden of forbiddenSubstrings) {
        if (forbidden === "node:") continue; // @types/node is a legitimate test-time dependency
        expect(
          name.includes(forbidden),
          `package.json declares a runtime dependency: "${name}"`,
        ).toBe(false);
      }
    }
  });

  it("never names a model, a provider, or a gateway — the model is the firm's setting, read per call", () => {
    for (const file of tsFiles(srcDir)) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const forbidden of ["env.ai", "gatewayoptions", "aibinding", "anthropic/", "openai"]) {
        expect(text.includes(forbidden), `${file} names "${forbidden}"`).toBe(false);
      }
    }
  });
});

describe("audit builders cannot receive turn content (fitness)", () => {
  // Structural, not textual: every exported audit builder takes exactly three parameters — the
  // database, the write context, and a typed identifier-only input. There is no variadic tail a
  // caller could smuggle a fourth argument through, and each input type is declared inline in
  // audit.ts with no `content` member. The compile-time check is the type; this is the runtime
  // tripwire that a builder did not quietly grow a shape.
  const builders = Object.entries(audit).filter(
    ([name, value]) => typeof value === "function" && name.endsWith("Audit"),
  );

  it("finds every builder", () => {
    expect(builders.length).toBe(20);
  });

  it("each takes exactly (database, context, identifierOnlyInput)", () => {
    for (const [name, value] of builders) {
      expect((value as (...args: unknown[]) => unknown).length, `${name} arity`).toBe(3);
    }
  });

  it("no builder's input type declares a content field", () => {
    const text = readFileSync(join(srcDir, "audit.ts"), "utf8");
    // Every `readonly <name>:` inside this module is an audit metadata field. None of them may be
    // the turn text, under any of its names, or a label a member typed (a title, a folder's name).
    for (const match of text.matchAll(/readonly\s+([A-Za-z]+)\s*:/g)) {
      const field = (match[1] ?? "").toLowerCase();
      expect([
        "content",
        "text",
        "prompt",
        "completion",
        "message",
        "body",
        "title",
        "name",
      ]).not.toContain(field);
    }
  });
});
