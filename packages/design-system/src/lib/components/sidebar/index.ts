/*
 * Sidebar — the global navigation rail (page-archetypes Layout A): a fixed-width <nav> that
 * collapses to an icon rail with hover/focus tooltips. Hand-built on our Tooltip (rail labels) over
 * Bits' child-snippet trigger; the collapsed state is shared through context (see context.ts).
 *
 * House namespace shape — bare names (Root, Header, Content, …) plus Sidebar-prefixed aliases — so
 * both `import * as Sidebar` then <Sidebar.Root> and `import { Sidebar, SidebarMenuButton }` work.
 * This is the structural chrome only; the data-driven, role-filtered destination registry and the
 * top bar are wired in the feature slices that own them (apps/web-worker/src/lib/navigation/destinations.ts).
 */
import Root from "./sidebar.svelte";
import Header from "./sidebar-header.svelte";
import Content from "./sidebar-content.svelte";
import Footer from "./sidebar-footer.svelte";
import Group from "./sidebar-group.svelte";
import GroupLabel from "./sidebar-group-label.svelte";
import Menu from "./sidebar-menu.svelte";
import MenuItem from "./sidebar-menu-item.svelte";
import MenuButton from "./sidebar-menu-button.svelte";
import Trigger from "./sidebar-trigger.svelte";

export {
  Root,
  Header,
  Content,
  Footer,
  Group,
  GroupLabel,
  Menu,
  MenuItem,
  MenuButton,
  Trigger,
  //
  Root as Sidebar,
  Header as SidebarHeader,
  Content as SidebarContent,
  Footer as SidebarFooter,
  Group as SidebarGroup,
  GroupLabel as SidebarGroupLabel,
  Menu as SidebarMenu,
  MenuItem as SidebarMenuItem,
  MenuButton as SidebarMenuButton,
  Trigger as SidebarTrigger,
};
