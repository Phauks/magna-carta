import { createApp, type Bindings } from "./app.ts";

// The worker's entry point. One Hono application, built once per isolate: the rate limiter's
// counters live in that application, so rebuilding it per request would reset them.
let cached: ReturnType<typeof createApp> | null = null;

function application(env: Bindings) {
  cached ??= createApp(env);
  return cached.app;
}

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    return application(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Bindings>;
