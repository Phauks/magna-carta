/*
 * Finding the list endpoints in an emitted OpenAPI document — the detector, on its own so it can be
 * imported and tested without running the gate (index.mjs exits the process, which a test cannot).
 */

/** Resolve a response schema through one `$ref` hop into the components map. */
function resolve(schema, components) {
  const ref = schema?.$ref;
  if (typeof ref !== "string") return schema;
  return components[ref.slice(ref.lastIndexOf("/") + 1)] ?? schema;
}

/**
 * Every GET whose 200 answers with `{ data: [...] }`, and whether it carries a cursor beside it.
 * Read from the EMITTED contract rather than the source, because the emitted contract is what a
 * caller actually gets.
 */
export function listOperations(document) {
  const components = document.components?.schemas ?? {};
  const found = [];
  for (const [route, operations] of Object.entries(document.paths ?? {})) {
    const get = operations.get;
    if (get === undefined) continue;
    const schema = get.responses?.["200"]?.content?.["application/json"]?.schema;
    if (schema === undefined) continue;
    const properties = resolve(schema, components).properties ?? {};
    if (properties.data?.type !== "array") continue;
    found.push({
      operationId: get.operationId ?? route,
      route,
      paged: "nextCursor" in properties,
    });
  }
  return found;
}
