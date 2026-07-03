import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptDocument,
  ensureReady,
  inspectSecurity,
  loadDocument,
  secureDocument,
  WrongPasswordError,
  type SecureOptions,
} from "../src/index.js";

// A real, lopdf-loadable plaintext PDF (the same fixture the forms tests use).
const plain = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL("../../../crates/pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf", import.meta.url),
    ),
  ),
);

const baseOpts: SecureOptions = { ownerPassword: "owner", userPassword: "open" };

describe("pdf security", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("inspectSecurity reports an unencrypted document as clean", async () => {
    const info = await inspectSecurity(plain);
    expect(info.encrypted).toBe(false);
    expect(info.handler).toBe("none");
    expect(info.algorithm).toBe("none");
  });

  it("secureDocument writes AES-256 and round-trips through decryptDocument", async () => {
    const { pdf } = await secureDocument(plain, baseOpts);

    const info = await inspectSecurity(pdf);
    expect(info.encrypted).toBe(true);
    expect(info.algorithm).toBe("aes256");
    expect(info.hasUserPassword).toBe(true);

    const { pdf: plainAgain } = await decryptDocument(pdf, "open");
    const doc = await loadDocument(plainAgain);
    expect(doc.pageCount).toBeGreaterThan(0);
    doc.free();
  });

  it("decryptDocument throws WrongPasswordError without leaking the password", async () => {
    const { pdf } = await secureDocument(plain, baseOpts);
    const attempt = "s3cr3t-wrong";
    await expect(decryptDocument(pdf, attempt)).rejects.toBeInstanceOf(WrongPasswordError);
    try {
      await decryptDocument(pdf, attempt);
      throw new Error("expected a WrongPasswordError");
    } catch (error) {
      // The attempted password must not surface anywhere on the thrown error — not the
      // message, the string form, the stack, or any own/serialised property.
      const e = error as Error;
      const serialised = [e.message, String(e), e.stack ?? "", JSON.stringify(e)].join("\n");
      expect(serialised).not.toContain(attempt);
    }
  });

  it("secureDocument carries the permission policy", async () => {
    const { pdf } = await secureDocument(plain, { ...baseOpts, permissions: { copy: false } });
    const info = await inspectSecurity(pdf);
    expect(info.permissions).not.toBeNull();
    expect(info.permissions?.copy).toBe(false);
    expect(info.permissions?.print).toBe(true);
  });

  it("secureDocument with no user password opens without a prompt", async () => {
    const { pdf } = await secureDocument(plain, { ownerPassword: "owner" });
    const info = await inspectSecurity(pdf);
    expect(info.encrypted).toBe(true);
    expect(info.hasUserPassword).toBe(false);
    // Opening with the empty password yields actually-decrypted bytes that load — not the
    // still-encrypted input handed back.
    const { pdf: plainAgain } = await decryptDocument(pdf, "");
    expect((await inspectSecurity(plainAgain)).encrypted).toBe(false);
    const doc = await loadDocument(plainAgain);
    expect(doc.pageCount).toBeGreaterThan(0);
    doc.free();
  });
});
