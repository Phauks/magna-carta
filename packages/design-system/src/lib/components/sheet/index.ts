/*
 * Sheet is a Dialog that slides in from a screen edge (a drawer), composed of parts (the house
 * namespace shape, same as Dialog/Tabs/Tooltip): bare names (Root, Trigger, Portal, Overlay,
 * Content, Title, Description, Close) plus Sheet-prefixed aliases, so both idioms work —
 * `import * as Sheet from ".../sheet"` then <Sheet.Root>, or `import { Sheet, SheetTrigger }`.
 * Root is also re-exported as `Sheet`. Every part wraps the corresponding Bits UI Dialog primitive.
 */
import Root from "./sheet-root.svelte";
import Trigger from "./sheet-trigger.svelte";
import Portal from "./sheet-portal.svelte";
import Overlay from "./sheet-overlay.svelte";
import Content from "./sheet-content.svelte";
import Title from "./sheet-title.svelte";
import Description from "./sheet-description.svelte";
import Close from "./sheet-close.svelte";

export {
  Root,
  Trigger,
  Portal,
  Overlay,
  Content,
  Title,
  Description,
  Close,
  //
  Root as Sheet,
  Trigger as SheetTrigger,
  Portal as SheetPortal,
  Overlay as SheetOverlay,
  Content as SheetContent,
  Title as SheetTitle,
  Description as SheetDescription,
  Close as SheetClose,
};
