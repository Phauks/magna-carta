// Vite `?raw` imports resolve to the file's text at build time (Workers have no filesystem);
// TypeScript needs the module shape declared once for the wrangler-configuration scan's import.
declare module "*.jsonc?raw" {
  const content: string;
  export default content;
}
