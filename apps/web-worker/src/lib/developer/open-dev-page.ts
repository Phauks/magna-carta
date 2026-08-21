/*
 * Open a dev-console page link. From the popped-out console (window.opener set) it drives the MAIN
 * window and keeps the console window as the dev view; in the top-bar popover (no opener) it lets
 * the anchor navigate normally. Shared by the Sitemap tree and the Fixtures list.
 */
export function openDevPage(event: MouseEvent, href: string): void {
  const opener = window.opener as Window | null;
  if (opener && !opener.closed) {
    event.preventDefault();
    opener.location.href = href;
    opener.focus();
  }
}
