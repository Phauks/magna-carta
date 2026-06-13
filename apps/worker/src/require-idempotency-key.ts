import type { MiddlewareHandler } from "hono";
import { problemJson } from "./contracts/problem.ts";

// `x-mc-idempotency: required` realized at the HTTP boundary: no Idempotency-Key → a 400 problem
// before the idempotency pre-decision runs. The data-access middleware behind it would also 400,
// but with its generic JSON shape — the worker's surface answers RFC 9457 problems, so the
// requirement is enforced here and the middleware only ever sees keyed requests. Runs AFTER the
// route's authorization middleware (session permissions or the platform-admin guard): even the
// key requirement is not discoverable pre-auth. Shared by every required-idempotency route
// (members.invite, firms.provision).
export const requireIdempotencyKey: MiddlewareHandler = async (c, next) => {
  const key = c.req.header("Idempotency-Key");
  if (key === undefined || key === "") {
    return problemJson(c, {
      type: "idempotency-key-missing",
      title: "Idempotency-Key required",
      status: 400,
      detail: "This operation requires an Idempotency-Key header.",
    });
  }
  await next();
};
