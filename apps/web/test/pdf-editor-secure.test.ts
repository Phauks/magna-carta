import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decryptDocument,
  detectDocument,
  ensureReady,
  inspectSecurity,
  readForm,
  secureDocument,
  WrongPasswordError,
} from "@magna-carta/pdf";
import {
  DEFAULT_SECURE,
  countReadings,
  madePassword,
  protectedCopyName,
  secureOptions,
  secureProblems,
} from "../src/lib/pdf-editor/secure.ts";

describe("the readings", () => {
  it("counts findings by kind and keeps none of their text", () => {
    const readings = countReadings(
      { encrypted: false },
      [
        { category: "coveredText", recoveredText: "the secret" },
        { category: "whiteoutText", recoveredText: "another" },
        { category: "removableAnnotation", recoveredText: "" },
        { category: "metadataLeak", recoveredText: "Author" },
      ] as never,
      ["Jordan", "", null, false, true],
    );
    expect(readings).toEqual({
      encrypted: false,
      hiddenText: 2,
      comments: 1,
      metadata: 1,
      hiddenLayers: 0,
      filledFormFields: 2,
    });
    expect(JSON.stringify(readings)).not.toContain("secret");
  });
});

describe("checking the passwords", () => {
  it("accepts no passwords at all, since one is made", () => {
    expect(secureProblems(DEFAULT_SECURE)).toEqual({});
  });

  it("refuses a short password and a permissions password equal to the open one", () => {
    expect(Object.keys(secureProblems({ ...DEFAULT_SECURE, openPassword: "short" }))).toEqual([
      "openPassword",
    ]);
    const same = {
      ...DEFAULT_SECURE,
      openPassword: "correct horse",
      permissionsPassword: "correct horse",
    };
    expect(Object.keys(secureProblems(same))).toEqual(["permissionsPassword"]);
  });

  it("makes a long password from the random source", () => {
    const made = madePassword((bytes) => bytes.fill(7));
    expect(made).toHaveLength(24);
    expect(madePassword()).not.toBe(madePassword());
  });

  it("names the copy", () => {
    expect(protectedCopyName("Settlement.pdf")).toBe("Settlement (Protected).pdf");
  });
});

describe("protecting a real document with the engine", () => {
  it("encrypts with AES-256, the open password and the chosen permissions", async () => {
    await ensureReady(
      readFileSync(
        fileURLToPath(new URL("../../../packages/pdf/src/pkg/pdf_core_bg.wasm", import.meta.url)),
      ),
    );
    const form = new Uint8Array(
      readFileSync(
        fileURLToPath(
          new URL("../../../crates/pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf", import.meta.url),
        ),
      ),
    );
    const before = countReadings(
      await inspectSecurity(form),
      (await detectDocument(form)).findings,
      (await readForm(form)).map((field) => field.value),
    );
    expect(before.encrypted).toBe(false);

    const settings = { ...DEFAULT_SECURE, openPassword: "open sesame 1" };
    const { pdf } = await secureDocument(form, secureOptions(settings, "permissions password 2"));
    const security = await inspectSecurity(pdf);
    expect(security).toMatchObject({ encrypted: true, algorithm: "aes256", hasUserPassword: true });
    await expect(decryptDocument(pdf, "not it")).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await decryptDocument(pdf, "open sesame 1")).pdf.length).toBeGreaterThan(0);
  });
});
