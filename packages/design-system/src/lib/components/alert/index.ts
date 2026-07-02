/*
 * Alert is a composition of parts; the dual export (bare names + Alert-prefixed aliases) follows
 * the house namespace shape (see card/index.ts), supporting both `import * as Alert` and
 * `{ Alert, AlertTitle }` idioms.
 */
import Root from "./alert.svelte";
import Description from "./alert-description.svelte";
import Title from "./alert-title.svelte";

export {
  Root,
  Description,
  Title,
  //
  Root as Alert,
  Description as AlertDescription,
  Title as AlertTitle,
};
export { alertClasses, alertRole, type AlertVariant } from "./variants.ts";
