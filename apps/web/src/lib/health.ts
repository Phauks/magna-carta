export type Health = { status: "ok"; version: string; time: string };

export async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
}
