/*
 * Toast — transient notifications (Tier 3, wraps svelte-sonner). Two pieces:
 *   • Toaster — the host. Mount it ONCE near the app root (like Tooltip.Provider). It owns the
 *     portal, stacking, and our token bridge; without it on the page, toast() calls go nowhere.
 *   • toast   — the imperative trigger, re-exported from svelte-sonner. Call it from anywhere:
 *     toast("Saved"), toast.success(…), toast.error(…), toast.info(…), toast.warning(…),
 *     toast.message(…), toast.loading(…), toast.promise(…), with options { description, action,
 *     duration, … }. The success/error/info/warning intents resolve to our status.* tokens via the
 *     host, matching Alert.
 *
 * The dual export (bare names + Toast-prefixed aliases) follows the house namespace shape (see
 * tooltip/index.ts), supporting both `import * as Toast` and `{ Toaster, toast }` idioms.
 */
import Toaster from "./toaster.svelte";
import { toast } from "svelte-sonner";

export {
  Toaster,
  toast,
  //
  Toaster as Toast,
};
export type { ExternalToast, ToasterProps, ToastOptions, ToastT } from "svelte-sonner";
