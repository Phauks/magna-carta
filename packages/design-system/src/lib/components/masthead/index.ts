/*
 * Masthead is a composition of parts (the house namespace shape — see card/index.ts): the page's
 * ceremonial edge, and the only door to the display serif. Compose:
 *   Masthead.Root > Masthead.Heading (Eyebrow, Title, Meta) + Masthead.Actions
 */
import Root from "./masthead.svelte";
import Actions from "./masthead-actions.svelte";
import Eyebrow from "./masthead-eyebrow.svelte";
import Heading from "./masthead-heading.svelte";
import Meta from "./masthead-meta.svelte";
import MetaSeparator from "./masthead-meta-separator.svelte";
import Title from "./masthead-title.svelte";

export { mastheadDensityClass, type MastheadDensity } from "./variants.ts";

export {
  Root,
  Actions,
  Eyebrow,
  Heading,
  Meta,
  MetaSeparator,
  Title,
  //
  Root as Masthead,
  Actions as MastheadActions,
  Eyebrow as MastheadEyebrow,
  Heading as MastheadHeading,
  Meta as MastheadMeta,
  MetaSeparator as MastheadMetaSeparator,
  Title as MastheadTitle,
};
