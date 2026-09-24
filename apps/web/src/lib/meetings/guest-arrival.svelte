<script lang="ts">
  /*
   * The door, from outside: the name somebody arrives under, and a look at their own microphone and
   * camera before they knock.
   *
   * THE NAME IS PRE-FILLED AND IS THEIRS TO CHANGE. It starts as the Directory name the link was
   * minted for, which is right for a person and wrong for an organization — a client company sends
   * whichever of its people is free, and that person types their own name. What they type is what
   * the host reads at the door BESIDE the invited name, so the field takes it as it is, bounded and
   * with its spacing tidied, and never pretends the two are one fact.
   *
   * THE DEVICES ARE CHECKED HERE, AND LET GO HERE. The preview captures, the pickers list what the
   * browser offers, and the meter says whether the microphone is picking anything up. Pressing Join
   * stops every track before anything else happens, because nothing is captured while somebody
   * waits at a door; the room captures again, on the devices chosen here, when a host lets them in.
   *
   * NOTHING IS JOINED BY OPENING THIS. The preview is a capture on this machine and goes nowhere;
   * the one act that spends the link is the Join press, which is the caller's.
   */
  import { onMount, untrack } from "svelte";
  import AudioLines from "@lucide/svelte/icons/audio-lines";
  import MicOff from "@lucide/svelte/icons/mic-off";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import MeetingTile from "./screen/meeting-tile.svelte";
  import { MAX_GUEST_NAME_LENGTH, normalizeGuestName } from "./guest-api.ts";
  import {
    deviceOf,
    devicesOfKind,
    previewConstraints,
    releaseStream,
    type GuestDeviceChoice,
    type GuestDeviceOption,
    type GuestDeviceSeams,
  } from "./client/guest-devices.ts";
  import type { AudioLevelMeter } from "./client/audio-level-meter.ts";
  import type { MeetingMedium } from "./meeting-client.svelte.ts";
  import type { Snippet } from "svelte";

  let {
    invitedName,
    medium,
    seams,
    joining = false,
    onJoin,
    notice,
  }: {
    /** The Directory name the link was minted for, which the name field starts from. */
    invitedName: string;
    /** What the room carries. A call has no camera, so there is no camera picker and no picture. */
    medium: MeetingMedium;
    /** The browser's devices, as a seam so the check runs under a test with fakes. */
    seams: GuestDeviceSeams;
    /** True while the arrival is in flight, so Join cannot be pressed twice. */
    joining?: boolean;
    /** Knock: the name as the door takes it, and the devices the room should capture later. */
    onJoin: (arrival: { confirmedName: string } & GuestDeviceChoice) => void;
    /** What came of the last press, where it did not work, stated under the control that did it. */
    notice?: Snippet;
  } = $props();

  // Read once: the field starts from the invited name and is the person's own from then on.
  let typedName = $state(untrack(() => invitedName));
  const confirmedName = $derived(normalizeGuestName(typedName));

  let preview = $state<MediaStream | null>(null);
  let microphones = $state<readonly GuestDeviceOption[]>([]);
  let cameras = $state<readonly GuestDeviceOption[]>([]);
  let microphoneId = $state<string | null>(null);
  let cameraId = $state<string | null>(null);
  /** Whether the microphone is carrying sound right now, as the meter last judged it. */
  let hearing = $state(false);
  /** Whether the browser refused the devices, which is said rather than left as a blank tile. */
  let captureRefused = $state(false);

  let meter: AudioLevelMeter | null = null;
  /**
   * Which capture is the current one. A picker changed twice in a second starts two captures, and
   * the one that finishes second must not be the one left running behind the first.
   */
  let generation = 0;

  /** Stop the preview and the meter. Every way off this surface goes through here. */
  function release(): void {
    meter?.stop();
    meter = null;
    releaseStream(preview);
    preview = null;
    hearing = false;
  }

  async function capture(): Promise<void> {
    generation += 1;
    const mine = generation;
    release();
    let stream: MediaStream;
    try {
      stream = await seams.getUserMedia(previewConstraints(medium, { microphoneId, cameraId }));
    } catch {
      if (mine === generation) captureRefused = true;
      return;
    }
    if (mine !== generation) {
      releaseStream(stream);
      return;
    }
    captureRefused = false;
    preview = stream;
    // The pickers name what the browser actually opened, which is not always what was asked for.
    const microphone = stream.getAudioTracks()[0];
    microphoneId = deviceOf(microphone) ?? microphoneId;
    cameraId = deviceOf(stream.getVideoTracks()[0]) ?? cameraId;
    if (microphone !== undefined) {
      meter = seams.createAudioLevelMeter(microphone);
      meter.start((speaking) => {
        if (mine === generation) hearing = speaking;
      });
    }
    await listDevices();
  }

  /*
   * Listed AFTER the capture, because a browser names its devices only once it has been allowed to
   * use one: listed first, every row would be a number.
   */
  async function listDevices(): Promise<void> {
    let devices: readonly MediaDeviceInfo[];
    try {
      devices = await seams.enumerateDevices();
    } catch {
      return;
    }
    microphones = devicesOfKind(devices, "audioinput");
    cameras = devicesOfKind(devices, "videoinput");
  }

  function chooseMicrophone(picked: string): void {
    if (picked === "" || picked === microphoneId) return;
    microphoneId = picked;
    void capture();
  }

  function chooseCamera(picked: string): void {
    if (picked === "" || picked === cameraId) return;
    cameraId = picked;
    void capture();
  }

  onMount(() => {
    void capture();
    return () => {
      generation += 1;
      release();
    };
  });

  /** Why Join cannot be pressed yet, stated under the field that is the reason. */
  const nameRefusal = $derived(
    confirmedName === "" ? "Enter the name the host will see at the door." : undefined,
  );

  function join(event: SubmitEvent): void {
    event.preventDefault();
    if (joining || nameRefusal !== undefined) return;
    // Every track goes before the knock: a waiting guest has nothing captured, and the room asks
    // again, on these same devices, when a host lets them in.
    generation += 1;
    release();
    onJoin({ confirmedName, microphoneId, cameraId });
  }

  /** What the tile under the pickers is drawn as: the name as the host will read it. */
  const previewName = $derived(confirmedName === "" ? invitedName : confirmedName);
</script>

<form class="flex flex-col gap-16" onsubmit={join} novalidate>
  <LabelledField label="Your Name" error={nameRefusal}>
    {#snippet children({ props })}
      <Input
        {...props}
        bind:value={typedName}
        maxlength={MAX_GUEST_NAME_LENGTH}
        autocomplete="name"
        disabled={joining}
      />
    {/snippet}
  </LabelledField>

  <MeetingTile class="aspect-video w-full" stream={preview} name={previewName} {medium} speaking={hearing} />

  <!-- THE METER, AS A FINDING. It says what the microphone is doing now, in the one line that is
       always there: a line that appeared only once somebody spoke would move the pickers under the
       pointer the first time they did. -->
  <p class="flex items-center gap-8 text-sm" aria-live="polite">
    {#if hearing}
      <AudioLines class="size-16 shrink-0 text-accent-default" aria-hidden="true" />
      Your microphone is picking you up.
    {:else}
      <MicOff class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
      <span class="text-text-muted">Nothing heard from your microphone yet.</span>
    {/if}
  </p>

  {#if captureRefused}
    <Alert.Root variant="info">
      <Alert.Title>Nothing Is Being Captured</Alert.Title>
      <Alert.Description>
        Your browser did not allow the microphone{medium === "video" ? " or camera" : ""}. You can
        still join and hear the meeting, and allow them from the browser's address bar.
      </Alert.Description>
    </Alert.Root>
  {/if}

  <LabelledField label="Microphone">
    {#snippet children({ props })}
      <Select.Root
        type="single"
        items={microphones.map((device) => ({ value: device.deviceId, label: device.label }))}
        disabled={joining || microphones.length === 0}
        bind:value={() => microphoneId ?? "", chooseMicrophone}
      >
        <Select.Trigger id={props.id} aria-describedby={props["aria-describedby"]}>
          <Select.Value placeholder={placeholderOf("Microphone")} />
        </Select.Trigger>
        <Select.Content>
          {#each microphones as device (device.deviceId)}
            <Select.Item value={device.deviceId} label={device.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    {/snippet}
  </LabelledField>

  {#if medium === "video"}
    <!-- Absent in a call rather than disabled: there is no camera in a call, and a disabled picker
         would say one could be chosen here. -->
    <LabelledField label="Camera">
      {#snippet children({ props })}
        <Select.Root
          type="single"
          items={cameras.map((device) => ({ value: device.deviceId, label: device.label }))}
          disabled={joining || cameras.length === 0}
          bind:value={() => cameraId ?? "", chooseCamera}
        >
          <Select.Trigger id={props.id} aria-describedby={props["aria-describedby"]}>
            <Select.Value placeholder={placeholderOf("Camera")} />
          </Select.Trigger>
          <Select.Content>
            {#each cameras as device (device.deviceId)}
              <Select.Item value={device.deviceId} label={device.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      {/snippet}
    </LabelledField>
  {/if}

  <Button type="submit" disabled={joining || nameRefusal !== undefined}>
    {medium === "audio" ? "Join Call" : "Join Meeting"}
  </Button>

  {@render notice?.()}
</form>
