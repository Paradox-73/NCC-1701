// Colours and font for canvas drawing, which cannot read CSS classes. Each reads a CSS custom property when the
// page defines it (the design system sets them on :root) and falls back to a neutral value.
const css = (name, fallback) => (typeof document === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

export const chartColors = () => ({
  mute: css('--chart-axis', '#878e99'),
  grid: css('--chart-grid', '#ffffff14'),
  ink2: css('--chart-ink', '#aeb4bd'),
});
// A palette for series; pass `color` per series to override.
export const SERIES = ['#5b8def', '#c77e52', '#3e9a86', '#b59a55', '#d46fa6', '#b7c0ce'];
export const chartFont = () => css('--chart-font', 'system-ui, sans-serif');
export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
