<script module lang="ts">
  /*
   * VideoPlayer — Tier 3, our own controls laid over the browser's <video>. The variant axis is
   * `variant`: `full` is the viewer, `compact` a preview inside a panel; `media="audio"` is the same
   * player for sound alone. Each story plays a six-second WebM recording built for the catalog (a
   * square sliding across a dark field, with a tone), small enough to sit in the repository.
   * svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fn, userEvent, waitFor, within } from "storybook/test";
  import VideoPlayer from "../lib/components/video-player/index.ts";
  import sampleRecording from "./fixtures/sample-recording.webm";

  const { Story } = defineMeta({
    title: "Data Display/VideoPlayer",
    component: VideoPlayer,
    args: { src: sampleRecording, title: "Deposition of the witness", variant: "full" },
    argTypes: {
      variant: { control: "select", options: ["full", "compact"] },
      media: { control: "select", options: ["video", "audio"] },
    },
    parameters: {
      controls: { include: ["variant", "media", "startAt"] },
    },
  });

  type VideoPlayerStoryArgs = ComponentProps<typeof VideoPlayer>;
</script>

{#snippet template(args: VideoPlayerStoryArgs)}
  {#if args.media === "audio" || args.variant === "compact"}
    <div class="max-w-3xl">
      <VideoPlayer {...args} />
    </div>
  {:else}
    <div class="flex aspect-video max-w-3xl flex-col">
      <VideoPlayer class="min-h-0 flex-1" {...args} />
    </div>
  {/if}
{/snippet}

<Story
  name="Full"
  args={{ onCopyMoment: fn(), onScreenshot: fn() }}
  {template}
  play={async ({ args, canvas, step }) => {
    const page = within(document.body);
    await step("Names the recording as a region", async () => {
      await expect(
        canvas.getByRole("region", { name: "Deposition of the witness" }),
      ).toBeInTheDocument();
    });
    await step("Learns the recording's length", async () => {
      await waitFor(() => expect(canvas.getByText("/ 0:00:06")).toBeInTheDocument());
    });
    await step("Offers no picture in picture", async () => {
      await expect(canvas.queryByRole("button", { name: "Picture in Picture" })).toBeNull();
    });
    await step("A ten-second step forward stops at the end", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Forward 10 Seconds" }));
      await waitFor(() => expect(canvas.getByText(/^0:00:06/u)).toBeInTheDocument());
    });
    await step("The settings menu copies the moment's link", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
      await userEvent.click(await page.findByRole("menuitem", { name: /Copy Link at 0:00:06/u }));
      await expect(args.onCopyMoment).toHaveBeenCalledWith(6);
    });
    await step("Speed is a submenu of the settings", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
      await userEvent.click(await page.findByRole("menuitem", { name: /Speed/u }));
      await userEvent.click(await page.findByRole("menuitemradio", { name: "1.5×" }));
      await userEvent.keyboard("{Escape}");
      await userEvent.keyboard("{Escape}");
    });
    await step("A screenshot hands the caller the frame as an image", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
      await userEvent.click(await page.findByRole("menuitem", { name: "Save Screenshot" }));
      await waitFor(() => expect(args.onScreenshot).toHaveBeenCalledOnce());
      const [image, seconds] = (args.onScreenshot as ReturnType<typeof fn>).mock.calls[0] ?? [];
      await expect(image).toBeInstanceOf(Blob);
      await expect(seconds).toBe(6);
    });
    await step("Mute toggles its own name", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Mute" }));
      await expect(canvas.getByRole("button", { name: "Unmute" })).toBeInTheDocument();
    });
  }}
/>

<Story
  name="Compact"
  args={{ variant: "compact", onDownload: fn() }}
  {template}
  play={async ({ args, canvas, step }) => {
    await step("Offers play, seek, sound, settings and full screen", async () => {
      await expect(canvas.getByRole("button", { name: "Play" })).toBeInTheDocument();
      await expect(canvas.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
      await expect(canvas.getByRole("button", { name: "Full Screen" })).toBeInTheDocument();
    });
    await step("Download is in the settings, and the caller's", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
      await userEvent.click(await within(document.body).findByRole("menuitem", { name: "Download" }));
      await expect(args.onDownload).toHaveBeenCalledOnce();
    });
  }}
/>

<Story
  name="Sound Alone"
  args={{ media: "audio", title: "Voicemail from the client", onCopyMoment: fn(), onScreenshot: fn() }}
  {template}
  play={async ({ canvas, step }) => {
    await step("Draws the controls without a picture", async () => {
      await waitFor(() => expect(canvas.getByText("/ 0:00:06")).toBeInTheDocument());
      await expect(canvas.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    await step("Leaves out what only a picture has", async () => {
      await expect(canvas.queryByRole("button", { name: "Back One Frame" })).toBeNull();
      await expect(canvas.queryByRole("button", { name: "Full Screen" })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
      await expect(
        await within(document.body).findByRole("menuitem", { name: /Copy Link at/u }),
      ).toBeInTheDocument();
      await expect(within(document.body).queryByRole("menuitem", { name: "Save Screenshot" })).toBeNull();
      await userEvent.keyboard("{Escape}");
    });
  }}
/>

<Story
  name="Cannot Play"
  tags={["!dev", "!autodocs"]}
  args={{ src: "data:video/mp4;base64,AAAA", onUnplayable: fn() }}
  {template}
  play={async ({ args, canvas, step }) => {
    await step("Tells the caller the browser could not play it", async () => {
      await waitFor(() => expect(args.onUnplayable).toHaveBeenCalledOnce());
      await expect(canvas.getByRole("button", { name: "Play" })).toBeDisabled();
      await expect(canvas.queryByRole("button", { name: "Play from the Picture" })).toBeNull();
    });
  }}
/>
