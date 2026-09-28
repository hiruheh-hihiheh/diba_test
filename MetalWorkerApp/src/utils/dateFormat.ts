/**
 * Date formatting shared by the dashboard rows, the history list and the
 * detail screen, so a dispatch never reads one way in one place and another
 * way in the next.
 */

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);
}

/** "Today" | "Yesterday" | "12 Sep", given translated day words. */
export function dayLabel(iso: string, now: Date, words: { today: string; yesterday: string }): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";

  const diff = daysBetween(when, now);
  if (diff === 0) return words.today;
  if (diff === 1) return words.yesterday;
  if (diff > 1 && diff < 7) return relativeDay(when, now);

  return when.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function relativeDay(when: Date, now: Date): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[when.getDay()];
}

/** "06:29 PM" in the device locale. */
export function timeLabel(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "Today • 06:29 PM" — the two-part form used in list rows. */
export function stampLabel(iso: string, now: Date, words: { today: string; yesterday: string }): string {
  const day = dayLabel(iso, now, words);
  const time = timeLabel(iso);
  return day && time ? `${day} • ${time}` : day || time;
}

/** "12 Sep 2026, 06:29 PM" — the unambiguous form used on the detail screen. */
export function fullStamp(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Live clock string for the form's "date and time" row. */
export function clockLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
