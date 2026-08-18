// How the portal writes a moment in time. Shared, because the same two forms
// are needed wherever something happened: an order's history, the list of
// orders, the notification feed. They used to be copied per screen, and copies
// drift.

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// fmtRelative renders a compact "X ago" label (abbreviations dodge RU plural
// forms); falls back to the absolute date past a week. Full date belongs in a
// title attribute beside it.
//
// `now` is passed in rather than read here so a caller can re-render on a tick
// and have every row move together.
export function fmtRelative(iso: string, now: number = Date.now()): string {
  const sec = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (sec < 5) return "только что";
  if (sec < 60) return `${sec} сек назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} дн назад`;
  return fmtDateTime(iso);
}
