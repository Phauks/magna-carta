/*
 * Tooltip is a composition of parts (the house namespace shape): bare names (Root, Trigger,
 * Content, Provider) plus Tooltip-prefixed aliases, so both `import * as Tooltip` and
 * `import { Tooltip, TooltipTrigger }` work. Provider goes once near the app root.
 */
import Root from "./tooltip-root.svelte";
import Trigger from "./tooltip-trigger.svelte";
import Content from "./tooltip-content.svelte";
import Provider from "./tooltip-provider.svelte";

export {
  Root,
  Trigger,
  Content,
  Provider,
  //
  Root as Tooltip,
  Trigger as TooltipTrigger,
  Content as TooltipContent,
  Provider as TooltipProvider,
};
