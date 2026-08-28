/** Pure time formatting for the popup. */

/** "just now", "40s ago", "3m ago", "2h ago" */
export function formatAge(fetchedAt: string, now: Date): string {
  const ms = now.getTime() - Date.parse(fetchedAt);
  if (Number.isNaN(ms) || ms < 0) return 'unknown';
  const s = Math.floor(ms / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** "2h 14m", "4d", "38m", or null when unknown/past. */
export function formatCountdown(resetsAt: string | null, now: Date): string | null {
  if (resetsAt === null) return null;
  const ms = Date.parse(resetsAt) - now.getTime();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const totalHours = Math.floor(totalMin / 60);
  if (totalHours < 24) {
    const min = totalMin % 60;
    return min === 0 ? `${totalHours}h` : `${totalHours}h ${min}m`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}
