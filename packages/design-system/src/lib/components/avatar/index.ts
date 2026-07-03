/*
 * Avatar is a composition of parts (the house namespace shape, same as Card/Tabs): bare names
 * (Root, Image, Fallback) plus Avatar-prefixed aliases, so both `import * as Avatar` and
 * `import { Avatar, AvatarImage }` work.
 */
import Root from "./avatar.svelte";
import Image from "./avatar-image.svelte";
import Fallback from "./avatar-fallback.svelte";

export {
  Root,
  Image,
  Fallback,
  //
  Root as Avatar,
  Image as AvatarImage,
  Fallback as AvatarFallback,
};
