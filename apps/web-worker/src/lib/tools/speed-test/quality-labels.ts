/*
 * The engine scores the connection per use-case and types the set as Record<string, …>, so the
 * use-cases are its to choose. We name the ones it reports today and pass anything else through
 * under its own key: an unlabelled score is still a score, and dropping it would hide a fact.
 */
const USE_CASE_LABELS: Record<string, string> = {
  streaming: "Video streaming",
  gaming: "Online gaming",
  rtc: "Video calls",
};

export function useCaseLabel(key: string): string {
  return USE_CASE_LABELS[key] ?? key;
}
