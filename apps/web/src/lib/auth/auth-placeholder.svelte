<script lang="ts">
  /*
   * The holding card behind a sign-in side door that is linked but whose form is not built yet
   * (password reset, recovery codes). Each of those flows has its own surface coming; until then
   * the link has to land somewhere honest instead of a 404, and the only way back — sign-in — has
   * to be one click away.
   *
   * `description` is the screen's real subheading and stays as the form arrives; `note` is the
   * temporary line that says the form is not here yet, and leaves with it.
   */
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import AuthFrame from "$lib/auth/auth-frame.svelte";

  let {
    title,
    description,
    note,
  }: { title: string; description: string; note: string } = $props();
</script>

<svelte:head><title>{title} · Magna Carta</title></svelte:head>

<AuthFrame>
  <Card.Root class="relative w-full max-w-sm bg-surface-default shadow-elevation-2">
    <Card.Content class="flex flex-col gap-24">
      <Masthead.Heading>
        <Masthead.Title class="text-2xl">{title}</Masthead.Title>
        <Masthead.Meta>{description}</Masthead.Meta>
      </Masthead.Heading>
      <p class="text-sm text-text-muted">{note}</p>
      <Button href="/login" variant="secondary" size="lg" class="w-full">Sign In</Button>
    </Card.Content>
  </Card.Root>
</AuthFrame>
