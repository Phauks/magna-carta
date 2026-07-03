// A firm's data-residency region — where its per-firm storage (R2 bucket + firm-database Durable
// Object) physically lives. `us` (the primary market and column default) is North-America placement,
// a soft location hint; `eu` pins storage to Cloudflare's EU jurisdiction, a hard guarantee. There is
// no general US jurisdiction primitive on Cloudflare (only FedRAMP, a government-only tier), which is
// adequate because no cross-border transfer restriction binds US-resident data. Region is set once at
// provisioning and never changes: a jurisdiction-bound Durable Object id differs from the bare id.
export type DataRegion = "us" | "eu";

// The Cloudflare jurisdiction for a region, or undefined for unconstrained (US) placement. Shared by
// the R2 bucket creator and the firm-database Durable Object addressor so both agree.
export function jurisdictionForRegion(region: DataRegion): "eu" | undefined {
  return region === "eu" ? "eu" : undefined;
}

// The R2 location hint for an unconstrained region (US → North-America). `eu` returns undefined
// because its hard jurisdiction already fixes placement.
export function locationHintForRegion(region: DataRegion): "enam" | undefined {
  return region === "us" ? "enam" : undefined;
}
