// Vite `?raw` imports resolve to the file's text at build time (Workers have no filesystem);
// TypeScript needs the module shape declared once for the committed-snapshot drift guard import.
declare module "*openapi.json?raw" {
  const content: string;
  export default content;
}
