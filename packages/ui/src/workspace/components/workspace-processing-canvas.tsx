import React from "react";
import { FiZoomIn, FiZoomOut } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import { readWorkspaceImagePreview, readWorkspaceImageSource } from "../repository";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";
import { WorkspaceImageMedia } from "./workspace-image-media";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export function WorkspaceProcessingCanvas({ image, role, renderedBlob }: { image: WorkspaceImage; role: WorkspaceIdentity["role"]; renderedBlob?: Blob }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [cachedBlob, setCachedBlob] = React.useState<Blob>();
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
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

  React.useEffect(() => { setZoom(1); setOffset({ x: 0, y: 0 }); }, [image.imageId]);
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setViewport((current) => { const next = { width: host.clientWidth, height: host.clientHeight }; return current.width === next.width && current.height === next.height ? current : next; });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const resetView = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };
  const scaleView = (factor: number) => setZoom((current) => Math.min(4, Math.max(0.25, current * factor)));
  const fitRatio = imageSize.width && imageSize.height ? Math.min(Math.max(0, viewport.width - 64) / imageSize.width, Math.max(0, viewport.height - 64) / imageSize.height, 1) : 0;
  const surfaceSize = { width: imageSize.width * fitRatio, height: imageSize.height * fitRatio };

  return <div ref={hostRef} className="relative h-full w-full touch-none overflow-hidden bg-[#dfe5ec] [background-image:linear-gradient(45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(-45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(255,255,255,.28)_75%),linear-gradient(-45deg,transparent_75%,rgba(255,255,255,.28)_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px] cursor-grab active:cursor-grabbing" onWheel={(event) => { event.preventDefault(); const delta = Math.max(-80, Math.min(80, event.deltaY)); scaleView(Math.exp(-delta * 0.0025)); }} onDoubleClick={resetView} onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }; }} onPointerMove={(event) => { const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; setOffset({ x: drag.offsetX + event.clientX - drag.x, y: drag.offsetY + event.clientY - drag.y }); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
    {displayUrl ? <div className="absolute inset-0 flex items-center justify-center will-change-transform" style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}><div className="relative overflow-hidden bg-white shadow-2xl" style={{ width: surfaceSize.width, height: surfaceSize.height, visibility: fitRatio ? "visible" : "hidden" }}><img src={displayUrl} alt={image.name} draggable={false} onLoad={(event) => { const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; setImageSize((current) => current.width === next.width && current.height === next.height ? current : next); }} className="block h-full w-full select-none object-contain" /></div></div> : <div className="absolute inset-0"><WorkspaceImageMedia image={image} role={role} fit="contain" controls /></div>}
    <div className="absolute bottom-4 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1 rounded-md border border-slate-200 bg-white/95 p-1 text-slate-600 shadow-sm backdrop-blur" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}><button type="button" onClick={() => scaleView(1 / 1.2)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 hover:text-[#2f65cf]" title={text("zoomOut")} aria-label={text("zoomOut")}><FiZoomOut /></button><button type="button" onClick={resetView} className="flex h-7 min-w-12 items-center justify-center rounded px-1 text-[10px] font-semibold tabular-nums hover:bg-slate-100 hover:text-[#2f65cf]" title={text("fitImage")}>{Math.round(zoom * 100)}%</button><button type="button" onClick={() => scaleView(1.2)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 hover:text-[#2f65cf]" title={text("zoomIn")} aria-label={text("zoomIn")}><FiZoomIn /></button></div>
  </div>;
}

function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => { if (!blob) { setUrl(""); return; } const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}
