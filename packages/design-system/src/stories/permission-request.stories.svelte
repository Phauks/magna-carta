<script module lang="ts">
  /*
   * PermissionRequest — the one window a member is asked for a permission in. It is an ActionDialog
   * question with a fixed shape: what is being allowed, who is asking, and the list of grants.
   *
   * It has no variant axis, so it is one story: every request in the product is this panel with
   * different words in it. The play function asserts the three parts are present and that the
   * answer reaches the caller; a second, hidden story holds the refusal, which a showcase does not
   * show. The panel portals to the body, so the play functions query `within(document.body)`.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import PermissionRequest from "../lib/components/permission-request/permission-request.svelte";
  import type { ActionOutcome } from "../lib/components/action-dialog/types.ts";
  import * as Alert from "../lib/components/alert/index.ts";
  import Button from "../lib/components/button/index.ts";

  const { Story } = defineMeta({
    title: "Overlay/PermissionRequest",
    component: PermissionRequest,
    args: {
      heading: "Allow Magna Carta to Use Your Outlook Calendar",
      askedBy: "Calendar Sync",
      grants: [
        "See your Outlook calendars and the events in them",
        "Add, change and remove events in your Outlook calendars",
        "Stay connected until you disconnect",
      ],
    },
    parameters: {
      controls: { include: ["heading", "askedBy", "grants"] },
    },
  });
</script>

<script lang="ts">
  const showing = $state({ request: false, refused: false });
  let allowedCount = $state(0);
  let dismissedCount = $state(0);
  let turnedDown = $state(false);

  async function allow(): Promise<ActionOutcome> {
    allowedCount += 1;
    return "committed";
  }

  async function refuse(): Promise<ActionOutcome> {
    turnedDown = true;
    return "refused";
  }
</script>

<Story
  name="Default"
  play={async ({ step }) => {
    const body = within(document.body);

    await step("Opens as a question naming what is being allowed", async () => {
      await userEvent.click(body.getByRole("button", { name: "Connect Outlook" }));
      const panel = await body.findByRole("alertdialog", {
        name: "Allow Magna Carta to Use Your Outlook Calendar",
      });
      await expect(panel).toBeVisible();
    });

    await step("Names who is asking and lists every grant", async () => {
      const panel = within(await body.findByRole("alertdialog"));
      await expect(panel.getByText("Asked by Calendar Sync")).toBeVisible();
      await expect(panel.getAllByRole("listitem")).toHaveLength(3);
    });

    await step("Offers exactly two answers, Cancel and Allow", async () => {
      const panel = within(await body.findByRole("alertdialog"));
      await expect(panel.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Allow" })).toBeVisible();
    });

    await step("Allowing reaches the caller and closes the window", async () => {
      const panel = within(await body.findByRole("alertdialog"));
      await userEvent.click(panel.getByRole("button", { name: "Allow" }));
      await waitFor(() => expect(body.queryByRole("alertdialog")).toBeNull());
      await expect(body.getByTestId("allowed-count")).toHaveTextContent("1");
    });

    await step("Walking away tells the caller and grants nothing", async () => {
      await userEvent.click(body.getByRole("button", { name: "Connect Outlook" }));
      const panel = within(await body.findByRole("alertdialog"));
      await userEvent.click(panel.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(body.queryByRole("alertdialog")).toBeNull());
      await expect(body.getByTestId("allowed-count")).toHaveTextContent("1");
      await expect(body.getByTestId("dismissed-count")).toHaveTextContent("1");
    });
  }}
>
  {#snippet template(args)}
    <div class="flex flex-col items-start gap-8">
      <Button onclick={() => (showing.request = true)}>Connect Outlook</Button>
      <p class="text-text-muted text-sm">
        Allowed <span data-testid="allowed-count">{allowedCount}</span>, walked away
        <span data-testid="dismissed-count">{dismissedCount}</span>
      </p>
    </div>
    <PermissionRequest
      {...args}
      bind:open={showing.request}
      onAllow={allow}
      onDismiss={() => (dismissedCount += 1)}
    />
  {/snippet}
</Story>

<Story
  name="Refused by the provider"
  tags={["!dev", "!autodocs"]}
  play={async ({ step }) => {
    const body = within(document.body);

    await step("A grant that fails leaves the window standing with the reason", async () => {
      await userEvent.click(body.getByRole("button", { name: "Connect Outlook (refused)" }));
      const panel = within(await body.findByRole("alertdialog"));
      await userEvent.click(panel.getByRole("button", { name: "Allow" }));
      await expect(await panel.findByText("Microsoft did not answer.")).toBeVisible();
      await expect(panel.getByRole("button", { name: "Allow" })).toBeVisible();
    });
  }}
>
  {#snippet template(args)}
    <Button onclick={() => (showing.refused = true)}>Connect Outlook (refused)</Button>
    <PermissionRequest {...args} bind:open={showing.refused} onAllow={refuse}>
      {#snippet notice()}
        {#if turnedDown}
          <Alert.Root variant="danger">
            <Alert.Description>Microsoft did not answer.</Alert.Description>
          </Alert.Root>
        {/if}
      {/snippet}
    </PermissionRequest>
  {/snippet}
</Story>
