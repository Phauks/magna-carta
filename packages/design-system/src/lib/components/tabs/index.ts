/*
 * Tabs is a composition of parts (the house namespace shape, same as Card): bare names
 * (Root, List, Trigger, Content) plus Tabs-prefixed aliases, so both idioms work —
 * `import * as Tabs from ".../tabs"` then <Tabs.Root>, or `import { Tabs, TabsTrigger }`.
 */
import Root from "./tabs.svelte";
import List from "./tabs-list.svelte";
import Trigger from "./tabs-trigger.svelte";
import Content from "./tabs-content.svelte";

export {
  Root,
  List,
  Trigger,
  Content,
  //
  Root as Tabs,
  List as TabsList,
  Trigger as TabsTrigger,
  Content as TabsContent,
};
