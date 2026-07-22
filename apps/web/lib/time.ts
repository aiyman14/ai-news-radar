/**
 * Time convention (plan "Conventions", locked): storage is timestamptz
 * (UTC); DISPLAY IS EASTERN everywhere via this one constant.
 */
export const APP_TIMEZONE = "America/New_York";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatEastern(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatter.format(date)} ET`;
}
