import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerAiDetectionRoutes } from "./ai-detection.ts";
import { registerBundleStatusRoute } from "./bundle-status.ts";
import { registerDecryptionRoutes } from "./decryption.ts";
import { registerDownloadRegisterRoutes } from "./downloads-register.ts";
import { registerDownloadsRoutes } from "./downloads.ts";
import { registerFileIntegrityRoutes } from "./file-integrity.ts";
import { registerFileRepairRoutes } from "./file-repair.ts";
import { registerFileScanRoutes } from "./file-scans.ts";
import { registerFileTypeRoutes } from "./file-type.ts";
import { registerFilesRoutes } from "./files.ts";
import { registerFoldersRoutes } from "./folders.ts";
import { registerMetadataRoutes } from "./metadata.ts";
import { registerOcrRoutes } from "./ocr.ts";
import { registerRecoveryRoutes } from "./recovery.ts";
import { registerScanDiagnoseRoute } from "./scan-diagnose.ts";
import { registerScanMatterRoute } from "./scan-matter.ts";
import { registerUploadReadinessRoute } from "./upload-readiness.ts";
import { registerUploadsRoutes } from "./uploads.ts";

// The File Manager's metadata, upload, download and scan surfaces, and the matter-less file tools that read bytes without filing them.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountFiles(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  registerDownloadRegisterRoutes(domain, chokepoint);
  registerDecryptionRoutes(domain, chokepoint);
  // Password recovery: mints a job and fans it out through the recovery coordinator Durable
  // Object. Registered beside decryption — the button-initiated surface for the SAME extracted
  // hash decryption.inspect returns inline, handed instead to an offline dictionary search.
  registerRecoveryRoutes(domain, chokepoint);
  registerFileIntegrityRoutes(domain, chokepoint);
  registerFileTypeRoutes(domain, chokepoint);
  registerFileRepairRoutes(domain, chokepoint);
  registerOcrRoutes(domain, chokepoint);
  registerAiDetectionRoutes(domain, chokepoint);
  registerMetadataRoutes(domain, chokepoint);
  registerUploadsRoutes(domain, chokepoint);
  // Slice 1·1: the File Manager's folder/file metadata surface, signed single-file download, and the
  // streaming ZIP64 bulk download — each composed through the same chokepoint.
  registerFoldersRoutes(domain, chokepoint);
  registerFilesRoutes(domain, chokepoint);
  registerDownloadsRoutes(domain, chokepoint);
  // The one-off, matter-less malware-scan diagnostic — stream a file through the engine, get a verdict.
  registerScanDiagnoseRoute(domain, chokepoint);
  // "Can this firm upload?" answered from the server: the bucket, its three settings, the key.
  registerUploadReadinessRoute(domain, chokepoint);
  // "Scan this matter now" — queue a background re-scan of a matter's stale files on the bulk lane.
  registerScanMatterRoute(domain, chokepoint);
  registerFileScanRoutes(domain, chokepoint);
  // The async bulk-download poll endpoint — the status side of the download route's 202 hand-off.
  registerBundleStatusRoute(domain, chokepoint);
  app.route("/", domain);
}
