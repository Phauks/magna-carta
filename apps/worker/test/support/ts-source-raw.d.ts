// Vite `?raw` imports resolve to the file's text at build time (Workers have no filesystem);
// TypeScript needs the module shape declared once for source-scanning fitness guard imports.
declare module "*.ts?raw" {
  const content: string;
  export default content;
}

// Virtual module provided by the billingPackageSources() Vite plugin in vitest.config.ts. Exposes
// packages/timekeeping/src, packages/costs/src, and packages/billing-core/src as a map from
// package-prefixed path → raw source text so the fitness scans can cover the package sources even
// though import.meta.glob cannot resolve paths outside the Vite root (apps/worker).
declare module "virtual:billing-package-sources" {
  const sources: Record<string, string>;
  export default sources;
}

// Virtual module provided by the pdfCoreFixtures() Vite plugin in vitest.config.ts. Exposes the PDF
// fixtures under crates/pdf-core/tests/fixtures as a map from file name → base64, so the extraction
// tests read the same bytes the engine's own tests assert on without a second committed copy.
declare module "virtual:pdf-core-fixtures" {
  const fixtures: Record<string, string>;
  export default fixtures;
}
