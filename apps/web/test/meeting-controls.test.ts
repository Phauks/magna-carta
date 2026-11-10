// @vitest-environment happy-dom
/*
 * The control bar's Effects, Polls and Q&A controls.
 *
 * THE EFFECTS PANEL DRAWS NO CONTROL THAT CANNOT ACT. Background blur is unavailable in nearly every
 * browser, so the case written first is that one: a line of text and no toggle. Where the machine
 * decides, it is a line naming which way it is set; only a camera that offers both positions gets the
 * two rows. And the noise switch stands where the TRACK says, not where the preference does, because
 * a browser may decline a treatment and the member has to see that it did.
 *
 * The trigger is there in a call as well as a meeting — a call has sound to treat and no picture —
 * and in a call the panel has no background section at all.
 *
 * THE POLLS AND Q&A CONTROLS carry their counts where a member who is not looking at either panel
 * will see them, and only where there is something to count.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Controls from "./meeting-controls-harness.svelte";
import {
  BLUR_UNAVAILABLE_STATEMENT,
  DEFAULT_EFFECT_SETTINGS,
  type AppliedEffects,
  type EffectsChange,
  type MediaEffectSettings,
} from "$lib/meetings/client/media-effects.ts";

type ControlsProps = ComponentProps<typeof Controls>;

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let changed: MediaEffectSettings[] = [];
/** Which half of the panel each change said it came from. */
let changeKinds: EffectsChange[] = [];
let opened: string[] = [];

/** What a browser that reports all three treatments and offers no blur would say. */
function applied(over: Partial<AppliedEffects> = {}): AppliedEffects {
  return {
    audio: {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      voiceIsolation: null,
    },
    blur: "unavailable",
    platformBlur: null,
    background: "none",
    backgroundByProduct: false,
    imageChosen: false,
    noiseRemoval: "unavailable",
    refusal: null,
    ...over,
  };
}

function bar(over: Partial<ControlsProps> = {}): ControlsProps {
  return {
    microphoneOn: true,
    cameraOn: true,
    sharing: false,
    appliedEffects: applied(),
    effectSettings: DEFAULT_EFFECT_SETTINGS,
    onChangeEffects: (settings: MediaEffectSettings, change: EffectsChange) => {
      changed.push(settings);
      changeKinds.push(change);
    },
    onOpenPolls: () => opened.push("polls"),
    onOpenQuestions: () => opened.push("questions"),
    onToggleMicrophone: () => {},
    onToggleCamera: () => {},
    onToggleSharing: () => {},
    onToggleHand: () => {},
    onLeave: () => {},
    ...over,
  };
}

function effectsTrigger(): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "Effects",
  );
}

/** Open the Effects panel, which is portalled to the document. */
function openEffects(): void {
  effectsTrigger()?.click();
  flushSync();
}

function buttonReading(words: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((button) =>
    button.textContent?.trim().startsWith(words),
  );
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  changed = [];
  changeKinds = [];
  opened = [];
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  for (const floating of document.body.querySelectorAll('[role="dialog"]')) floating.remove();
});

describe("the Effects control", () => {
  it("is present in a meeting", () => {
    instance = mount(Controls, { target, props: bar() });
    flushSync();
    expect(effectsTrigger()).toBeDefined();
  });

  it("is present in a call, whose panel has no background section", () => {
    instance = mount(Controls, { target, props: bar({ medium: "audio" }) });
    flushSync();
    expect(effectsTrigger()).toBeDefined();

    openEffects();
    expect(document.body.textContent).toContain("Reduce background noise");
    expect(document.body.textContent).not.toContain("Background");
  });

  it("is not drawn before anything is captured, when there is nothing to treat", () => {
    instance = mount(Controls, { target, props: bar({ appliedEffects: null }) });
    flushSync();
    expect(effectsTrigger()).toBeUndefined();
  });

  it("draws a line of text and no control where blur is unavailable", () => {
    instance = mount(Controls, { target, props: bar() });
    flushSync();
    openEffects();

    expect(document.body.textContent).toContain(BLUR_UNAVAILABLE_STATEMENT);
    expect(buttonReading("Blur")).toBeUndefined();
    expect(buttonReading("None")).toBeUndefined();
  });

  it("names where blur is set where the machine decides it, and offers no control", () => {
    instance = mount(Controls, {
      target,
      props: bar({ appliedEffects: applied({ blur: "platform-controlled", platformBlur: true }) }),
    });
    flushSync();
    openEffects();

    expect(document.body.textContent).toContain(
      "Background blur is on, set in your computer's own settings.",
    );
    expect(buttonReading("Blur")).toBeUndefined();
  });

  it("offers None and Blur where the camera offers both, the current one marked", () => {
    instance = mount(Controls, {
      target,
      props: bar({ appliedEffects: applied({ blur: "off" }) }),
    });
    flushSync();
    openEffects();

    expect(buttonReading("None")?.getAttribute("aria-pressed")).toBe("true");
    expect(buttonReading("Blur")?.getAttribute("aria-pressed")).toBe("false");

    buttonReading("Blur")?.click();
    flushSync();
    expect(changed).toEqual([{ background: "blur", reduceNoise: true, removeNoise: false }]);
    expect(changeKinds).toEqual(["background"]);
  });

  it("says a change to the noise switch is about the microphone, so a blur nobody chose stays", () => {
    instance = mount(Controls, {
      target,
      props: bar({
        // The machine blurred a camera the product may set; the member asked for their own background.
        effectSettings: { background: "none", reduceNoise: true, removeNoise: false },
        appliedEffects: applied({ blur: "on" }),
      }),
    });
    flushSync();
    openEffects();

    document.body.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
    flushSync();

    expect(changed).toEqual([{ background: "none", reduceNoise: false, removeNoise: false }]);
    expect(changeKinds).toEqual(["microphone"]);
  });

  it("offers None, Blur and Image where the product draws the background", () => {
    instance = mount(Controls, {
      target,
      props: bar({
        appliedEffects: applied({
          backgroundByProduct: true,
          background: "blur",
          imageChosen: true,
        }),
      }),
    });
    flushSync();
    openEffects();

    expect(buttonReading("Blur")?.getAttribute("aria-pressed")).toBe("true");
    expect(buttonReading("Image")?.getAttribute("aria-pressed")).toBe("false");

    buttonReading("Image")?.click();
    flushSync();
    expect(changed).toEqual([{ background: "image", reduceNoise: true, removeNoise: false }]);
  });

  it("asks for a picture before standing anybody in front of nothing", () => {
    instance = mount(Controls, {
      target,
      props: bar({ appliedEffects: applied({ backgroundByProduct: true, background: "none" }) }),
    });
    flushSync();
    openEffects();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    buttonReading("Image")?.click();
    flushSync();
    expect(changed).toEqual([]);
    expect(document.querySelector('input[aria-label="Choose a picture"]')).not.toBeNull();
  });

  it("stands the noise switch where the track says, not where the preference does", () => {
    instance = mount(Controls, {
      target,
      props: bar({
        // The member asked for noise reduction and the browser declined it.
        effectSettings: { background: "none", reduceNoise: true, removeNoise: false },
        appliedEffects: applied({
          audio: {
            noiseSuppression: false,
            echoCancellation: true,
            autoGainControl: true,
            voiceIsolation: null,
          },
        }),
      }),
    });
    flushSync();
    openEffects();

    const noise = document.body.querySelector('[role="switch"]');
    expect(noise?.getAttribute("aria-checked")).toBe("false");
  });

  it("says the browser decides where the track does not report noise suppression", () => {
    instance = mount(Controls, {
      target,
      props: bar({
        appliedEffects: applied({
          audio: {
            noiseSuppression: null,
            echoCancellation: true,
            autoGainControl: null,
            voiceIsolation: null,
          },
        }),
      }),
    });
    flushSync();
    openEffects();

    expect(document.body.textContent).toContain(
      "Your browser decides this and does not report it.",
    );
  });

  it("states a refusal in the panel's own band", () => {
    instance = mount(Controls, {
      target,
      props: bar({
        appliedEffects: applied({
          refusal: "Your browser did not change how it treats your microphone.",
        }),
      }),
    });
    flushSync();
    openEffects();

    expect(document.body.textContent).toContain(
      "Your browser did not change how it treats your microphone.",
    );
  });
});

describe("the Polls and Q&A controls", () => {
  it("open their panels and carry their counts only where there is something to count", () => {
    instance = mount(Controls, { target, props: bar({ pollsWaiting: 2, questionsWaiting: 0 }) });
    flushSync();

    const polls = buttonReading("Polls");
    const questions = buttonReading("Q&A");
    expect(polls?.textContent).toContain("2");
    expect(questions?.textContent?.trim()).toBe("Q&A");

    polls?.click();
    questions?.click();
    expect(opened).toEqual(["polls", "questions"]);
  });

  it("are not drawn where the room screen offers no panel behind them", () => {
    instance = mount(Controls, {
      target,
      props: bar({ onOpenPolls: undefined, onOpenQuestions: undefined }),
    });
    flushSync();
    expect(buttonReading("Polls")).toBeUndefined();
    expect(buttonReading("Q&A")).toBeUndefined();
  });
});
