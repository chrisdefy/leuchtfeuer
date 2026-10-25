const nf = new Intl.NumberFormat("de-DE");

export function formatTokens(n: number) {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}K`;
  return nf.format(n);
}

function trim(n: number) {
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, "").replace(".", ",");
}

/** USD per million tokens, compact. */
export function formatPrice(perM: number | null) {
  if (perM === null) return "variabel";
  if (perM === 0) return "frei";
  perM = Math.round(perM * 1000) / 1000;
  if (perM < 0.1) return `$${perM.toFixed(3).replace(".", ",")}`;
  if (perM < 10) return `$${perM.toFixed(2).replace(".", ",")}`;
  return `$${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(perM)}`;
}

/** Actual spend in USD. */
export function formatCost(usd: number | undefined) {
  if (usd === undefined) return "";
  if (usd === 0) return "$0";
  if (usd < 0.0001) return "< $0,0001";
  if (usd < 0.01) return `$${usd.toFixed(4).replace(".", ",")}`;
  return `$${usd.toFixed(usd < 0.1 ? 3 : 2).replace(".", ",")}`;
}

const rtf = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });

export function formatRelativeDay(ts: number) {
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(ts) - startOfDay(Date.now())) / 86_400_000);
  if (days >= -1) return rtf.format(days, "day").replace(/^./, (c) => c.toUpperCase());
  if (days >= -7) return "Letzte Woche";
  if (days >= -30) return "Letzter Monat";
  return new Date(ts).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}
