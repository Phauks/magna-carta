/*
 * AlertDialog is a composition of parts (the house namespace shape, same as Dialog/Tabs/Tooltip):
 * bare names (Root, Trigger, Portal, Overlay, Content, Title, Description, Cancel, Action) plus
 * AlertDialog-prefixed aliases, so both idioms work — `import * as AlertDialog from ".../alert-dialog"`
 * then <AlertDialog.Root>, or `import { AlertDialog, AlertDialogTrigger }`. Root is also re-exported
 * as `AlertDialog`.
 */
import Root from "./alert-dialog-root.svelte";
import Trigger from "./alert-dialog-trigger.svelte";
import Portal from "./alert-dialog-portal.svelte";
import Overlay from "./alert-dialog-overlay.svelte";
import Content from "./alert-dialog-content.svelte";
import Title from "./alert-dialog-title.svelte";
import Description from "./alert-dialog-description.svelte";
import Cancel from "./alert-dialog-cancel.svelte";
import Action from "./alert-dialog-action.svelte";

export {
  Root,
  Trigger,
  Portal,
  Overlay,
  Content,
  Title,
  Description,
  Cancel,
  Action,
  //
  Root as AlertDialog,
  Trigger as AlertDialogTrigger,
  Portal as AlertDialogPortal,
  Overlay as AlertDialogOverlay,
  Content as AlertDialogContent,
  Title as AlertDialogTitle,
  Description as AlertDialogDescription,
  Cancel as AlertDialogCancel,
  Action as AlertDialogAction,
};
