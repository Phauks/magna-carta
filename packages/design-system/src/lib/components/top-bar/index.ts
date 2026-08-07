import Root from "./top-bar.svelte";
import Search from "./top-bar-search.svelte";
import Actions from "./top-bar-actions.svelte";
import IconButton from "./top-bar-icon-button.svelte";
import Link from "./top-bar-link.svelte";

export {
  Root,
  Search,
  Actions,
  IconButton,
  Link,
  // Prefixed aliases (the house namespace shape) so both import styles work.
  Root as TopBar,
  Search as TopBarSearch,
  Actions as TopBarActions,
  IconButton as TopBarIconButton,
  Link as TopBarLink,
};
