// Vite `?raw` imports resolve to the file's text at build time (Workers have no filesystem);
// TypeScript needs the module shape declared once for the .dev.vars placeholder-guard import.
declare module "*.dev.vars?raw" {
  const content: string;
  export default content;
}
