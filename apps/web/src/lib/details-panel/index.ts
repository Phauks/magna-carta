/*
 * DetailsPanel is a composition of parts (the house namespace shape — see the design system's
 * card/index.ts). Compose:
 *   DetailsPanel.Root > DetailsPanel.Header (Title, Subtitle + actions, ending in Close)
 *                     + DetailsPanel.Body (Section, Facts > Fact)
 *
 * DetailsPanel.Toggle is the surface's own control for showing it, and lives in the surface's
 * chrome rather than inside the panel — the panel never opens itself.
 *
 * The shell carries the frame and the grammar; every word in it belongs to the surface.
 */
import Root from "./details-panel.svelte";
import Body from "./details-panel-body.svelte";
import Close from "./details-panel-close.svelte";
import Fact from "./details-panel-fact.svelte";
import Facts from "./details-panel-facts.svelte";
import Header from "./details-panel-header.svelte";
import Section from "./details-panel-section.svelte";
import Subtitle from "./details-panel-subtitle.svelte";
import Title from "./details-panel-title.svelte";
import Toggle from "./details-panel-toggle.svelte";

export {
  Root,
  Body,
  Close,
  Fact,
  Facts,
  Header,
  Section,
  Subtitle,
  Title,
  Toggle,
  //
  Root as DetailsPanel,
  Body as DetailsPanelBody,
  Close as DetailsPanelClose,
  Fact as DetailsPanelFact,
  Facts as DetailsPanelFacts,
  Header as DetailsPanelHeader,
  Section as DetailsPanelSection,
  Subtitle as DetailsPanelSubtitle,
  Title as DetailsPanelTitle,
  Toggle as DetailsPanelToggle,
};
