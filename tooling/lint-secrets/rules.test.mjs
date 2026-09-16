import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RULES,
  SELF_TEST,
  decodeIfBase64,
  isCredentialShapedValue,
  isEnvironmentFile,
  isPlaceholder,
  isRealLookingJsonWebToken,
  isSecretShapedName,
  scan,
  shannonEntropy,
} from "./rules.mjs";

/*
 * Every sample in this file is assembled from fragments at run time, exactly as the SELF_TEST table
 * is, so no credential-shaped literal appears in this source. That is what lets the gate walk its
 * own directory — asserted at the bottom of this file.
 */
const join = (...parts) => parts.join("");

describe("the self-test table", () => {
  it.each(SELF_TEST.map((sample) => [sample.label, sample]))("%s", (_label, sample) => {
    const found = scan(sample.file, sample.source);
    if (sample.rule === null) {
      expect(found.map((one) => one.rule)).toEqual([]);
    } else {
      expect(found.map((one) => one.rule)).toContain(sample.rule);
    }
  });

  it("covers every rule in the table with at least one positive sample", () => {
    const fired = new Set(
      SELF_TEST.filter((sample) => sample.rule !== null).map((sample) => sample.rule),
    );
    // The two Cloudflare shapes and the two Slack shapes share a rule function, so the count of
    // distinct rule names is at least the count of rule functions.
    expect(fired.size).toBeGreaterThanOrEqual(RULES.length - 1);
  });
});

describe("findings never carry the value", () => {
  it("reports a redacted fingerprint and a line, never the matched text", () => {
    const value = join("ghp_", "0Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx");
    const [found] = scan("tooling/release.mjs", `const t = "${value}";`);
    expect(found.evidence).not.toContain(value);
    expect(found.evidence).toContain("(40 characters)");
    expect(found.line).toBe(1);
  });

  it("reports the real line number in a multi-line file", () => {
    const value = join("AIza", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q");
    const source = `const a = 1;\n// nothing here\nconst b = "${value}";\n`;
    expect(scan("apps/web/src/lib/maps.ts", source)[0].line).toBe(3);
  });
});

describe("placeholders", () => {
  it("accepts a value that says what it is", () => {
    expect(isPlaceholder("magna-carta-local-development-placeholder-secret")).toBe(true);
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder("${AUTH_SECRET}")).toBe(true);
    expect(isPlaceholder("<your-token-here>")).toBe(true);
  });

  it("reads one base64 layer down, which is how the tracked root key placeholder passes", () => {
    const encoded = Buffer.from("magna-carta-local-dev-root-kek!!").toString("base64");
    expect(decodeIfBase64(encoded)).toBe("magna-carta-local-dev-root-kek!!");
    expect(isPlaceholder(encoded)).toBe(true);
  });

  it("does not read random key bytes as text", () => {
    const random = Buffer.from(Array.from({ length: 32 }, (_, index) => index * 7)).toString(
      "base64",
    );
    expect(decodeIfBase64(random)).toBeNull();
  });

  it("does not treat a high-entropy value as a placeholder", () => {
    expect(isPlaceholder(join("7Kq", "Zt2Vm9Xr4Bn1Wp6Ld3Hs8Yc5Fj0Ga"))).toBe(false);
  });
});

describe("entropy", () => {
  it("is zero for one repeated character and near the alphabet ceiling for a key", () => {
    expect(shannonEntropy("a".repeat(40))).toBe(0);
    expect(shannonEntropy(join("7Kq", "Zt2Vm9Xr4Bn1Wp6Ld3Hs8Yc5Fj0Ga"))).toBeGreaterThan(4.2);
  });
});

describe("the name test", () => {
  it("reads a named credential as one", () => {
    for (const name of [
      "AUTH_SECRET",
      "PLATFORM_ADMIN_KEY",
      "apiKey",
      "clientSecret",
      "password",
    ]) {
      expect(isSecretShapedName(name)).toBe(true);
    }
  });

  it("does not read a lookup or a bare container word as a credential", () => {
    for (const name of [
      "cacheKey",
      "idempotencyKey",
      "objectKey",
      "KEY",
      "token",
      "designTokens",
    ]) {
      expect(isSecretShapedName(name)).toBe(false);
    }
  });
});

describe("the value test", () => {
  it("requires length, mixed character classes and entropy together", () => {
    expect(isCredentialShapedValue(join("7Kq", "Zt2Vm9Xr4Bn1Wp6Ld3Hs8Yc5Fj0Ga"))).toBe(true);
    expect(isCredentialShapedValue("short")).toBe(false);
    expect(isCredentialShapedValue("a".repeat(40))).toBe(false);
    expect(isCredentialShapedValue("magna-carta-local-development-placeholder")).toBe(false);
    // A lowercase-only run of 40 characters is a slug, not key material.
    expect(isCredentialShapedValue("abcdefghijklmnopqrstuvwxyzabcdefghijklmn")).toBe(false);
  });

  it("accepts a full-length hex digest and rejects a formatted identifier", () => {
    expect(isCredentialShapedValue("9f2c4a1e0b7d83562fae19cc470db28e6153af90724ec8bd")).toBe(true);
    expect(isCredentialShapedValue("0".repeat(48))).toBe(false);
  });
});

describe("JSON Web Tokens", () => {
  const encode = (object) =>
    Buffer.from(JSON.stringify(object)).toString("base64url").replace(/=+$/, "");

  it("needs a real algorithm and two registered claims", () => {
    const real = [
      encode({ alg: "HS256", typ: "JWT" }),
      encode({ iss: "magna-carta-self-test", sub: "synthetic", exp: 4102444800 }),
      "c3ludGhldGljLXNpZ25hdHVyZQ",
    ].join(".");
    expect(isRealLookingJsonWebToken(real)).toBe(true);
  });

  it("ignores an unsigned token and a one-claim payload", () => {
    const unsigned = `${encode({ alg: "none" })}.${encode({ iss: "a", sub: "b" })}.`;
    const thin = `${encode({ alg: "HS256" })}.${encode({ hello: "world" })}.c2ln`;
    expect(isRealLookingJsonWebToken(unsigned)).toBe(false);
    expect(isRealLookingJsonWebToken(thin)).toBe(false);
  });

  it("ignores the documentation token everybody pastes", () => {
    const documentation = [
      encode({ alg: "HS256", typ: "JWT" }),
      encode({ sub: "1234567890", name: "John Doe", iat: 1516239022 }),
      "c2lnbmF0dXJl",
    ].join(".");
    expect(isRealLookingJsonWebToken(documentation)).toBe(false);
  });
});

describe("environment files", () => {
  it("recognizes the shapes it is allowed to read", () => {
    expect(isEnvironmentFile("apps/api-worker/.dev.vars")).toBe(true);
    expect(isEnvironmentFile("apps/web/.env.production")).toBe(true);
    expect(isEnvironmentFile("apps/api-worker/src/config.ts")).toBe(false);
  });

  it("reads nothing in a file that is not one, so a shell script is untouched", () => {
    const source = "AUTH_SECRET=Jq4vR9tLm2XbN7wKd1ZsY6hG3pC8aE5uT0i\n";
    expect(scan("tooling/deploy.sh", source).map((one) => one.rule)).not.toContain(
      "environment-file-value",
    );
    expect(scan("apps/api-worker/.dev.vars", source).map((one) => one.rule)).toContain(
      "environment-file-value",
    );
  });

  it("ignores comments and short values", () => {
    const source = "# AUTH_SECRET=whatever-a-comment-says\nPANGRAM_API_KEY=\nPORT=8787\n";
    expect(scan("apps/api-worker/.dev.vars", source)).toEqual([]);
  });
});

describe("the gate can walk its own source", () => {
  it("finds nothing in the rule table or in this test, so the scanner is not blind to itself", () => {
    for (const name of ["rules.mjs", "index.mjs", "rules.test.mjs"]) {
      const file = fileURLToPath(new URL(name, import.meta.url));
      const source = readFileSync(file, "utf8");
      expect(scan(`tooling/lint-secrets/${name}`, source)).toEqual([]);
    }
  });
});
