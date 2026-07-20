import type { EmojiSvgAsset } from "./types";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function firstGrapheme(value: string) {
  const normalized = value.trim();
  if (!normalized) return "😀";
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return segmenter.segment(normalized)[Symbol.iterator]().next().value?.segment || "😀";
  }
  return Array.from(normalized)[0] || "😀";
}

export function emojiToSvg(
  value: string,
  options: { size?: number; padding?: number; background?: string } = {},
): EmojiSvgAsset {
  const emoji = firstGrapheme(value);
  const size = Math.max(16, options.size ?? 128);
  const padding = Math.max(0, options.padding ?? 8);
  const edge = size + padding * 2;
  const background = options.background
    ? `<rect width="100%" height="100%" fill="${escapeXml(options.background)}"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}">${background}<text x="50%" y="50%" dy="0.06em" text-anchor="middle" dominant-baseline="central" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif" font-size="${size}">${escapeXml(emoji)}</text></svg>`;
  return {
    emoji,
    svg,
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: edge,
    height: edge,
  };
}
