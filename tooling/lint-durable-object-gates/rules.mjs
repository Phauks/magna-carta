// The rule behind `pnpm run lint:durable-object-gates`, as pure functions over file text.

/** An await that is NOT one of these opens the Durable Object's input gate. */
const STORAGE_AWAIT =
  /^(?:this\.ctx\.storage|this\.state\.storage|this\.ready|this\.load|this\.save|this\.touch)/;

/** Methods that are not request-handling state transitions, so the rule does not bind them. */
const EXEMPT_METHODS = new Set([
  "fetch",
  "webSocketMessage",
  "webSocketClose",
  "webSocketError",
  "alarm",
]);

/** `durable-object-gate:allow — <reason>`; a bare marker is itself a failure. */
const EXEMPTION = /durable-object-gate:allow\s*(?:—|--)?\s*(.*)/;

export function exemptionReason(text) {
  const match = EXEMPTION.exec(text);
  if (match === null) return null;
  return (match[1] ?? "").trim();
}

/** Each Durable Object class in a source file, with its async methods' bodies. */
export function readDurableObjectMethods(source) {
  if (!/extends DurableObject/.test(source)) return [];
  const className = /export class (\w+)/.exec(source)?.[1] ?? "unknown";
  const methods = [];
  for (const match of source.matchAll(/\n {2}(?:override )?async (\w+)\(([\s\S]*?)\n {2}\}/g)) {
    const [, name, body] = match;
    methods.push({
      className,
      name,
      body,
      line: source.slice(0, match.index).split("\n").length + 1,
      exempt:
        exemptionReason(source.slice(0, match.index).split("\n").slice(-4).join("\n")) !== null,
    });
  }
  return methods;
}

/**
 * A method that decides from stored state and then writes it must not await anything else in between.
 *
 * WHY THIS IS THE WHOLE RULE. workerd holds the input gate closed while a storage operation is
 * outstanding, which is what makes an ordinary read-then-write in a Durable Object atomic without
 * anybody asking for it: a second call is not delivered until the first has written. Await anything
 * that is NOT storage in that window — an R2 HEAD, a queue send, a service binding, a fetch — and the
 * gate opens. Two callers then both read the old state, both decide, and both write.
 *
 * It reads like ordinary code and the atomicity it loses was never written down, which is why this is
 * a scan rather than a review note. `ctx.blockConcurrencyWhile` is the remedy: it delivers nothing
 * else while it runs, so read-decide-write is one act again.
 */
export function findUngatedDecisions(methods) {
  const problems = [];
  for (const method of methods) {
    if (EXEMPT_METHODS.has(method.name) || method.exempt) continue;
    if (/blockConcurrencyWhile/.test(method.body)) continue;
    const write = /await this\.(?:ctx|state)\.storage\.(?:put|delete|deleteAll)/.exec(method.body);
    if (write === null) continue;
    const before = method.body.slice(0, write.index);
    // A read of stored state is what makes the write a DECISION rather than a blind overwrite.
    if (!/await this\.(?:ctx|state)\.storage\.(?:get|list)|await this\.load\(/.test(before))
      continue;
    const foreign = [...before.matchAll(/await ([\w.]+)/g)]
      .map((one) => one[1])
      .filter((one) => !STORAGE_AWAIT.test(one));
    if (foreign.length === 0) continue;
    problems.push({
      rule: "ungated-durable-object-decision",
      className: method.className,
      method: method.name,
      line: method.line,
      foreign: [...new Set(foreign)],
    });
  }
  return problems;
}
