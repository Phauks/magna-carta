import { jurisdictionForRegion, type DataRegion } from "@magna-carta/database/data-region";

// The one home for R2's S3-compatible endpoint host. Both the presigner (which signs URLs a browser
// uses directly) and the S3-backed bucket adapter (which the Worker reads and writes through) build
// their URLs here, so a signed URL and a server-side read can never address different hosts.
//
// The host is jurisdiction-dependent. A bucket created under a Cloudflare jurisdiction — `eu` today,
// per data-region.ts — exists ONLY at that jurisdiction's endpoint; addressing it at the account's
// default host resolves to nothing. Provisioning already passes jurisdictionForRegion(region) to
// createBucket, so the region a firm was provisioned in is the region its bytes must be addressed in.
export function r2S3Endpoint(accountId: string, region: DataRegion): string {
  const jurisdiction = jurisdictionForRegion(region);
  return jurisdiction === undefined
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : `https://${accountId}.${jurisdiction}.r2.cloudflarestorage.com`;
}
