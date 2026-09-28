const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatDateTime(iso) {
  return iso ? dateTime.format(new Date(iso)) : "";
}

export function formatDate(iso) {
  return iso ? dateOnly.format(new Date(iso)) : "";
}

export function formatAgo(iso, now = Date.now()) {
  if (!iso) return "never";
  const minutes = Math.round((Date.parse(iso) - now) / 60000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export function periodSuffix(lastPeriodType) {
  return lastPeriodType === "OT" || lastPeriodType === "SO" ? lastPeriodType : "";
}
