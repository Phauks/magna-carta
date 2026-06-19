// Vite `?raw` imports resolve to the file's text at build time (Workers have no filesystem);
// TypeScript needs the module shape declared once for source-scanning fitness guard imports.
declare module "*.ts?raw" {
  const content: string;
  export default content;
}
