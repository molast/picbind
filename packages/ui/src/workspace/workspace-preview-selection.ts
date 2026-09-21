import type { WorkspacePreviewSelectionMode } from "./components/workspace-image-action-menu";

export type WorkspacePreviewAnchor = "nw" | "n" | "ne" | "w" | "center" | "e" | "sw" | "s" | "se";

export type WorkspacePreviewSelection = {
  shape: WorkspacePreviewSelectionMode;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor?: WorkspacePreviewAnchor;
  aspectLocked?: boolean;
  transformBaseWidth?: number;
  transformBaseHeight?: number;
  rotation?: number;
  skewX?: number;
  skewY?: number;
  points?: Array<{ x: number; y: number }>;
  mask?: Uint8Array;
};

const selectionAnchorCoordinates: Record<WorkspacePreviewAnchor, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  w: { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  e: { x: 1, y: 0.5 },
  sw: { x: 0, y: 1 },
  s: { x: 0.5, y: 1 },
  se: { x: 1, y: 1 },
};

function transformSelectionLocalPoint(x: number, y: number, selection: WorkspacePreviewSelection) {
  const anchor = selectionAnchorCoordinates[selection.anchor || "center"];
  let localX = x - anchor.x;
  let localY = y - anchor.y;
  const skewX = Math.tan((selection.skewX || 0) * Math.PI / 180);
  const skewY = Math.tan((selection.skewY || 0) * Math.PI / 180);
  const skewedX = localX + skewX * localY;
  const skewedY = localY + skewY * localX;
  const radians = (selection.rotation || 0) * Math.PI / 180;
  localX = skewedX * Math.cos(radians) - skewedY * Math.sin(radians);
  localY = skewedX * Math.sin(radians) + skewedY * Math.cos(radians);
  return { x: anchor.x + localX, y: anchor.y + localY };
}

/** Returns the current selection outline in normalized image coordinates. */
export function selectionPathPoints(selection: WorkspacePreviewSelection) {
  const localPoints = selection.shape === "ellipse"
    ? Array.from({ length: 64 }, (_, index) => {
      const angle = (index / 64) * Math.PI * 2;
      return { x: 0.5 + Math.cos(angle) * 0.5, y: 0.5 + Math.sin(angle) * 0.5 };
    })
    : selection.shape === "lasso" && selection.points && selection.points.length >= 3
      ? selection.points.map((point) => ({
        x: (point.x - selection.x) / Math.max(selection.width, Number.EPSILON),
        y: (point.y - selection.y) / Math.max(selection.height, Number.EPSILON),
      }))
      : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

  return localPoints.map((point) => {
    const transformed = transformSelectionLocalPoint(point.x, point.y, selection);
    return {
      x: selection.x + transformed.x * selection.width,
      y: selection.y + transformed.y * selection.height,
    };
  });
}

export function selectionFromDrag(shape: Exclude<WorkspacePreviewSelectionMode, "smart">, points: Array<{ x: number; y: number }>): WorkspacePreviewSelection | null {
  if (points.length < 2) return null;
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  if (right - x < 0.002 || bottom - y < 0.002) return null;
  return { shape, x, y, width: right - x, height: bottom - y, ...(shape === "lasso" ? { points } : {}) };
}

export function smartSelection(surface: HTMLCanvasElement, x: number, y: number): WorkspacePreviewSelection {
  const width = surface.width;
  const height = surface.height;
  if (width * height > 24_000_000) throw new Error("Image is too large for smart selection");
  const context = surface.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is unavailable");
  const pixels = context.getImageData(0, 0, width, height).data;
  const startX = Math.min(width - 1, Math.max(0, Math.floor(x * width)));
  const startY = Math.min(height - 1, Math.max(0, Math.floor(y * height)));
  const start = startY * width + startX;
  const target = pixels.slice(start * 4, start * 4 + 4);
  const mask = new Uint8Array(width * height);
  const seen = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let head = 0;
  let tail = 1;
  let left = startX;
  let top = startY;
  let right = startX;
  let bottom = startY;
  queue[0] = start;
  seen[start] = 1;
  const visit = (index: number) => {
    if (!seen[index]) { seen[index] = 1; queue[tail++] = index; }
  };
  while (head < tail) {
    const index = queue[head++];
    const offset = index * 4;
    const difference = Math.max(
      Math.abs(pixels[offset] - target[0]),
      Math.abs(pixels[offset + 1] - target[1]),
      Math.abs(pixels[offset + 2] - target[2]),
      Math.abs(pixels[offset + 3] - target[3]),
    );
    if (difference > 28) continue;
    mask[index] = 1;
    const px = index % width;
    const py = Math.floor(index / width);
    left = Math.min(left, px); top = Math.min(top, py);
    right = Math.max(right, px); bottom = Math.max(bottom, py);
    if (px > 0) visit(index - 1);
    if (px + 1 < width) visit(index + 1);
    if (py > 0) visit(index - width);
    if (py + 1 < height) visit(index + width);
  }
  return { shape: "smart", x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height, mask };
}
