// The bundler serves a media file imported from a story as an address; this tells TypeScript so.
declare module "*.webm" {
  const address: string;
  export default address;
}
