/*
 * Dialog is a composition of parts (the house namespace shape, same as Tabs/Tooltip): bare names
 * (Root, Trigger, Portal, Overlay, Content, Title, Description, Close) plus Dialog-prefixed aliases,
 * so both idioms work — `import * as Dialog from ".../dialog"` then <Dialog.Root>, or
 * `import { Dialog, DialogTrigger }`. Root is also re-exported as `Dialog`.
 */
import Root from "./dialog-root.svelte";
import Trigger from "./dialog-trigger.svelte";
import Portal from "./dialog-portal.svelte";
import Overlay from "./dialog-overlay.svelte";
import Content from "./dialog-content.svelte";
import Title from "./dialog-title.svelte";
import Description from "./dialog-description.svelte";
import Close from "./dialog-close.svelte";

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
  Root as Dialog,
  Trigger as DialogTrigger,
  Portal as DialogPortal,
  Overlay as DialogOverlay,
  Content as DialogContent,
  Title as DialogTitle,
  Description as DialogDescription,
  Close as DialogClose,
};
