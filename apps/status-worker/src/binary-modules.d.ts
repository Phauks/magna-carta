// Wrangler bundles matched binary files as data modules (the "rules" entry in wrangler.jsonc);
// each import resolves to the file's raw bytes.
declare module "*.woff2" {
  const data: ArrayBuffer;
  export default data;
}
