import React from "react";
import { FiZoomIn, FiZoomOut } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import { readWorkspaceImagePreview, readWorkspaceImageSource } from "../repository";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";
import { WorkspaceImageMedia } from "./workspace-image-media";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export function WorkspaceProcessingCanvas({ image, role, renderedBlob }: { image: WorkspaceImage; role: WorkspaceIdentity["role"]; renderedBlob?: Blob }) {
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
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const zoomRef = React.useRef(zoom);
  const offsetRef = React.useRef(offset);
  const displayBlob = renderedBlob || cachedBlob;
  const displayUrl = useBlobUrl(displayBlob);

  React.useEffect(() => {
    let active = true;
    setCachedBlob(undefined);
    if (renderedBlob) return () => { active = false; };
    void (async () => {
      const blob = image.sourceCached ? await readWorkspaceImageSource(image) : image.previewCached ? await readWorkspaceImagePreview(image) : null;
      if (active && blob) setCachedBlob(blob);
    })();
    return () => { active = false; };
  }, [image.imageId, image.previewCached, image.previewRevision, image.sourceCached, renderedBlob]);

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

  const fitRatio = imageSize.width && imageSize.height ? Math.min(Math.max(0, viewport.width - 64) / imageSize.width, Math.max(0, viewport.height - 64) / imageSize.height, 1) : 0;
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

  return <div ref={hostRef} className="relative h-full w-full touch-none overflow-hidden bg-[#dfe5ec] [background-image:linear-gradient(45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(-45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(255,255,255,.28)_75%),linear-gradient(-45deg,transparent_75%,rgba(255,255,255,.28)_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px] cursor-grab active:cursor-grabbing" onWheel={(event) => { event.preventDefault(); const delta = Math.max(-80, Math.min(80, event.deltaY)); scaleAround(zoomRef.current * Math.exp(-delta * 0.0025), event.clientX, event.clientY); }} onDoubleClick={resetView} onPointerDown={(event) => { if (event.pointerType === "mouse" && event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointersRef.current.size >= 2) beginPinch(); else panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y }; }} onPointerMove={(event) => {
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
      updateView(nextZoom, {
        x: centerX - (pinch.centerX - pinch.offsetX) * scale,
        y: centerY - (pinch.centerY - pinch.offsetY) * scale,
      });
      return;
    }
    const pan = panRef.current;
    if (pan?.pointerId === event.pointerId) updateView(zoomRef.current, { x: pan.offsetX + event.clientX - pan.x, y: pan.offsetY + event.clientY - pan.y });
  }} onPointerUp={(event) => releasePointer(event.currentTarget, event.pointerId)} onPointerCancel={(event) => releasePointer(event.currentTarget, event.pointerId)}>
    {displayUrl ? <div className="absolute inset-0 flex items-center justify-center will-change-transform" style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}><div className="relative overflow-hidden bg-white shadow-2xl" style={{ width: surfaceSize.width, height: surfaceSize.height, visibility: fitRatio ? "visible" : "hidden" }}><img src={displayUrl} alt={image.name} draggable={false} onLoad={(event) => { const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; setImageSize((current) => current.width === next.width && current.height === next.height ? current : next); }} className="block h-full w-full select-none object-contain" style={{ imageRendering: zoom >= nativeZoom ? "pixelated" : "auto" }} /></div></div> : <div className="absolute inset-0"><WorkspaceImageMedia image={image} role={role} fit="contain" controls /></div>}
    <div className="absolute bottom-4 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1 rounded-md border border-slate-200 bg-white/95 p-1 text-slate-600 shadow-sm backdrop-blur" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}><button type="button" onClick={() => scaleAround(zoomRef.current / 1.2)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 hover:text-[#2f65cf]" title={text("zoomOut")} aria-label={text("zoomOut")}><FiZoomOut /></button><button type="button" onClick={resetView} className="flex h-7 min-w-12 items-center justify-center rounded px-1 text-[10px] font-semibold tabular-nums hover:bg-slate-100 hover:text-[#2f65cf]" title={text("fitImage")}>{actualScalePercent}%</button><button type="button" onClick={() => scaleAround(zoomRef.current * 1.2)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 hover:text-[#2f65cf]" title={text("zoomIn")} aria-label={text("zoomIn")}><FiZoomIn /></button></div>
  </div>;
}

function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => { if (!blob) { setUrl(""); return; } const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}
