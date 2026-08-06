import { MATTER_ASSET_CLASSES, type MatterAssetClass } from "./types.ts";

// The class registry: what each platform class is called, whether it carries a table of structured
// attributes, and the standing handling notice a class's surfaces render. One entry per class, and
// the registry is the one place a reader can see the whole spine at once.

export interface MatterAssetClassDeclaration {
  readonly key: MatterAssetClass;
  readonly label: string;
  // The per-class attribute table, or null where the class has no structure. `personalProperty` and
  // `other` are the pressure valve and carry no table at all: a description, a value history,
  // documents, and the firm's own fields are the whole of them. Nothing is ever blocked; what an
  // unforeseen thing loses is structured search, which is honest.
  readonly attributeTable: string | null;
  // A short, standing, NON-JURISDICTIONAL sentence shown on the class's surfaces where a class
  // carries known type-specific legal handling. Empty for every class that does not. Nothing
  // branches on it — it is rendered and never read by any rule.
  readonly handlingNote: string | null;
  // Whether the write path can create an asset of this class. Every class is available now that each
  // one's attribute table exists; the field stays because a class declared ahead of its table is a
  // shape this registry has already had to express once and would have to express again for an
  // eleventh class.
  readonly available: boolean;
}

// Firearms are the one class in this register that carries a handling notice, and the notice is
// deliberately the narrowest thing that can be said. The register records a firearm the way it
// records a car — make, model, calibre or gauge, serial number, a value history, documents, an
// interest — which is a records capability and carries no more legal weight than writing the same
// facts on a legal pad. It encodes NO transfer law and will not guess at any: it does not determine
// who may receive a firearm, does not decide whether a transfer needs a licensed dealer, does not
// classify an item under any regulatory schedule, does not check a prohibited-person status, and
// does not compute a deadline. Federal and state law vary on every one of those points, they vary by
// the recipient as well as the item, and a rule that is ninety percent right is worse than no rule
// because it will be trusted. The notice names no rule, cites no statute, and states no deadline, so
// it cannot become wrong when the law changes — it exists so nobody reads a tidy row and infers the
// platform has checked something. A verified jurisdiction-keyed catalog, if one is ever wanted, is a
// separate build behind primary-source research, one jurisdiction at a time.
const FIREARM_HANDLING_NOTE =
  "Transfers of firearms are regulated by federal and state law. This register records what is " +
  "held; it does not determine who may receive it.";

export const MATTER_ASSET_CLASS_REGISTRY: readonly MatterAssetClassDeclaration[] = [
  {
    key: "realProperty",
    label: "Real property",
    attributeTable: "matter_asset_real_property",
    handlingNote: null,
    available: true,
  },
  {
    key: "financialAccount",
    label: "Financial account",
    attributeTable: "matter_asset_financial_account",
    handlingNote: null,
    available: true,
  },
  {
    key: "vehicle",
    label: "Vehicle",
    attributeTable: "matter_asset_vehicle",
    handlingNote: null,
    available: true,
  },
  {
    key: "firearm",
    label: "Firearm",
    attributeTable: "matter_asset_firearm",
    handlingNote: FIREARM_HANDLING_NOTE,
    available: true,
  },
  {
    key: "businessInterest",
    label: "Business interest",
    attributeTable: "matter_asset_business_interest",
    handlingNote: null,
    available: true,
  },
  {
    key: "insurancePolicy",
    label: "Insurance policy",
    attributeTable: "matter_asset_insurance_policy",
    handlingNote: null,
    available: true,
  },
  {
    key: "receivable",
    label: "Money owed to the estate",
    attributeTable: "matter_asset_receivable",
    handlingNote: null,
    available: true,
  },
  {
    key: "digitalAsset",
    label: "Digital asset",
    attributeTable: "matter_asset_digital_asset",
    handlingNote: null,
    available: true,
  },
  {
    key: "personalProperty",
    label: "Personal property",
    attributeTable: null,
    handlingNote: null,
    available: true,
  },
  { key: "other", label: "Other", attributeTable: null, handlingNote: null, available: true },
];

const byKey = new Map<MatterAssetClass, MatterAssetClassDeclaration>(
  MATTER_ASSET_CLASS_REGISTRY.map((declaration) => [declaration.key, declaration]),
);

export function matterAssetClassDeclaration(
  key: MatterAssetClass,
): MatterAssetClassDeclaration | undefined {
  return byKey.get(key);
}

export function isMatterAssetClass(value: string): value is MatterAssetClass {
  const classes: readonly string[] = MATTER_ASSET_CLASSES;
  return classes.includes(value);
}
