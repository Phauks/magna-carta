/*
 * Card is a composition of parts. The dual export — bare names (Root, Header, …) plus
 * Card-prefixed aliases — supports both import idioms: `import * as Card from ".../card"` then
 * <Card.Root>, or `import { Card, CardHeader } from ".../card"`. This is the house namespace
 * shape for every multi-part component (Tabs, Dialog, … follow it).
 */
import Root from "./card.svelte";
import Content from "./card-content.svelte";
import Description from "./card-description.svelte";
import Footer from "./card-footer.svelte";
import Header from "./card-header.svelte";
import Title from "./card-title.svelte";

export {
  Root,
  Content,
  Description,
  Footer,
  Header,
  Title,
  //
  Root as Card,
  Content as CardContent,
  Description as CardDescription,
  Footer as CardFooter,
  Header as CardHeader,
  Title as CardTitle,
};
