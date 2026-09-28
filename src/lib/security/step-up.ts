const WINDOW_MS = 10 * 60 * 1000;

export function stepUpFresh(confirmedAt: string | Date | null, now = Date.now()): boolean {
  if (!confirmedAt) return false;
  const time = confirmedAt instanceof Date ? confirmedAt.getTime() : Date.parse(confirmedAt);
  if (!Number.isFinite(time)) return false;
  const age = now - time;
  return age >= 0 && age <= WINDOW_MS;
}
