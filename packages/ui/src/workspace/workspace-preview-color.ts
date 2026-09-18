export type WorkspacePreviewColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type WorkspacePreviewRgbColor = Omit<WorkspacePreviewColor, "a">;

export const TRANSPARENT_PREVIEW_COLOR: WorkspacePreviewColor = { r: 0, g: 0, b: 0, a: 0 };

export const COMMON_PREVIEW_COLORS: readonly WorkspacePreviewColor[] = [
  { r: 0, g: 0, b: 0, a: 255 },
  { r: 255, g: 255, b: 255, a: 255 },
  { r: 239, g: 68, b: 68, a: 255 },
  { r: 249, g: 115, b: 22, a: 255 },
  { r: 234, g: 179, b: 8, a: 255 },
  { r: 34, g: 197, b: 94, a: 255 },
  { r: 20, g: 184, b: 166, a: 255 },
  { r: 59, g: 130, b: 246, a: 255 },
  { r: 99, g: 102, b: 241, a: 255 },
  { r: 168, g: 85, b: 247, a: 255 },
  { r: 236, g: 72, b: 153, a: 255 },
  { r: 107, g: 114, b: 128, a: 255 },
];

export function clampPreviewColorChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
}

export function normalizePreviewColor(color: WorkspacePreviewColor): WorkspacePreviewColor {
  return {
    r: clampPreviewColorChannel(color.r),
    g: clampPreviewColorChannel(color.g),
    b: clampPreviewColorChannel(color.b),
    a: clampPreviewColorChannel(color.a),
  };
}

export function previewColorKey(color: WorkspacePreviewColor) {
  const normalized = normalizePreviewColor(color);
  return `${normalized.r},${normalized.g},${normalized.b},${normalized.a}`;
}

export function previewColorToCss(color: WorkspacePreviewColor) {
  const normalized = normalizePreviewColor(color);
  return `rgba(${normalized.r}, ${normalized.g}, ${normalized.b}, ${normalized.a / 255})`;
}

export function previewColorToHex(color: WorkspacePreviewColor) {
  const normalized = normalizePreviewColor(color);
  return `#${[normalized.r, normalized.g, normalized.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function previewColorFromHex(value: string): WorkspacePreviewColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: 255,
  };
}
