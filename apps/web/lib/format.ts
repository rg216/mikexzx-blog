import { site } from "./site";

const dateFormatter = new Intl.DateTimeFormat(site.locale, {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: site.timeZone,
});

/** "2026-10-01T01:00:00Z" → "2026年10月1日"（按站点时区）。 */
export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}
