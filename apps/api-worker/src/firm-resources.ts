import type { FirmId } from "@magna-carta/identifiers/types";

/*
 * WHAT A FIRM OWNS — the one declaration of it, and the reason there has to be one.
 *
 * A firm's record is not in one place. It is spread across four kinds of thing that are created at
 * different moments, by different code, and destroyed by different means:
 *
 *   - rows in the control-plane D1,
 *   - a SQLite Durable Object, addressed by the firm's id and by nothing else,
 *   - an R2 bucket, named on the firm's row,
 *   - possibly a managed natural-language search instance, an account resource whose only record is
 *     also a control-plane row.
 *
 * NOTHING ELSE KNOWS THE WHOLE SET. There is no Cloudflare API that lists Durable Object instances,
 * no API that maps a bucket back to the firm that owns it, and ai_search_instance is deliberately the
 * sole index of the instances (control-plane-schema.ts: "Nothing ever calls the service's list
 * operation to learn which firms have instances"). So the set cannot be discovered — it can only be
 * declared, and a resource missing from the declaration is invisible to everything that walks it.
 *
 * That is not hypothetical. Writing the platform reset by hand missed the search instances entirely:
 * they would have been left running, unnameable, against an account ceiling of 5,000. The manifest
 * below exists so the next reader of "what does a firm have" gets an answer rather than an
 * archaeology exercise, and so the three things that need the answer — offboarding, a data-subject
 * export, the pre-launch reset — read the same list instead of three drifting copies of it.
 *
 * ORDER IS PART OF THE DECLARATION, not a detail of any one caller. `destroyOrder` is ascending, and
 * the control plane is last on purpose: it is the only index of everything above it, so emptying it
 * first strands every account resource with nothing able to name it. A caller that walks this list in
 * declaration order is correct by construction.
 *
 * A FIFTH RESOURCE. Add its entry here in the same change that creates it, and give it a destroy
 * position before the control plane if it outlives its row. The tests beside this file pin the
 * PROPERTIES that make a walk safe — the control plane last, every orphanable resource strictly
 * before it, positions unique — but nothing yet fails a resource that provisioning creates and this
 * manifest never hears about. That scan is the thing worth adding next, on the model of the
 * PII/erasure registry's attribution fitness function, because a set maintained by memory is a set
 * that is eventually wrong: this one was, until the search instances were noticed.
 */

/** How a resource is reached, which decides what "destroy" and "export" can even mean for it. */
export type ResourceLocator =
  /** A row set in the control-plane database, found by the firm's id. */
  | { readonly kind: "control-plane-rows" }
  /** A Durable Object, addressed by `idFromName(firmId)` and reachable no other way. */
  | { readonly kind: "durable-object"; readonly binding: "FIRM_DATABASE" }
  /** A bucket in the account, named on the firm's row. */
  | { readonly kind: "r2-bucket"; readonly nameColumn: "bucket_name" }
  /** An account resource in a managed service, named on a control-plane row. */
  | { readonly kind: "managed-service"; readonly nameColumn: "instance_name" };

export interface FirmResourceDeclaration {
  /** A stable identifier for the resource kind, used in reports and in the fitness test. */
  readonly id:
    | "firm-database"
    | "firm-bucket"
    | "natural-language-search-instance"
    | "control-plane-rows";
  readonly locator: ResourceLocator;
  /** What a reader should understand this holds. */
  readonly holds: string;
  /**
   * Whether the resource still exists once its control-plane row is gone. The ones that do are the
   * ones that can be orphaned, and the reason the control plane is destroyed last.
   */
  readonly outlivesTheControlPlane: boolean;
  /**
   * Whether every firm has one. A resource that is conditional needs its presence READ rather than
   * assumed, or a walk over the fleet reports failures for firms that simply never had it.
   */
  readonly always: boolean;
  /** Ascending. The control plane is last because it is the index of everything above it. */
  readonly destroyOrder: number;
  /** What destroying it takes, in the terms of the code that can actually do it. */
  readonly destroyedBy: string;
}

export const FIRM_RESOURCES: readonly FirmResourceDeclaration[] = [
  {
    id: "natural-language-search-instance",
    locator: { kind: "managed-service", nameColumn: "instance_name" },
    holds: "The firm's managed natural-language search index, and whatever text was fed to it.",
    outlivesTheControlPlane: true,
    // Opt-in, and `absent` is a recorded state rather than a missing row — a firm that opted out and
    // was torn down is a different fact from one that never opted in.
    always: false,
    destroyOrder: 1,
    destroyedBy:
      "tearDownNaturalLanguageInstance (search/natural-language-lifecycle.ts) — inside the Worker, " +
      "over the firm's own database; it records the service's response rather than concluding from it",
  },
  {
    id: "firm-bucket",
    locator: { kind: "r2-bucket", nameColumn: "bucket_name" },
    holds:
      "Every byte the firm holds: file versions, bundles, conversions, templates, staged mail.",
    outlivesTheControlPlane: true,
    // Written at provisioning; null on a firm whose bucket step never completed.
    always: false,
    destroyOrder: 2,
    destroyedBy:
      "empty by S3 listing, then DELETE the bucket — R2 refuses to delete a non-empty one",
  },
  {
    id: "firm-database",
    locator: { kind: "durable-object", binding: "FIRM_DATABASE" },
    holds: "The firm's whole structured record — matters, time, billing, trust, the file catalog.",
    // It survives, and worse than the others: nothing can address it once the id that named it is
    // gone, and no API will list it.
    outlivesTheControlPlane: true,
    always: true,
    destroyOrder: 3,
    destroyedBy:
      "ctx.storage.deleteAll() from inside the object — there is no external API. Crypto-shredding " +
      "the firm key first makes the protected corpus unreadable whether or not the storage goes",
  },
  {
    id: "control-plane-rows",
    locator: { kind: "control-plane-rows" },
    holds:
      "The firm row, its members, their sessions and the auth audit — and the index of all of the above.",
    outlivesTheControlPlane: false,
    always: true,
    // Last. Everything above is findable only from here.
    destroyOrder: 4,
    destroyedBy: "DELETE over the control-plane tables, read from sqlite_master rather than listed",
  },
];

/** The manifest in the order a destroy must walk it. */
export function firmResourcesInDestroyOrder(): readonly FirmResourceDeclaration[] {
  return [...FIRM_RESOURCES].sort((left, right) => left.destroyOrder - right.destroyOrder);
}

/**
 * The resources that survive their control-plane row — the ones that can be orphaned, and therefore
 * the ones a destroy has to deal with BEFORE it touches the index that names them.
 */
export function orphanableFirmResources(): readonly FirmResourceDeclaration[] {
  return FIRM_RESOURCES.filter((resource) => resource.outlivesTheControlPlane);
}

/** One firm's resources as they actually stand, for a report a person reads before acting. */
export interface FirmResourceInventory {
  readonly firmId: FirmId;
  readonly present: readonly {
    readonly id: FirmResourceDeclaration["id"];
    /** The name or address the resource answers to, where it has one. */
    readonly address: string | null;
    /** Absent means the firm never had one, not that it could not be read. */
    readonly present: boolean;
  }[];
}

/** What the control plane must supply for an inventory — the only place these facts exist together. */
export interface FirmControlPlaneFacts {
  readonly firmId: FirmId;
  readonly bucketName: string | null;
  readonly searchInstanceName: string | null;
  readonly searchInstanceState: string | null;
}

/**
 * A firm's inventory, built from its control-plane row alone. It reads nothing from the account,
 * deliberately: the point of the manifest is that the control plane IS the authority, and a report
 * that asked the services instead would make an outage look like a firm with nothing to destroy.
 */
export function inventoryFirmResources(facts: FirmControlPlaneFacts): FirmResourceInventory {
  const liveSearchStates = new Set(["provisioning", "ready", "tearing-down"]);
  return {
    firmId: facts.firmId,
    present: firmResourcesInDestroyOrder().map((resource) => {
      switch (resource.id) {
        case "natural-language-search-instance":
          return {
            id: resource.id,
            address: facts.searchInstanceName,
            present:
              facts.searchInstanceName !== null &&
              liveSearchStates.has(facts.searchInstanceState ?? ""),
          };
        case "firm-bucket":
          return { id: resource.id, address: facts.bucketName, present: facts.bucketName !== null };
        case "firm-database":
          // Addressed by the firm's id, which is the only handle it has ever had.
          return { id: resource.id, address: facts.firmId, present: true };
        case "control-plane-rows":
          return { id: resource.id, address: facts.firmId, present: true };
      }
    }),
  };
}
