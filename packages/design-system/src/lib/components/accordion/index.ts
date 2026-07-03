/*
 * Accordion is a composition of parts (the house namespace shape): bare names (Root, Item, Trigger,
 * Content) plus Accordion-prefixed aliases, so both `import * as Accordion` and `import { Accordion,
 * AccordionTrigger }` work. (Trigger bundles Bits' Header + Trigger.)
 */
import Root from "./accordion.svelte";
import Item from "./accordion-item.svelte";
import Trigger from "./accordion-trigger.svelte";
import Content from "./accordion-content.svelte";

export {
  Root,
  Item,
  Trigger,
  Content,
  //
  Root as Accordion,
  Item as AccordionItem,
  Trigger as AccordionTrigger,
  Content as AccordionContent,
};
