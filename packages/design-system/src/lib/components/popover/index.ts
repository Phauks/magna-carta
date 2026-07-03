/*
 * Popover is a composition of parts (the house namespace shape, same as Dialog/Tooltip): bare names
 * (Root, Trigger, Content, Close) plus Popover-prefixed aliases, so both idioms work —
 * `import * as Popover from ".../popover"` then <Popover.Root>, or
 * `import { Popover, PopoverTrigger }`. Root is also re-exported as `Popover`. (Bits UI's Popover
 * has no Anchor part — Content positions against the Trigger.)
 */
import Root from "./popover-root.svelte";
import Trigger from "./popover-trigger.svelte";
import Content from "./popover-content.svelte";
import Close from "./popover-close.svelte";

export {
  Root,
  Trigger,
  Content,
  Close,
  //
  Root as Popover,
  Trigger as PopoverTrigger,
  Content as PopoverContent,
  Close as PopoverClose,
};
