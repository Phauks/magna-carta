// Vite `?raw` imports resolve to the file's text at build time (Workers have no filesystem);
// TypeScript needs the module shape declared once for the Wrangler-config read in
// status-worker.test.ts, which asserts the deployed cron cadence against the staleness threshold
// the page renders from.
declare module "*.jsonc?raw" {
  const content: string;
  export default content;
}
