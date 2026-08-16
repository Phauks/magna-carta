// Vite `?raw` imports resolve to the file's text at build time (Workers have no filesystem);
// TypeScript needs the module shape declared once for the Wrangler-config read in
// scan-shard.test.ts, which asserts the deployed container capacity against the shard count.
declare module "*.jsonc?raw" {
  const content: string;
  export default content;
}
