/**
 * What a labelled field hands the control it names. Spread onto the control and the association is
 * made: the label points at the id, the hint and the error are the control's description, and an
 * error marks the control invalid. The caller cannot wire these differently, which is the point —
 * measured across the first fifteen panels on the action dialog shell, about a third of the hints
 * written by hand had no `aria-describedby` at all.
 */
export interface LabelledFieldControlProperties {
  readonly id: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
  /** The error, as the control's hover text: the only place it is shown on screen. */
  readonly title: string | undefined;
}
