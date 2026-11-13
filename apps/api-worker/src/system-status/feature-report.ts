/*
 * The features half of GET /api/v1/meta/versions: the two wire shapes, and the one call the route
 * makes to fill them. Kept here rather than in the route module so the route stays a route.
 *
 * `features` goes to every member. `featureRequirements` goes only to a platform operator: it names
 * which settings each feature still needs, which nobody else can act on, and its presence is how
 * the System Status page knows to offer the operator's views. Names and true/false, never a value.
 */
import { z } from "@hono/zod-openapi";
import { decidePlatformOperatorAccess } from "@magna-carta/access-control/platform-operator";
import {
  selectActivePlatformOperatorStatement,
  type PlatformOperatorAccessRow,
} from "@magna-carta/data-access/platform-operator-statements";
import type { Bindings } from "../bindings.ts";
import type { ConnectedServiceStatusReport } from "../meetings/sfu/realtime-status.ts";
import {
  FEATURE_IDS,
  featureRequirements,
  featureStatuses,
  type FeatureRequirementsReport,
  type FeatureStatusReport,
} from "./feature-roster.ts";

export const FeatureStatus = z
  .object({ id: z.enum(FEATURE_IDS), state: z.enum(["working", "not-set-up", "fault"]) })
  .openapi("FeatureStatus");

export const FeatureRequirements = z
  .object({
    id: z.enum(FEATURE_IDS),
    // Alternatives: the feature is set up when every name in at least one of them is present.
    alternatives: z.array(z.array(z.object({ name: z.string(), present: z.boolean() }))),
  })
  .openapi("FeatureRequirements");

/*
 * Whether the account is an active platform operator with two-factor on — the decision
 * platformOperatorGuard makes, asked without refusing, because the versions read answers everyone
 * and only decides how much to say. A control-plane read that fails says "no": the operator loses
 * the setup detail for one read, and nobody else gains it.
 */
async function isPlatformOperator(database: D1Database, userId: string): Promise<boolean> {
  try {
    const statement = selectActivePlatformOperatorStatement(
      database,
      userId as Parameters<typeof selectActivePlatformOperatorStatement>[1],
      new Date().toISOString(),
    );
    const row = (await statement.all<PlatformOperatorAccessRow>()).results[0];
    return decidePlatformOperatorAccess(row).allow;
  } catch {
    return false;
  }
}

export async function reportFeatures(
  env: Bindings,
  input: {
    readonly userId: string;
    readonly services: readonly {
      id: string;
      state: "reported" | "unbound" | "unreachable" | "unreported";
    }[];
    readonly connectedServices: readonly ConnectedServiceStatusReport[];
  },
): Promise<{
  features: FeatureStatusReport[];
  featureRequirements: FeatureRequirementsReport[] | null;
}> {
  const features = featureStatuses(env, {
    workers: new Map(input.services.map((service) => [service.id, service.state])),
    connectedServices: new Map(
      input.connectedServices.map((service) => [service.id, service.state]),
    ),
  });
  const operator = await isPlatformOperator(env.DB_CONTROL, input.userId);
  return { features, featureRequirements: operator ? featureRequirements(env) : null };
}
