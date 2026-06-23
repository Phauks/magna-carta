// The convert worker's runtime bindings. No bindings exist yet; Container bindings and
// Durable Object bindings are added in a later task once the engine Container is wired.
export type Bindings = {};

export default {
  fetch(_request: Request, _env: Bindings): Response {
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;
