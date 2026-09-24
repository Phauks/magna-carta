import { afterEach, describe, expect, it } from "vitest";
import { TOKEN_SIZE } from "@magna-carta/identifiers/token";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import { describeErrorId, newErrorId } from "../src/ids.ts";
import { setServiceIdentity } from "../src/service-identity.ts";
import { scrubText } from "../src/scrub.ts";

afterEach(() => {
  setServiceIdentity("unk");
});

describe("newErrorId", () => {
  it("still satisfies the handle shape every other consumer pins", () => {
    // The validators, the OpenAPI `pattern`, and the scrubber's exemption all read the same body
    // fragment. Packing fields INTO the budget rather than appending them is what keeps this true.
    const pattern = identifierPattern("error");
    for (let attempt = 0; attempt < 200; attempt++) {
      const id = newErrorId();
      expect(pattern.test(id), id).toBe(true);
      expect(id.slice("error_".length)).toHaveLength(TOKEN_SIZE);
    }
  });

  it("survives the scrubber intact", () => {
    // An Error ID the scrubber rewrites to [scrubbed] is an Error ID the pipeline destroys on the
    // way out — the exact failure the whole-handle exemption exists to prevent.
    for (let attempt = 0; attempt < 200; attempt++) {
      const id = newErrorId();
      const scrubbed = scrubText(id);
      expect(scrubbed.text, id).toBe(id);
      expect(scrubbed.tripped, id).toBe(false);
    }
  });

  it("carries the minute it was minted", () => {
    const at = Date.UTC(2026, 8, 18, 18, 59, 58, 539);
    const facts = describeErrorId(newErrorId(at));
    expect(facts?.mintedAt.toISOString()).toBe(new Date(at).toISOString());
  });

  it("carries the Worker that minted it", () => {
    setServiceIdentity("api");
    expect(describeErrorId(newErrorId())?.service).toBe("api");
    setServiceIdentity("edt");
    expect(describeErrorId(newErrorId())?.service).toBe("edt");
  });

  it("mints unk when no Worker announced itself, rather than guessing", () => {
    expect(describeErrorId(newErrorId())?.service).toBe("unk");
  });

  it("keeps the timestamp field a fixed width across the range it will ever see", () => {
    // A shorter or longer field would shift every field after it, so the answer would be wrong
    // rather than malformed. This is the test that found the 2059 cliff in an 8-character field.
    for (const at of [
      0,
      Date.UTC(2004, 0, 1),
      Date.now(),
      Date.UTC(2059, 0, 1),
      Date.UTC(5100, 0, 1),
    ]) {
      const body = newErrorId(at).slice("error_".length);
      expect(body, String(at)).toHaveLength(TOKEN_SIZE);
      expect(describeErrorId(`error_${body}`)?.mintedAt.getTime()).toBe(at);
    }
  });

  it("does not repeat itself", () => {
    const minted = new Set<string>();
    for (let attempt = 0; attempt < 5_000; attempt++) minted.add(newErrorId());
    expect(minted.size).toBe(5_000);
  });
});

describe("describeErrorId", () => {
  it("declines an id that does not carry the fields rather than inventing a date", () => {
    // A handle minted before the fields existed has a random body; reading its first characters as
    // a timestamp would send support to a confidently wrong window.
    expect(describeErrorId("error_LtKJPIQH1K0eF_M_NgG9d")).toBeNull();
    expect(describeErrorId("correlation_Yg_oFsafm11BtzybTzd3h")).toBeNull();
    expect(describeErrorId("error_tooshort")).toBeNull();
    expect(describeErrorId("not a handle at all")).toBeNull();
  });
});
