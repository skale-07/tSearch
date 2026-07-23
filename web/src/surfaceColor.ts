/** Yellow → orange → red for identity surface score. Mirrors server identitySurface. */
export function surfaceScoreToCss(score: number, max = 12): string {
  if (score <= 0) return "rgba(154, 163, 178, 0.35)";
  const x = Math.min(1, Math.max(0, score / Math.max(1, max)));
  const stops = [
    { t: 0, r: 232, g: 197, b: 106 },
    { t: 0.5, r: 232, g: 135, b: 58 },
    { t: 1, r: 232, g: 69, b: 58 },
  ];
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1].t) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const u = (x - a.t) / (b.t - a.t || 1);
  const r = Math.round(a.r + (b.r - a.r) * u);
  const g = Math.round(a.g + (b.g - a.g) * u);
  const bl = Math.round(a.b + (b.b - a.b) * u);
  return `rgb(${r}, ${g}, ${bl})`;
}
