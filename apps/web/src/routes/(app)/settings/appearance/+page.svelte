<script lang="ts">
  /*
   * Settings · Appearance — the user-facing controls over the personalization
   * axes: theme is the firm's brand choice (admin policy + lock arrive with the settings
   * registry later in 0·7b); mode/density/motion are the user's accessibility axes. The pickers
   * drive the SAME seam the boot script reads (theme-preference.ts), so a choice applies
   * instantly and survives reload. Intent, never implementation: users pick "reduced", never a
   * millisecond value.
   */
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Select from "@magna-carta/design-system/select";
  import Label from "@magna-carta/design-system/label";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import {
    applyThemePreference,
    readThemePreference,
    type DensityPreference,
    type Mode,
    type MotionPreference,
  } from "@magna-carta/design-system/internal/theme-preference";

  const THEMES = [
    { value: "chancery", label: "Chancery — ink & gold (flagship)" },
    { value: "verdigris", label: "Verdigris — aged copper" },
    { value: "parchment", label: "Parchment — warm cream" },
    { value: "oxblood", label: "Oxblood — burgundy" },
    { value: "aubergine", label: "Aubergine — deep plum" },
    { value: "slate", label: "Slate — near neutral" },
  ];

  const initial = readThemePreference();
  let theme = $state(initial.theme);
  let mode = $state<Mode>(initial.mode);
  let motion = $state<MotionPreference>(initial.motion);
  let density = $state<DensityPreference>(initial.density);

  function apply(): void {
    applyThemePreference(theme, mode, motion, density);
  }
</script>

<svelte:head>
  <title>Appearance · Settings · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Settings</Masthead.Eyebrow>
    <Masthead.Title>Appearance</Masthead.Title>
    <Masthead.Meta>
      <span>The theme is the firm's brand; how the interface reads is yours.</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<div class="flex flex-col gap-24" style="max-inline-size: var(--mc-size-prose)">
  <div class="flex flex-col gap-8">
    <Label for="appearance-theme">Theme</Label>
    <Select.Root
      type="single"
      items={THEMES}
      bind:value={
        () => theme,
        (next) => {
          theme = next as string;
          apply();
        }
      }
      allowDeselect={false}
    >
      <Select.Trigger id="appearance-theme" aria-label="Theme" class="w-full">
        <Select.Value placeholder="Select a theme" />
      </Select.Trigger>
      <Select.Content>
        {#each THEMES as item (item.value)}
          <Select.Item value={item.value} label={item.label} />
        {/each}
      </Select.Content>
    </Select.Root>
    <p class="text-sm text-muted">
      Six curated themes, each in light and dark. A firm-wide default (and lock) arrives with firm
      settings.
    </p>
  </div>

  <fieldset class="flex flex-col gap-8">
    <legend class="mc-masthead-eyebrow">Mode</legend>
    <RadioGroup.Root
      bind:value={
        () => mode,
        (next) => {
          mode = next as Mode;
          apply();
        }
      }
    >
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="light" id="mode-light" />
        <Label for="mode-light">Light</Label>
      </div>
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="dark" id="mode-dark" />
        <Label for="mode-dark">Dark</Label>
      </div>
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="system" id="mode-system" />
        <Label for="mode-system">Match my system</Label>
      </div>
    </RadioGroup.Root>
  </fieldset>

  <fieldset class="flex flex-col gap-8">
    <legend class="mc-masthead-eyebrow">Density</legend>
    <RadioGroup.Root
      bind:value={
        () => density,
        (next) => {
          density = next as DensityPreference;
          apply();
        }
      }
    >
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="comfortable" id="density-comfortable" />
        <Label for="density-comfortable">Comfortable</Label>
      </div>
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="compact" id="density-compact" />
        <Label for="density-compact">Compact — tighter rows and controls</Label>
      </div>
    </RadioGroup.Root>
  </fieldset>

  <fieldset class="flex flex-col gap-8">
    <legend class="mc-masthead-eyebrow">Motion</legend>
    <RadioGroup.Root
      bind:value={
        () => motion,
        (next) => {
          motion = next as MotionPreference;
          apply();
        }
      }
    >
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="full" id="motion-full" />
        <Label for="motion-full">Full</Label>
      </div>
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="reduced" id="motion-reduced" />
        <Label for="motion-reduced">Reduced — shorter, quieter</Label>
      </div>
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="off" id="motion-off" />
        <Label for="motion-off">Off — instant</Label>
      </div>
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="system" id="motion-system" />
        <Label for="motion-system">Match my system</Label>
      </div>
    </RadioGroup.Root>
  </fieldset>
</div>
