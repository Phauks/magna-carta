/*
 * A room's old address, /meetings/rooms/{linkCode}, kept so links already sent still work. It goes
 * straight to /room/{linkCode}, which reads the room and shows its name in the address bar.
 */
import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  redirect(307, `/room/${encodeURIComponent(params.linkCode)}`);
};
