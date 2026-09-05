export type ExportFormat = 'gif' | 'webp';
export type Quality = 'draft' | 'standard' | 'high';
export type Margin = 'tight' | 'balanced' | 'roomy';
export type Background = '#ffffff' | '#000000' | 'transparent';
export type StudioSettings = {
  format: ExportFormat; quality: Quality; background: Background;
  loopSeconds: number; margin: Margin; exposure: number; autoRotate: boolean;
};
export const qualitySettings = {
  draft: { size: 480, frames: 48, label: 'Clean' },
  standard: { size: 640, frames: 64, label: 'Detailed' },
  high: { size: 720, frames: 96, label: 'Maximum' },
} as const;
export const margins = { tight: .025, balanced: .06, roomy: .12 } as const;
export const defaults: StudioSettings = {
  format: 'gif', quality: 'standard', background: '#ffffff', loopSeconds: 4,
  margin: 'balanced', exposure: 1.15, autoRotate: true,
};
export const backgrounds = [
  { value: '#ffffff', label: 'Pure white' },
  { value: '#000000', label: 'Pure black' },
  { value: 'transparent', label: 'No background' },
] as const;

export function parseSettings(value: unknown): StudioSettings | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  if (!['gif', 'webp'].includes(String(s.format)) ||
      !Object.hasOwn(qualitySettings, String(s.quality)) ||
      !backgrounds.some((b) => b.value === s.background) ||
      !Object.hasOwn(margins, String(s.margin)) ||
      typeof s.loopSeconds !== 'number' || !Number.isFinite(s.loopSeconds) || s.loopSeconds < 2 || s.loopSeconds > 12 ||
      typeof s.exposure !== 'number' || !Number.isFinite(s.exposure) || s.exposure < .5 || s.exposure > 2 ||
      typeof s.autoRotate !== 'boolean') return null;
  return { format: s.format as ExportFormat, quality: s.quality as Quality,
    background: s.background as Background, margin: s.margin as Margin,
    loopSeconds: Math.round(s.loopSeconds * 2) / 2, exposure: s.exposure, autoRotate: s.autoRotate };
}

// GIF delays use centiseconds. Round cumulative timestamps rather than every
// delay independently, so all quality presets keep the requested loop length.
export function frameTimeline(settings: StudioSettings) {
  const count = qualitySettings[settings.quality].frames;
  const tick = settings.format === 'gif' ? 10 : 1;
  const total = Math.round(settings.loopSeconds * 1000 / tick);
  return Array.from({ length: count }, (_, i) => {
    const start = Math.round(i * total / count);
    const end = Math.round((i + 1) * total / count);
    return { delay: (end - start) * tick, angle: start / total * Math.PI * 2 };
  });
}
