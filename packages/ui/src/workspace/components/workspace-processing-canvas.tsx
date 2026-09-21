import React from "react";
import { FiLock, FiUnlock, FiZoomIn, FiZoomOut } from "react-icons/fi";
import { TbAngle, TbSkewX, TbSkewY } from "react-icons/tb";
import { getLang, getWorkspaceLabels } from "../../locales";
import { readWorkspaceImagePreview, readWorkspaceImageSource } from "../repository";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";
import { WorkspaceImageMedia } from "./workspace-image-media";
import type { WorkspacePreviewCursor } from "./workspace-preview-sidebar";
import type { WorkspacePreviewSelectionMode } from "./workspace-image-action-menu";
import { selectionFromDrag, smartSelection, type WorkspacePreviewAnchor, type WorkspacePreviewSelection } from "../workspace-preview-selection";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

type SelectionHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type SelectionInteraction = {
  pointerId: number;
  kind: "move" | "resize";
  start: { x: number; y: number };
  selection: WorkspacePreviewSelection;
  handle?: SelectionHandle;
};
type SelectionDragInfo = {
  left: number;
  top: number;
  width: number;
  height: number;
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

const selectionAnchorOrder: WorkspacePreviewAnchor[] = ["nw", "n", "ne", "w", "center", "e", "sw", "s", "se"];

function translateSelection(selection: WorkspacePreviewSelection, x: number, y: number) {
  const dx = x - selection.x;
  const dy = y - selection.y;
  return {
    ...selection,
    x,
    y,
    points: selection.points?.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  };
}

function resizeSelectionFromAnchor(selection: WorkspacePreviewSelection, width: number, height: number) {
  const anchor = selectionAnchorCoordinates[selection.anchor || "center"];
  const anchorX = selection.x + selection.width * anchor.x;
  const anchorY = selection.y + selection.height * anchor.y;
  const nextWidth = Math.max(0.002, Math.min(1, width));
  const nextHeight = Math.max(0.002, Math.min(1, height));
  const nextX = Math.max(0, Math.min(1 - nextWidth, anchorX - nextWidth * anchor.x));
  const nextY = Math.max(0, Math.min(1 - nextHeight, anchorY - nextHeight * anchor.y));
  return {
    ...selection,
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
    points: selection.points?.map((point) => ({
      x: nextX + ((point.x - selection.x) / Math.max(selection.width, Number.EPSILON)) * nextWidth,
      y: nextY + ((point.y - selection.y) / Math.max(selection.height, Number.EPSILON)) * nextHeight,
    })),
  };
}

type SelectionGeometry = { width: number; height: number };

function transformSelectionLocalPoint(x: number, y: number, selection: WorkspacePreviewSelection, geometry: SelectionGeometry = { width: 1, height: 1 }) {
  const anchor = selectionAnchorCoordinates[selection.anchor || "center"];
  let localX = (x - anchor.x) * geometry.width;
  let localY = (y - anchor.y) * geometry.height;
  const skewX = Math.tan((selection.skewX || 0) * Math.PI / 180);
  const skewY = Math.tan((selection.skewY || 0) * Math.PI / 180);
  const skewedX = localX + skewX * localY;
  const skewedY = localY + skewY * localX;
  const radians = (selection.rotation || 0) * Math.PI / 180;
  localX = skewedX * Math.cos(radians) - skewedY * Math.sin(radians);
  localY = skewedX * Math.sin(radians) + skewedY * Math.cos(radians);
  return { x: anchor.x + localX / Math.max(geometry.width, Number.EPSILON), y: anchor.y + localY / Math.max(geometry.height, Number.EPSILON) };
}

function inverseSelectionLocalPoint(x: number, y: number, selection: WorkspacePreviewSelection, geometry: SelectionGeometry = { width: 1, height: 1 }) {
  const anchor = selectionAnchorCoordinates[selection.anchor || "center"];
  let localX = (x - anchor.x) * geometry.width;
  let localY = (y - anchor.y) * geometry.height;
  const radians = -(selection.rotation || 0) * Math.PI / 180;
  const rotatedX = localX * Math.cos(radians) - localY * Math.sin(radians);
  const rotatedY = localX * Math.sin(radians) + localY * Math.cos(radians);
  localX = rotatedX;
  localY = rotatedY;
  const skewX = Math.tan((selection.skewX || 0) * Math.PI / 180);
  const skewY = Math.tan((selection.skewY || 0) * Math.PI / 180);
  const determinant = 1 - skewX * skewY;
  if (Math.abs(determinant) > Number.EPSILON) {
    const unskewedX = (localX - skewX * localY) / determinant;
    const unskewedY = (localY - skewY * localX) / determinant;
    localX = unskewedX;
    localY = unskewedY;
  }
  return { x: anchor.x + localX / Math.max(geometry.width, Number.EPSILON), y: anchor.y + localY / Math.max(geometry.height, Number.EPSILON) };
}

function selectionOutlinePoints(selection: WorkspacePreviewSelection, geometry: SelectionGeometry = { width: 1, height: 1 }) {
  if (selection.shape === "ellipse") {
    return Array.from({ length: 64 }, (_, index) => {
      const angle = (index / 64) * Math.PI * 2;
      return transformSelectionLocalPoint(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5, selection, geometry);
    });
  }
  if (selection.shape === "lasso" && selection.points && selection.points.length >= 3) {
    return selection.points.map((point) => transformSelectionLocalPoint(
      (point.x - selection.x) / Math.max(selection.width, Number.EPSILON),
      (point.y - selection.y) / Math.max(selection.height, Number.EPSILON),
      selection,
      geometry,
    ));
  }
  return [
    transformSelectionLocalPoint(0, 0, selection, geometry),
    transformSelectionLocalPoint(1, 0, selection, geometry),
    transformSelectionLocalPoint(1, 1, selection, geometry),
    transformSelectionLocalPoint(0, 1, selection, geometry),
  ];
}

function fitRatioForViewport(width: number, height: number, viewport: { width: number; height: number }) {
  if (!width || !height) return 0;
  return Math.min(Math.max(0, viewport.width - 64) / width, Math.max(0, viewport.height - 64) / height, 1);
}

function SelectionTransformField({ label, icon, value, suffix, units, onUnitChange, onCommit }: { label: string; icon?: React.ReactNode; value: number; suffix: string; units?: readonly string[]; onUnitChange?(unit: string): void; onCommit(value: number): void }) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) {
      setDraft(String(next));
      onCommit(next);
    }
    else setDraft(String(value));
  };
  const adjustWithArrow = (direction: 1 | -1) => {
    const current = Number(draft);
    const next = (Number.isFinite(current) ? current : value) + direction;
    setDraft(String(next));
    onCommit(next);
  };
  return <label className="flex h-8 items-center gap-1 rounded bg-[#202124] px-1.5 text-[11px] text-slate-300">
    <span className="flex shrink-0 items-center gap-0.5 font-semibold" title={label}>{icon || `${label}:`}</span>
    <input type="text" name={`workspace-selection-${label.toLowerCase()}`} autoComplete="off" spellCheck={false} inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); adjustWithArrow(event.key === "ArrowUp" ? 1 : -1); } else if (event.key === "Enter") { event.preventDefault(); commit(); } }} onBlur={() => setDraft(String(value))} className="w-[3.5rem] min-w-0 bg-transparent text-[13px] tabular-nums text-white outline-none" />
    {units ? <select name={`workspace-selection-${label.toLowerCase()}-unit`} autoComplete="off" value={suffix} onChange={(event) => onUnitChange?.(event.target.value)} className="shrink-0 appearance-none bg-transparent pr-0.5 text-[11px] text-slate-400 outline-none" aria-label={`${label} unit`}>{units.map((unit) => <option key={unit} value={unit} className="bg-[#202124] text-white">{unit}</option>)}</select> : <span className="shrink-0 text-slate-400">{suffix}</span>}
  </label>;
}

function SelectionTransformToolbar({ selection, imageWidth, imageHeight, onChange }: { selection: WorkspacePreviewSelection; imageWidth: number; imageHeight: number; onChange(selection: WorkspacePreviewSelection): void }) {
  const [locked, setLocked] = React.useState(selection.aspectLocked ?? true);
  const [dimensionUnit, setDimensionUnit] = React.useState<"px" | "%">("px");
  React.useEffect(() => setLocked(selection.aspectLocked ?? true), [selection]);
  const anchor = selection.anchor || "center";
  const anchorCoordinate = selectionAnchorCoordinates[anchor];
  const anchorX = Math.round((selection.x + selection.width * anchorCoordinate.x) * imageWidth);
  const anchorY = Math.round((selection.y + selection.height * anchorCoordinate.y) * imageHeight);
  const baseWidth = selection.transformBaseWidth || selection.width;
  const baseHeight = selection.transformBaseHeight || selection.height;
  const widthValue = dimensionUnit === "px" ? Math.max(1, Math.round(selection.width * imageWidth)) : Number((selection.width / Math.max(baseWidth, Number.EPSILON) * 100).toFixed(1));
  const heightValue = dimensionUnit === "px" ? Math.max(1, Math.round(selection.height * imageHeight)) : Number((selection.height / Math.max(baseHeight, Number.EPSILON) * 100).toFixed(1));

  const setAnchorPosition = (axis: "x" | "y", value: number) => {
    const normalized = value / (axis === "x" ? imageWidth : imageHeight);
    const next = axis === "x"
      ? Math.max(0, Math.min(1 - selection.width, normalized - selection.width * anchorCoordinate.x))
      : Math.max(0, Math.min(1 - selection.height, normalized - selection.height * anchorCoordinate.y));
    onChange(axis === "x" ? translateSelection(selection, next, selection.y) : translateSelection(selection, selection.x, next));
  };

  const setWidthPercent = (value: number) => {
    const nextWidth = dimensionUnit === "px" ? value / Math.max(imageWidth, 1) : baseWidth * value / 100;
    const ratio = selection.height / Math.max(selection.width, Number.EPSILON);
    onChange(resizeSelectionFromAnchor({ ...selection, transformBaseWidth: baseWidth, transformBaseHeight: baseHeight }, nextWidth, locked ? nextWidth * ratio : selection.height));
  };

  const setHeightPercent = (value: number) => {
    const nextHeight = dimensionUnit === "px" ? value / Math.max(imageHeight, 1) : baseHeight * value / 100;
    const ratio = selection.width / Math.max(selection.height, Number.EPSILON);
    onChange(resizeSelectionFromAnchor({ ...selection, transformBaseWidth: baseWidth, transformBaseHeight: baseHeight }, locked ? nextHeight * ratio : selection.width, nextHeight));
  };

  return <div className="absolute left-1/2 top-2 z-40 flex max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-md bg-[#303236]/95 px-1.5 py-1.5 text-white shadow-xl backdrop-blur" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
    <div className="grid h-8 w-8 shrink-0 grid-cols-3 overflow-hidden rounded border border-slate-500 bg-[#202124]" title="Anchor point" role="group" aria-label="Anchor point">
      {selectionAnchorOrder.map((item) => <button type="button" key={item} onClick={() => onChange({ ...selection, anchor: item })} className={`flex items-center justify-center border-[0.5px] border-slate-600 ${item === anchor ? "bg-blue-600/70" : "hover:bg-[#45474d]"}`} title={item} aria-label={item} aria-pressed={item === anchor}><span className={`h-1.5 w-1.5 rounded-full ${item === anchor ? "bg-white" : "bg-slate-500"}`} /></button>)}
    </div>
    <SelectionTransformField label="X" value={anchorX} suffix="px" onCommit={(value) => setAnchorPosition("x", value)} />
    <SelectionTransformField label="Y" value={anchorY} suffix="px" onCommit={(value) => setAnchorPosition("y", value)} />
    <SelectionTransformField label="W" value={widthValue} suffix={dimensionUnit} units={["px", "%"]} onUnitChange={(unit) => setDimensionUnit(unit as "px" | "%")} onCommit={setWidthPercent} />
    <button type="button" onClick={() => { const next = !locked; setLocked(next); onChange({ ...selection, aspectLocked: next }); }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${locked ? "bg-[#4a4c52] text-white" : "bg-[#202124] text-slate-500 hover:text-white"}`} title={locked ? "Unlock aspect ratio" : "Lock aspect ratio"} aria-label={locked ? "Unlock aspect ratio" : "Lock aspect ratio"} aria-pressed={locked}>{locked ? <FiLock /> : <FiUnlock />}</button>
    <SelectionTransformField label="H" value={heightValue} suffix={dimensionUnit} units={["px", "%"]} onUnitChange={(unit) => setDimensionUnit(unit as "px" | "%")} onCommit={setHeightPercent} />
    <SelectionTransformField label="Angle" icon={<TbAngle aria-hidden="true" />} value={selection.rotation || 0} suffix="°" onCommit={(value) => onChange({ ...selection, rotation: value })} />
    <SelectionTransformField label="Horizontal skew" icon={<TbSkewX aria-hidden="true" />} value={selection.skewX || 0} suffix="°" onCommit={(value) => onChange({ ...selection, skewX: value })} />
    <SelectionTransformField label="Vertical skew" icon={<TbSkewY aria-hidden="true" />} value={selection.skewY || 0} suffix="°" onCommit={(value) => onChange({ ...selection, skewY: value })} />
  </div>;
}

export function WorkspaceProcessingCanvas({ image, role, renderedBlob, decodedSource, decodedRevision = 0, previewRotation = 0, onCursorChange, activeTool, selectionMode = "rectangle", selection, onSelectionChange }: { image: WorkspaceImage; role: WorkspaceIdentity["role"]; renderedBlob?: Blob; decodedSource?: HTMLCanvasElement; decodedRevision?: number; previewRotation?: number; onCursorChange?(cursor: WorkspacePreviewCursor | null): void; activeTool?: "select" | "pan"; selectionMode?: WorkspacePreviewSelectionMode; selection?: WorkspacePreviewSelection | null; onSelectionChange?(selection: WorkspacePreviewSelection | null): void }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>());
  const panRef = React.useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const pinchRef = React.useRef<{
    distance: number;
    centerX: number;
    centerY: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [cachedBlob, setCachedBlob] = React.useState<Blob>();
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 });
  const imageSizeRef = React.useRef({ width: 0, height: 0 });
  const decodedImageIdRef = React.useRef<string | null>(null);
  const decodedSurfaceRef = React.useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const selectionDragRef = React.useRef<Array<{ x: number; y: number }> | null>(null);
  const selectionDragLiveRef = React.useRef<WorkspacePreviewSelection | null>(null);
  const selectionInteractionRef = React.useRef<SelectionInteraction | null>(null);
  const [selectionInteractionKind, setSelectionInteractionKind] = React.useState<SelectionInteraction["kind"] | null>(null);
  const [selectionDragInfo, setSelectionDragInfo] = React.useState<SelectionDragInfo | null>(null);
  const zoomRef = React.useRef(zoom);
  const offsetRef = React.useRef(offset);
  const displayBlob = renderedBlob || cachedBlob;
  const displayUrl = useBlobUrl(displayBlob);

  React.useEffect(() => {
    let active = true;
    setCachedBlob(undefined);
    if (renderedBlob || decodedSource) return () => { active = false; };
    void (async () => {
      const blob = image.sourceCached ? await readWorkspaceImageSource(image) : image.previewCached ? await readWorkspaceImagePreview(image) : null;
      if (active && blob) setCachedBlob(blob);
    })();
    return () => { active = false; };
  }, [decodedSource, image.imageId, image.previewCached, image.previewRevision, image.sourceCached, renderedBlob]);

  React.useLayoutEffect(() => {
    if (!decodedSource) return;
    const nextSize = { width: decodedSource.width, height: decodedSource.height };
    const sameImage = decodedImageIdRef.current === image.imageId;
    const surfaceChanged = decodedSurfaceRef.current !== decodedSource;
    const previousSize = sameImage ? imageSizeRef.current : { width: 0, height: 0 };
    const previousFit = fitRatioForViewport(previousSize.width, previousSize.height, viewport);
    const nextFit = fitRatioForViewport(nextSize.width, nextSize.height, viewport);
    if (surfaceChanged && previousFit && nextFit && (previousSize.width !== nextSize.width || previousSize.height !== nextSize.height)) {
      // Keep the same image-pixel scale when a direct operation changes the
      // canvas dimensions (90-degree rotation is the common case). Applying
      // this in a layout effect prevents the intermediate fit-to-viewport
      // frame that made each rotation look like an extra zoom-out.
      const currentZoom = zoomRef.current;
      const displayedScale = previousFit * currentZoom;
      const scaleCompensation = displayedScale / nextFit;
      const nextMaxZoom = Math.max(8, (1 / nextFit) * 4);
      const nextZoom = Math.min(nextMaxZoom, Math.max(0.25, scaleCompensation));
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      const offsetScale = nextZoom / Math.max(currentZoom, Number.EPSILON);
      const nextOffset = { x: offsetRef.current.x * offsetScale, y: offsetRef.current.y * offsetScale };
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
    }
    decodedImageIdRef.current = image.imageId;
    decodedSurfaceRef.current = decodedSource;
    imageSizeRef.current = nextSize;
    setImageSize(nextSize);
  }, [decodedRevision, decodedSource, viewport]);

  React.useEffect(() => {
    if (!selection) {
      selectionDragRef.current = null;
      selectionDragLiveRef.current = null;
      selectionInteractionRef.current = null;
      setSelectionInteractionKind(null);
      setSelectionDragInfo(null);
    }
  }, [selection]);

  React.useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  React.useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);
  React.useEffect(() => {
    zoomRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [image.imageId]);
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setViewport((current) => { const next = { width: host.clientWidth, height: host.clientHeight }; return current.width === next.width && current.height === next.height ? current : next; });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const fitRatio = fitRatioForViewport(imageSize.width, imageSize.height, viewport);
  const surfaceSize = { width: imageSize.width * fitRatio, height: imageSize.height * fitRatio };
  const nativeZoom = fitRatio ? 1 / fitRatio : 1;
  const maxZoom = Math.max(8, nativeZoom * 4);
  const actualScalePercent = Math.round((fitRatio || 1) * zoom * 100);

  const updateView = (nextZoom: number, nextOffset: { x: number; y: number }) => {
    zoomRef.current = nextZoom;
    offsetRef.current = nextOffset;
    setZoom(nextZoom);
    setOffset(nextOffset);
  };
  const resetView = () => updateView(1, { x: 0, y: 0 });
  const scaleAround = (requestedZoom: number, clientX?: number, clientY?: number) => {
    const host = hostRef.current;
    const currentZoom = zoomRef.current;
    const nextZoom = Math.min(maxZoom, Math.max(0.25, requestedZoom));
    if (!host || nextZoom === currentZoom) return;
    const rect = host.getBoundingClientRect();
    const focalX = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
    const focalY = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
    const ratio = nextZoom / currentZoom;
    updateView(nextZoom, {
      x: focalX - (focalX - offsetRef.current.x) * ratio,
      y: focalY - (focalY - offsetRef.current.y) * ratio,
    });
  };
  const beginPinch = () => {
    const points = [...pointersRef.current.values()];
    const host = hostRef.current;
    if (points.length < 2 || !host) return;
    const [first, second] = points;
    const rect = host.getBoundingClientRect();
    pinchRef.current = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      centerX: (first.x + second.x) / 2 - rect.left - rect.width / 2,
      centerY: (first.y + second.y) / 2 - rect.top - rect.height / 2,
      zoom: zoomRef.current,
      offsetX: offsetRef.current.x,
      offsetY: offsetRef.current.y,
    };
    panRef.current = null;
  };
  const releasePointer = (element: HTMLDivElement, pointerId: number) => {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    pointersRef.current.delete(pointerId);
    pinchRef.current = null;
    const remaining = [...pointersRef.current.entries()];
    if (remaining.length === 1) {
      const [id, point] = remaining[0];
      panRef.current = { pointerId: id, x: point.x, y: point.y, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y };
    } else {
      panRef.current = null;
    }
  };

  const samplePixelAt = (clientX: number, clientY: number): WorkspacePreviewCursor | null => {
    if (!decodedSource || !fitRatio || !imageSize.width || !imageSize.height) return null;
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const xFromCenter = clientX - rect.left - rect.width / 2 - offsetRef.current.x;
    const yFromCenter = clientY - rect.top - rect.height / 2 - offsetRef.current.y;
    const imageX = xFromCenter / zoomRef.current + surfaceSize.width / 2;
    const imageY = yFromCenter / zoomRef.current + surfaceSize.height / 2;
    if (imageX < 0 || imageY < 0 || imageX >= surfaceSize.width || imageY >= surfaceSize.height) return null;
    const x = Math.max(0, Math.min(imageSize.width - 1, Math.floor(imageX / fitRatio)));
    const y = Math.max(0, Math.min(imageSize.height - 1, Math.floor(imageY / fitRatio)));
    const context = decodedSource.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    const pixel = context.getImageData(x, y, 1, 1).data;
    const rgba: [number, number, number, number] = [pixel[0], pixel[1], pixel[2], pixel[3]];
    const hex = `#${rgba.slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    return { x, y, rgba, hex };
  };

  const updateCursor = (clientX: number, clientY: number) => {
    if (!onCursorChange) return;
    onCursorChange(samplePixelAt(clientX, clientY));
  };

  const normalizedPoint = (clientX: number, clientY: number, clamp = false) => {
    const host = hostRef.current;
    if (!host || !fitRatio || !surfaceSize.width || !surfaceSize.height) return null;
    const rect = host.getBoundingClientRect();
    const imageX = (clientX - rect.left - rect.width / 2 - offsetRef.current.x) / zoomRef.current + surfaceSize.width / 2;
    const imageY = (clientY - rect.top - rect.height / 2 - offsetRef.current.y) / zoomRef.current + surfaceSize.height / 2;
    if (!clamp && (imageX < 0 || imageY < 0 || imageX > surfaceSize.width || imageY > surfaceSize.height)) return null;
    return { x: Math.max(0, Math.min(1, imageX / surfaceSize.width)), y: Math.max(0, Math.min(1, imageY / surfaceSize.height)) };
  };

  const selectionStyle = selection ? {
    left: `${selection.x * surfaceSize.width}px`,
    top: `${selection.y * surfaceSize.height}px`,
    width: `${selection.width * surfaceSize.width}px`,
    height: `${selection.height * surfaceSize.height}px`,
  } : undefined;

  const selectionPixelSize = (current: WorkspacePreviewSelection) => ({
    width: Math.max(1, Math.round(current.width * imageSize.width)),
    height: Math.max(1, Math.round(current.height * imageSize.height)),
  });

  const updateSelectionDragInfo = (event: React.PointerEvent, current: WorkspacePreviewSelection | null) => {
    const host = hostRef.current;
    if (!host || !current || !imageSize.width || !imageSize.height) {
      setSelectionDragInfo(null);
      return;
    }
    const rect = host.getBoundingClientRect();
    const size = selectionPixelSize(current);
    const tooltipWidth = 132;
    const tooltipHeight = 54;
    setSelectionDragInfo({
      left: Math.max(8, Math.min(rect.width - tooltipWidth - 8, event.clientX - rect.left + 14)),
      top: Math.max(8, Math.min(rect.height - tooltipHeight - 8, event.clientY - rect.top + 14)),
      ...size,
    });
  };

  const clampSelection = (next: WorkspacePreviewSelection) => ({
    ...next,
    x: Math.max(0, Math.min(1 - next.width, next.x)),
    y: Math.max(0, Math.min(1 - next.height, next.y)),
  });

  const transformSelectionPoints = (source: WorkspacePreviewSelection, next: WorkspacePreviewSelection) => {
    if (!source.points?.length || source.width <= 0 || source.height <= 0) return next;
    return {
      ...next,
      points: source.points.map((point) => ({
        x: next.x + ((point.x - source.x) / source.width) * next.width,
        y: next.y + ((point.y - source.y) / source.height) * next.height,
      })),
    };
  };

  const selectionContains = (point: { x: number; y: number }, current: WorkspacePreviewSelection) => {
    const geometry = { width: current.width * surfaceSize.width, height: current.height * surfaceSize.height };
    const local = inverseSelectionLocalPoint(
      (point.x - current.x) / Math.max(current.width, Number.EPSILON),
      (point.y - current.y) / Math.max(current.height, Number.EPSILON),
      current,
      geometry,
    );
    if (local.x < 0 || local.x > 1 || local.y < 0 || local.y > 1) return false;
    if (current.shape === "ellipse") {
      const x = local.x * 2 - 1;
      const y = local.y * 2 - 1;
      return x * x + y * y <= 1;
    }
    if (current.shape === "lasso" && current.points && current.points.length >= 3) {
      const polygon = current.points.map((entry) => ({
        x: (entry.x - current.x) / Math.max(current.width, Number.EPSILON),
        y: (entry.y - current.y) / Math.max(current.height, Number.EPSILON),
      }));
      let inside = false;
      for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
        const pointA = polygon[index];
        const pointB = polygon[previous];
        const intersects = (pointA.y > local.y) !== (pointB.y > local.y)
          && local.x < ((pointB.x - pointA.x) * (local.y - pointA.y)) / (pointB.y - pointA.y || Number.EPSILON) + pointA.x;
        if (intersects) inside = !inside;
      }
      return inside;
    }
    return true;
  };

  const beginSelectionInteraction = (event: React.PointerEvent, kind: "move" | "resize", handle?: SelectionHandle) => {
    if (!selection || activeTool !== "select") return;
    const point = normalizedPoint(event.clientX, event.clientY, true);
    const host = hostRef.current;
    if (!point || !host) return;
    event.preventDefault();
    event.stopPropagation();
    host.setPointerCapture(event.pointerId);
    selectionInteractionRef.current = { pointerId: event.pointerId, kind, handle, start: point, selection };
    setSelectionInteractionKind(kind);
    if (kind === "resize") updateSelectionDragInfo(event, selection);
    else setSelectionDragInfo(null);
  };

  const resizeSelection = (interaction: SelectionInteraction, point: { x: number; y: number }) => {
    const source = interaction.selection;
    const handle = interaction.handle;
    if (!handle) return source;
    const minimum = 0.002;
    const geometry = {
      width: Math.max(Number.EPSILON, source.width * surfaceSize.width),
      height: Math.max(Number.EPSILON, source.height * surfaceSize.height),
    };
    const local = inverseSelectionLocalPoint(
      (point.x - source.x) / Math.max(source.width, Number.EPSILON),
      (point.y - source.y) / Math.max(source.height, Number.EPSILON),
      source,
      geometry,
    );
    const localPixel = {
      x: local.x * geometry.width,
      y: local.y * geometry.height,
    };
    const handlePosition = handleLocalPositions[handle];
    const fixedLocal = {
      x: handlePosition.x === 0 ? 1 : handlePosition.x === 1 ? 0 : 0.5,
      y: handlePosition.y === 0 ? 1 : handlePosition.y === 1 ? 0 : 0.5,
    };
    const widthPixels = handlePosition.x === 0
      ? fixedLocal.x * geometry.width - localPixel.x
      : handlePosition.x === 1
        ? localPixel.x - fixedLocal.x * geometry.width
        : geometry.width;
    const heightPixels = handlePosition.y === 0
      ? fixedLocal.y * geometry.height - localPixel.y
      : handlePosition.y === 1
        ? localPixel.y - fixedLocal.y * geometry.height
        : geometry.height;
    let targetWidthPixels = Math.max(minimum * surfaceSize.width, Number.isFinite(widthPixels) ? widthPixels : geometry.width);
    let targetHeightPixels = Math.max(minimum * surfaceSize.height, Number.isFinite(heightPixels) ? heightPixels : geometry.height);
    if (source.aspectLocked !== false) {
      const aspectRatio = geometry.width / Math.max(geometry.height, Number.EPSILON);
      const horizontalHandle = handlePosition.x !== 0.5;
      const verticalHandle = handlePosition.y !== 0.5;
      if (horizontalHandle && !verticalHandle) {
        targetHeightPixels = targetWidthPixels / Math.max(aspectRatio, Number.EPSILON);
      } else if (!horizontalHandle && verticalHandle) {
        targetWidthPixels = targetHeightPixels * aspectRatio;
      } else {
        const widthDelta = Math.abs(targetWidthPixels - geometry.width);
        const heightDelta = Math.abs(targetHeightPixels - geometry.height);
        if (widthDelta >= heightDelta * aspectRatio) targetHeightPixels = targetWidthPixels / Math.max(aspectRatio, Number.EPSILON);
        else targetWidthPixels = targetHeightPixels * aspectRatio;
      }
      if (targetWidthPixels > surfaceSize.width) {
        targetWidthPixels = surfaceSize.width;
        targetHeightPixels = targetWidthPixels / Math.max(aspectRatio, Number.EPSILON);
      }
      if (targetHeightPixels > surfaceSize.height) {
        targetHeightPixels = surfaceSize.height;
        targetWidthPixels = targetHeightPixels * aspectRatio;
      }
    }
    const nextWidth = Math.max(minimum, Math.min(1, targetWidthPixels / Math.max(surfaceSize.width, Number.EPSILON)));
    const nextHeight = Math.max(minimum, Math.min(1, targetHeightPixels / Math.max(surfaceSize.height, Number.EPSILON)));
    const fixedWorld = {
      x: source.x * surfaceSize.width + transformSelectionLocalPoint(fixedLocal.x, fixedLocal.y, source, geometry).x * geometry.width,
      y: source.y * surfaceSize.height + transformSelectionLocalPoint(fixedLocal.x, fixedLocal.y, source, geometry).y * geometry.height,
    };
    const nextGeometry = { width: nextWidth * surfaceSize.width, height: nextHeight * surfaceSize.height };
    const nextLocalFixed = transformSelectionLocalPoint(fixedLocal.x, fixedLocal.y, source, nextGeometry);
    const next = {
      ...source,
      x: (fixedWorld.x - nextLocalFixed.x * nextGeometry.width) / Math.max(surfaceSize.width, Number.EPSILON),
      y: (fixedWorld.y - nextLocalFixed.y * nextGeometry.height) / Math.max(surfaceSize.height, Number.EPSILON),
      width: nextWidth,
      height: nextHeight,
    };
    return transformSelectionPoints(source, clampSelection(next));
  };

  const moveSelection = (interaction: SelectionInteraction, point: { x: number; y: number }) => {
    const dx = point.x - interaction.start.x;
    const dy = point.y - interaction.start.y;
    const next = clampSelection({
      ...interaction.selection,
      x: interaction.selection.x + dx,
      y: interaction.selection.y + dy,
    });
    if (!interaction.selection.points?.length) return next;
    const appliedDx = next.x - interaction.selection.x;
    const appliedDy = next.y - interaction.selection.y;
    return {
      ...next,
      points: interaction.selection.points.map((entry) => ({ x: entry.x + appliedDx, y: entry.y + appliedDy })),
    };
  };

  const handleCursorClasses: Record<SelectionHandle, string> = {
    nw: "cursor-nwse-resize",
    n: "cursor-row-resize",
    ne: "cursor-nesw-resize",
    e: "cursor-col-resize",
    se: "cursor-nwse-resize",
    s: "cursor-row-resize",
    sw: "cursor-nesw-resize",
    w: "cursor-col-resize",
  };
  const handleLocalPositions: Record<SelectionHandle, { x: number; y: number }> = {
    nw: { x: 0, y: 0 },
    n: { x: 0.5, y: 0 },
    ne: { x: 1, y: 0 },
    e: { x: 1, y: 0.5 },
    se: { x: 1, y: 1 },
    s: { x: 0.5, y: 1 },
    sw: { x: 0, y: 1 },
    w: { x: 0, y: 0.5 },
  };
  const selectionHandles: SelectionHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  return <div
    ref={hostRef}
    className={`relative h-full w-full touch-none overflow-hidden bg-[#dfe5ec] [background-image:linear-gradient(45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(-45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(255,255,255,.28)_75%),linear-gradient(-45deg,transparent_75%,rgba(255,255,255,.28)_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px] ${activeTool === "select" ? selectionInteractionKind === "move" ? "cursor-grabbing" : "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
    onWheel={(event) => { event.preventDefault(); const delta = Math.max(-80, Math.min(80, event.deltaY)); scaleAround(zoomRef.current * Math.exp(-delta * 0.0025), event.clientX, event.clientY); }}
    onDoubleClick={resetView}
    onPointerLeave={() => onCursorChange?.(null)}
    onPointerDown={(event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const point = normalizedPoint(event.clientX, event.clientY);
      if (activeTool === "select") {
        if (!point) {
          onSelectionChange?.(null);
          return;
        }
        if (selection && selectionContains(point, selection)) return;
        if (selection) onSelectionChange?.(null);
        if (selectionMode === "smart") {
          try {
            const next = smartSelection(decodedSource!, point.x, point.y);
            onSelectionChange?.({ ...next, transformBaseWidth: next.width, transformBaseHeight: next.height });
          } catch { onSelectionChange?.(null); }
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        selectionDragLiveRef.current = null;
        selectionDragRef.current = [point];
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointersRef.current.size >= 2) beginPinch();
      else panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y };
    }}
    onPointerMove={(event) => {
      updateCursor(event.clientX, event.clientY);
      const interaction = selectionInteractionRef.current;
      if (interaction?.pointerId === event.pointerId) {
        const point = normalizedPoint(event.clientX, event.clientY, true);
        if (point) {
          const next = interaction.kind === "move" ? moveSelection(interaction, point) : resizeSelection(interaction, point);
          onSelectionChange?.(next);
          if (interaction.kind === "resize") updateSelectionDragInfo(event, next);
          else setSelectionDragInfo(null);
        }
        return;
      }
      if (selectionDragRef.current) {
        const point = normalizedPoint(event.clientX, event.clientY);
        if (point) {
          const next = [...selectionDragRef.current, point];
          selectionDragRef.current = next;
          const rawSelection = selectionFromDrag(selectionMode === "ellipse" || selectionMode === "lasso" ? selectionMode : "rectangle", next);
          const nextSelection = rawSelection;
          selectionDragLiveRef.current = nextSelection;
          onSelectionChange?.(nextSelection);
          updateSelectionDragInfo(event, nextSelection);
        }
        return;
      }
      if (!pointersRef.current.has(event.pointerId)) return;
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const host = hostRef.current;
        if (!host) return;
        const [first, second] = [...pointersRef.current.values()];
        const rect = host.getBoundingClientRect();
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        const centerX = (first.x + second.x) / 2 - rect.left - rect.width / 2;
        const centerY = (first.y + second.y) / 2 - rect.top - rect.height / 2;
        const nextZoom = Math.min(maxZoom, Math.max(0.25, pinch.zoom * distance / Math.max(1, pinch.distance)));
        const scale = nextZoom / pinch.zoom;
        updateView(nextZoom, { x: centerX - (pinch.centerX - pinch.offsetX) * scale, y: centerY - (pinch.centerY - pinch.offsetY) * scale });
        return;
      }
      const pan = panRef.current;
      if (pan?.pointerId === event.pointerId) updateView(zoomRef.current, { x: pan.offsetX + event.clientX - pan.x, y: pan.offsetY + event.clientY - pan.y });
    }}
    onPointerUp={(event) => {
      if (selectionDragLiveRef.current) {
        const finalSelection = selectionDragLiveRef.current;
        onSelectionChange?.({ ...finalSelection, transformBaseWidth: finalSelection.width, transformBaseHeight: finalSelection.height });
      }
      selectionDragRef.current = null;
      selectionDragLiveRef.current = null;
      if (selectionInteractionRef.current?.pointerId === event.pointerId) {
        selectionInteractionRef.current = null;
        setSelectionInteractionKind(null);
      }
      setSelectionDragInfo(null);
      releasePointer(event.currentTarget, event.pointerId);
    }}
    onPointerCancel={(event) => {
      selectionDragRef.current = null;
      selectionDragLiveRef.current = null;
      selectionInteractionRef.current = null;
      setSelectionInteractionKind(null);
      setSelectionDragInfo(null);
      releasePointer(event.currentTarget, event.pointerId);
    }}
  >
    {selection && activeTool === "select" ? <SelectionTransformToolbar selection={selection} imageWidth={imageSize.width} imageHeight={imageSize.height} onChange={(next) => onSelectionChange?.(next)} /> : null}
    {decodedSource || displayUrl ? <div className="absolute inset-0 flex items-center justify-center will-change-transform" style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom}) rotate(${previewRotation}deg)` }}><div className={`relative ${previewRotation ? "overflow-visible" : "overflow-hidden"} bg-transparent`} style={{ width: surfaceSize.width, height: surfaceSize.height, visibility: fitRatio ? "visible" : "hidden" }}>{decodedSource ? <SharedCanvasSurface surface={decodedSource} revision={decodedRevision} pixelated={!previewRotation && zoom >= nativeZoom} /> : <img src={displayUrl} alt={image.name} draggable={false} onLoad={(event) => { const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; setImageSize((current) => current.width === next.width && current.height === next.height ? current : next); }} className="block h-full w-full select-none object-contain" style={{ imageRendering: !previewRotation && zoom >= nativeZoom ? "pixelated" : "auto" }} />}
      {selection ? <div className={`${activeTool === "select" ? "pointer-events-auto" : "pointer-events-none"} absolute cursor-grab active:cursor-grabbing`} style={selectionStyle} onPointerDown={(event) => { const point = normalizedPoint(event.clientX, event.clientY); if (!point || !selectionContains(point, selection)) { event.stopPropagation(); onSelectionChange?.(null); return; } beginSelectionInteraction(event, "move"); }}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${Math.max(1, selection.width * surfaceSize.width)} ${Math.max(1, selection.height * surfaceSize.height)}`} preserveAspectRatio="none" aria-hidden="true">
          {(() => {
            const width = Math.max(1, selection.width * surfaceSize.width);
            const height = Math.max(1, selection.height * surfaceSize.height);
            const points = selectionOutlinePoints(selection, { width, height }).map((point) => `${point.x * width},${point.y * height}`).join(" ");
            const drawOutline = (stroke: string, offset: number) => {
              const common = { fill: "none", stroke, strokeWidth: 1, strokeDasharray: "5 5", strokeDashoffset: offset };
              const animate = <animate attributeName="stroke-dashoffset" from={String(offset)} to={String(offset + 10)} dur="1.6s" repeatCount="indefinite" />;
              return <polygon key={stroke} {...common} points={points}>{animate}</polygon>;
            };
            return <g>{drawOutline("#ffffff", 5)}{drawOutline("#111827", 0)}</g>;
          })()}
        </svg>
        {selectionHandles.map((handle) => { const position = transformSelectionLocalPoint(handleLocalPositions[handle].x, handleLocalPositions[handle].y, selection, { width: selection.width * surfaceSize.width, height: selection.height * surfaceSize.height }); return <span key={handle} className={`pointer-events-auto absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 ${handleCursorClasses[handle]}`} style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }} onPointerDown={(event) => beginSelectionInteraction(event, "resize", handle)}><span className={`block h-3 w-3 rounded-full border-2 border-white bg-[#2486d8] shadow-sm ${(selection.anchor || "center") === handle ? "ring-2 ring-amber-400 ring-offset-1" : ""}`} /></span>; })}
        {(selection.anchor || "center") === "center" ? (() => { const position = transformSelectionLocalPoint(0.5, 0.5, selection, { width: selection.width * surfaceSize.width, height: selection.height * surfaceSize.height }); return <span className="pointer-events-none absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2" style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}><span className="block h-2.5 w-2.5 rounded-full border border-white bg-[#2486d8] ring-2 ring-amber-400" /></span>; })() : null}
      </div> : null}
    </div></div> : <div className="absolute inset-0"><WorkspaceImageMedia image={image} role={role} fit="contain" controls /></div>}
    {selectionDragInfo ? <div className="pointer-events-none absolute z-50 rounded-md bg-[#303030] px-2 py-1 text-[14px] font-mono leading-5 text-white shadow-lg" style={{ left: selectionDragInfo.left, top: selectionDragInfo.top }}>
      <div>{getLang() === "zh" ? "宽" : "W"}: {selectionDragInfo.width} px</div>
      <div>{getLang() === "zh" ? "高" : "H"}: {selectionDragInfo.height} px</div>
    </div> : null}
    <div className="absolute bottom-4 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1 rounded-md border border-slate-200 bg-white/95 p-1 text-slate-600 shadow-sm backdrop-blur" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}><button type="button" onClick={() => scaleAround(zoomRef.current / 1.2)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 hover:text-[#2f65cf]" title={text("zoomOut")} aria-label={text("zoomOut")}><FiZoomOut /></button><button type="button" onClick={resetView} className="flex h-7 min-w-12 items-center justify-center rounded px-1 text-[10px] font-semibold tabular-nums hover:bg-slate-100 hover:text-[#2f65cf]" title={text("fitImage")}>{actualScalePercent}%</button><button type="button" onClick={() => scaleAround(zoomRef.current * 1.2)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 hover:text-[#2f65cf]" title={text("zoomIn")} aria-label={text("zoomIn")}><FiZoomIn /></button></div>
  </div>;
}

function SharedCanvasSurface({ surface, revision, pixelated }: { surface: HTMLCanvasElement; revision: number; pixelated: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = surface.width;
    canvas.height = surface.height;
    canvas.getContext("2d")?.drawImage(surface, 0, 0);
  }, [revision, surface]);
  return <canvas ref={canvasRef} className="block h-full w-full select-none object-contain" style={{ imageRendering: pixelated ? "pixelated" : "auto" }} />;
}

function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => { if (!blob) { setUrl(""); return; } const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}
