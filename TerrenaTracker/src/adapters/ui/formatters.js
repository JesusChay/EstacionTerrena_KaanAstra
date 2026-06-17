export function formatField(value, decimals = 2) {
  return Number.isFinite(value) ? value.toFixed(decimals) : "--";
}

export function formatHeading(deg, cardinal) {
  if (!Number.isFinite(deg)) return "--";
  return deg.toFixed(1) + "\u00B0 (" + (cardinal || "?") + ")";
}

export function formatWindDir(deg, cardinal) {
  if (!Number.isFinite(deg)) return "--";
  return deg.toFixed(1) + "\u00B0 " + (cardinal || "");
}
