import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";

// Outbound R2 handler for the bundle Container. When the container makes an HTTP request to
// http://bundle-r2/<key>, the runtime intercepts it (because "bundle-r2" is listed in
// BundleContainer.outboundByHost) and routes the call here. The container reads source files
// and writes assembled archives via these HTTP calls — no credentials, no real egress needed.
//
// GET → stream the stored object body (404 if absent).
// PUT → store the request body at the key (200 always).
// Other methods → 405.
export async function handleBundleR2(request: Request, r2: R2Bucket): Promise<Response> {
  const key = new URL(request.url).pathname.slice(1); // strip leading /
  if (request.method === "GET") {
    const object = await r2.get(key);
    if (!object) return new Response("Not Found", { status: 404 });
    return new Response(object.body, { status: 200 });
  }
  if (request.method === "PUT") {
    // Everything the container writes here is a piece of an assembled archive, whose selection may
    // span matters — so it is a firm-level object and says so, rather than arriving unclassified.
    await r2.put(key, request.body, {
      customMetadata: firmScopedObjectDimensions("download-bundle"),
    });
    return new Response(null, { status: 200 });
  }
  return new Response("Method Not Allowed", { status: 405 });
}
