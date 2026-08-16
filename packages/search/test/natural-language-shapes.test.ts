import { PLATFORM_EMBEDDING_MODEL_ID } from "@magna-carta/inference/catalog";
import type { FileId, FirmId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  NATURAL_LANGUAGE_SEARCH_DISCLOSURE_STATEMENTS,
  NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION,
  naturalLanguageSearchDisclosureText,
} from "../src/natural-language-disclosure.ts";
import {
  matterOfNaturalLanguageFeedObjectKey,
  naturalLanguageFeedDocument,
  naturalLanguageFeedObjectDimensions,
  naturalLanguageFeedObjectKey,
  naturalLanguageFeedPrefixForMatter,
  NATURAL_LANGUAGE_FEED_EMITTED_OBJECT_CLASSES,
  NATURAL_LANGUAGE_FEED_OBJECT_CLASS,
  NATURAL_LANGUAGE_FEED_PREFIX,
} from "../src/natural-language-feed.ts";
import {
  NATURAL_LANGUAGE_INSTANCE_CONFIGURATION,
  NATURAL_LANGUAGE_METADATA_FIELDS,
  naturalLanguageInstanceName,
} from "../src/natural-language-instance.ts";
import {
  naturalLanguageInstanceNotProvisioned,
  notProvisionedNaturalLanguageSearchPort,
} from "../src/natural-language-port.ts";
import { notConfiguredNaturalLanguageProvisioningPort } from "../src/natural-language-provisioning.ts";
import { naturalLanguageSearchEnabledDefinition } from "../src/natural-language-settings.ts";

const MATTER = "matter_0123456789abcdefghijkl" as MatterId;
const OTHER_MATTER = "matter_zyxwvutsrqponmlkjihgf" as MatterId;
const FILE = "file_0123456789abcdefghijkl" as FileId;
const FIRM = "firm_0123456789abcdefghijkl" as FirmId;
const OTHER_FIRM = "firm_zyxwvutsrqponmlkjihgf" as FirmId;

describe("the consent gate", () => {
  it("defaults closed", () => {
    // The whole feature hangs off this being false. A default of true would mean a firm's privileged
    // text is copied into a managed store because nobody said not to.
    expect(naturalLanguageSearchEnabledDefinition.defaultValue).toBe(false);
    expect(naturalLanguageSearchEnabledDefinition.key).toBe("search.naturalLanguageEnabled");
  });

  it("refuses a stored value that is not a boolean, so a bad write cannot open it", () => {
    expect(naturalLanguageSearchEnabledDefinition.schema.safeParse("true").success).toBe(false);
    expect(naturalLanguageSearchEnabledDefinition.schema.safeParse(1).success).toBe(false);
  });
});

describe("the disclosure", () => {
  it("carries a version, because an acknowledgement without one acknowledges an unknown thing", () => {
    expect(Number.isInteger(NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION)).toBe(true);
    expect(NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION).toBeGreaterThan(0);
  });

  it("declines to guarantee data residency", () => {
    // One of the two sentences that must survive every future edit of this statement. The
    // documentation this feature was built against states no jurisdictional residency control for
    // the managed store, so the statement offers none — and a firm with a residency obligation is
    // told, in the statement itself, not to enable the feature.
    const residency = NATURAL_LANGUAGE_SEARCH_DISCLOSURE_STATEMENTS.find((sentence) =>
      sentence.startsWith("Data residency:"),
    );
    expect(residency).toBeDefined();
    expect(residency).toContain("not one this platform can specify or verify");
    expect(residency).toContain("no guarantee is offered");
    expect(residency).toContain("should not enable this feature");
  });

  it("declines to claim provable deletion from the managed store", () => {
    // The second. The platform can demonstrate deletion of the text it wrote into storage it owns
    // and cannot demonstrate anything about the managed index, so the statement says exactly that.
    const deletion = NATURAL_LANGUAGE_SEARCH_DISCLOSURE_STATEMENTS.find((sentence) =>
      sentence.startsWith("Deletion:"),
    );
    expect(deletion).toBeDefined();
    expect(deletion).toContain("cannot demonstrate");
    expect(deletion).toContain("provable erasure");
    expect(deletion).toContain("should not enable this feature");
  });

  it("says no third-party model provider is involved and nothing is generated", () => {
    const text = naturalLanguageSearchDisclosureText();
    expect(text).toContain("No third-party model provider is involved");
    expect(text).toContain("never composed prose");
  });

  it("is frozen, so nothing can edit a firm's statement at runtime", () => {
    expect(Object.isFrozen(NATURAL_LANGUAGE_SEARCH_DISCLOSURE_STATEMENTS)).toBe(true);
  });
});

describe("the feed object key", () => {
  it("is the pinned layout every fed object in every firm's bucket already uses", () => {
    // A compatibility contract, not a preference. Changing these bytes orphans every object already
    // written, so the exact string is asserted rather than reconstructed from the function.
    expect(naturalLanguageFeedObjectKey(MATTER, FILE, 3)).toBe(
      "ai-search/matter_0123456789abcdefghijkl/file_0123456789abcdefghijkl/3.md",
    );
    expect(NATURAL_LANGUAGE_FEED_PREFIX).toBe("ai-search/");
    expect(naturalLanguageFeedPrefixForMatter(MATTER)).toBe(
      "ai-search/matter_0123456789abcdefghijkl/",
    );
  });

  it("round-trips the matter a hit's pointer resolves to", () => {
    expect(
      matterOfNaturalLanguageFeedObjectKey(naturalLanguageFeedObjectKey(MATTER, FILE, 1)),
    ).toBe(MATTER);
  });

  it("resolves a key it cannot parse to undefined rather than guessing", () => {
    // A hit whose pointer does not parse is DROPPED. Guessing a matter from a malformed key is how a
    // re-authorization check comes to be run against the wrong matter and pass.
    expect(matterOfNaturalLanguageFeedObjectKey("files/file_x/1")).toBeUndefined();
    expect(
      matterOfNaturalLanguageFeedObjectKey("ai-search/not-a-matter/file_x/1.md"),
    ).toBeUndefined();
    expect(matterOfNaturalLanguageFeedObjectKey("ai-search/matter_x/file_x/1.pdf")).toBeUndefined();
    expect(matterOfNaturalLanguageFeedObjectKey("")).toBeUndefined();
  });

  it("gives two matters two prefixes, which is what makes a matter-scope deletion bounded", () => {
    expect(naturalLanguageFeedPrefixForMatter(MATTER)).not.toBe(
      naturalLanguageFeedPrefixForMatter(OTHER_MATTER),
    );
  });
});

describe("what a fed object carries", () => {
  it("stamps the matter and the one object class, through the platform's own dimension builder", () => {
    expect(naturalLanguageFeedObjectDimensions(MATTER)).toEqual({
      matter: MATTER,
      object_class: "working-document",
    });
  });

  it("stamps no reserved dimension", () => {
    // `client` and `confidentiality_scope` are declared on the managed index's metadata schema
    // because declaring a field later re-indexes every firm — and are written by nothing, here or
    // anywhere else in the platform, because a dimension absent on every object is worse than no
    // dimension: a filter on it matches nothing while looking like it works.
    const stamped = Object.keys(naturalLanguageFeedObjectDimensions(MATTER));
    expect(stamped).not.toContain("client");
    expect(stamped).not.toContain("confidentiality_scope");
  });

  it("concatenates the extraction it was given, with page markers, and invents no page", () => {
    const document = naturalLanguageFeedDocument([
      { chunkId: "a", text: "first passage", page: 1 },
      { chunkId: "b", text: "second passage", page: 1 },
      { chunkId: "c", text: "third passage", page: 2 },
      { chunkId: "d", text: "a passage that knew no page" },
    ]);
    expect(document).toBe(
      "## Page 1\n\nfirst passage\n\nsecond passage\n\n## Page 2\n\nthird passage\n\na passage that knew no page\n",
    );
  });

  it("produces nothing for an empty extraction", () => {
    expect(naturalLanguageFeedDocument([]).trim()).toBe("");
  });
});

describe("the instance name", () => {
  it("is derived, so a repeated create converges on the same instance", async () => {
    // The idempotency story of provisioning: a step that died halfway recomputes the same name and
    // finishes, rather than minting a second instance nobody has a handle to.
    expect(await naturalLanguageInstanceName(FIRM)).toBe(await naturalLanguageInstanceName(FIRM));
  });

  it("gives two firms two names", async () => {
    expect(await naturalLanguageInstanceName(FIRM)).not.toBe(
      await naturalLanguageInstanceName(OTHER_FIRM),
    );
  });

  it("is opaque — it carries no firm identifier and no human-readable text", async () => {
    // Instance names appear in account-level surfaces that are not partitioned per firm, so anybody
    // reading one must learn nothing but that an instance exists.
    const name = await naturalLanguageInstanceName(FIRM);
    expect(name).not.toContain(FIRM);
    expect(name).not.toContain(FIRM.slice("firm_".length));
    expect(name).toMatch(/^mc-[0-9a-f]{32}$/);
  });
});

describe("the instance configuration", () => {
  it("pins the embedding model to the platform's own pin rather than a literal", () => {
    // The service fixes the embedding model at creation and it cannot be changed afterwards without
    // re-embedding the corpus, so this and the platform's pin have to agree exactly. Reading the pin
    // rather than restating it removes the second place they could disagree — and keeps this module
    // from naming a model provider, which belongs to the one inference chokepoint.
    expect(NATURAL_LANGUAGE_INSTANCE_CONFIGURATION.embeddingModelId).toBe(
      PLATFORM_EMBEDDING_MODEL_ID,
    );
  });

  it("configures no generation model, no public endpoint, no cache, and no query rewriting", () => {
    expect(NATURAL_LANGUAGE_INSTANCE_CONFIGURATION.responseGeneration).toBeNull();
    expect(NATURAL_LANGUAGE_INSTANCE_CONFIGURATION.publicEndpoints).toBe(false);
    expect(NATURAL_LANGUAGE_INSTANCE_CONFIGURATION.similarityCache).toBe(false);
    expect(NATURAL_LANGUAGE_INSTANCE_CONFIGURATION.queryRewriting).toBe(false);
  });

  it("declares four metadata fields and leaves the fifth slot unallocated", () => {
    // Changing an instance's metadata schema re-indexes every document in it, for every firm, so the
    // field list is closed at creation. The spare slot is recorded as a cost rather than discovered.
    expect([...NATURAL_LANGUAGE_METADATA_FIELDS]).toEqual([
      "matter",
      "client",
      "object_class",
      "confidentiality_scope",
    ]);
    expect(NATURAL_LANGUAGE_METADATA_FIELDS.length).toBe(4);
  });

  it("is frozen, so no call site can assemble a firm a different instance", () => {
    expect(Object.isFrozen(NATURAL_LANGUAGE_INSTANCE_CONFIGURATION)).toBe(true);
    expect(Object.isFrozen(NATURAL_LANGUAGE_METADATA_FIELDS)).toBe(true);
  });
});

describe("the not-configured ports", () => {
  it("report instance-not-provisioned rather than an empty success", async () => {
    // An adapter that resolved cleanly with no results would be indistinguishable from a corpus in
    // which nothing matched — the failure where a lawyer finds nothing and concludes there is
    // nothing. The unavailable answer has to be a different answer.
    const result = await notProvisionedNaturalLanguageSearchPort.naturalLanguageSearch({
      firmId: FIRM,
      corpus: { kind: "matter", id: MATTER },
      text: "where did we agree to a contingency on appeal",
      limit: 10,
      objectClasses: [NATURAL_LANGUAGE_FEED_OBJECT_CLASS],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("instance-not-provisioned");
  });

  it("never throw at construction or at call", async () => {
    await expect(
      notConfiguredNaturalLanguageProvisioningPort.createInstance({
        instanceName: "mc-0",
        bucketName: "bucket",
        keyPrefix: NATURAL_LANGUAGE_FEED_PREFIX,
        configuration: NATURAL_LANGUAGE_INSTANCE_CONFIGURATION,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "binding-not-configured",
      detail: "no managed search management binding in this deployment",
    });
    await expect(
      notConfiguredNaturalLanguageProvisioningPort.destroyInstance("mc-0"),
    ).resolves.toMatchObject({ ok: false, reason: "binding-not-configured" });
    await expect(
      notConfiguredNaturalLanguageProvisioningPort.keepAlive("mc-0"),
    ).resolves.toMatchObject({ ok: false, reason: "binding-not-configured" });
    await expect(
      notConfiguredNaturalLanguageProvisioningPort.syncStatus("mc-0"),
    ).resolves.toMatchObject({ ok: false, reason: "binding-not-configured" });
  });

  it("keeps the detail out of the reason, so the outcome vocabulary stays closed", () => {
    expect(naturalLanguageInstanceNotProvisioned("anything at all").reason).toBe(
      "instance-not-provisioned",
    );
  });
});

describe("the writer's object-class vocabulary", () => {
  it("has exactly one member", () => {
    expect([...NATURAL_LANGUAGE_FEED_EMITTED_OBJECT_CLASSES]).toEqual(["working-document"]);
  });
});
