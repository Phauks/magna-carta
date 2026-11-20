/*
 * The screenshot half of reporting a problem, shared by the two report dialogs: the picture taken
 * as a dialog opens, the covers drawn over it, which of the two steps the dialog is on, and the
 * upload once the report itself has been filed.
 *
 * THE REPORT FIRST, THE PICTURE SECOND. The words are filed before the picture is sent, so a
 * picture that cannot be sent never costs the report. A failed upload is said on the done panel.
 */
import { attachProblemReportScreenshot } from "./problem-reports-api.ts";
import { captureScreen, coveredScreenshotBase64, type Cover } from "./screen-capture.ts";

export type ReportStep = "describe" | "screenshot";

export class ReportScreenshot {
  step = $state<ReportStep>("describe");
  picture = $state<HTMLCanvasElement | null>(null);
  capturing = $state(false);
  covers = $state<Cover[]>([]);
  include = $state(true);
  /** Set when the report was filed and its picture was not attached. */
  attachFailed = $state(false);

  /** A fresh report: back to the first step, and a new picture of the screen behind the dialog. */
  start(): void {
    this.step = "describe";
    this.picture = null;
    this.covers = [];
    this.include = true;
    this.attachFailed = false;
    this.capturing = true;
    void captureScreen().then((picture) => {
      this.picture = picture;
      this.capturing = false;
    });
  }

  /** Whether the report will go with a picture, as things stand. */
  get sendsPicture(): boolean {
    return this.include && this.picture !== null;
  }

  /** Attach the covered picture to a filed report, where there is one to send. */
  async attachTo(incidentId: string): Promise<void> {
    if (!this.sendsPicture || this.picture === null) return;
    const encoded = await coveredScreenshotBase64(this.picture, this.covers);
    if (encoded === null) {
      this.attachFailed = true;
      return;
    }
    const outcome = await attachProblemReportScreenshot(incidentId, encoded);
    this.attachFailed = outcome.kind !== "ok";
  }
}
