import React from "react";
import { FiImage, FiRefreshCw } from "react-icons/fi";
import WorkspacePlaceholderMedia from "../../components/share/workspace-placeholder-media";
import { useImageProcessing } from "../../image-processing";
import { readWorkspaceImagePreview, readWorkspaceImageSource, saveWorkspaceImage } from "../repository";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";

export function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    if (!blob) { setUrl(""); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function BlobImageMedia({ blob, alt, fit = "cover" }: { blob: Blob; alt: string; fit?: "cover" | "contain" }) {
  const url = useBlobUrl(blob);
  return url ? <img src={url} alt={alt} className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`} /> : null;
}

export function ImageAddressMedia({ url, alt, fit = "cover", onDimensions }: { url: string; alt: string; fit?: "cover" | "contain"; onDimensions?(width: number, height: number): void }) {
  return <img src={url} alt={alt} onLoad={(event) => onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`} />;
}

export function WorkspaceImageMedia({ image, role, fit = "cover", controls = false, preferOriginal = false, onDimensions }: { image: WorkspaceImage; role: WorkspaceIdentity["role"]; fit?: "cover" | "contain"; controls?: boolean; preferOriginal?: boolean; onDimensions?(width: number, height: number): void }) {
  const imageProcessing = useImageProcessing();
  const [showPreview, setShowPreview] = React.useState(false);
  const [preview, setPreview] = React.useState<Blob>();
  const [original, setOriginal] = React.useState<Blob>();
  const libraryOriginal = role === "owner" && image.workspaceLocation === "library";
  React.useEffect(() => {
    let active = true;
    setPreview(undefined);
    if (preferOriginal || libraryOriginal) return () => { active = false; };
    void (async () => {
      try {
        let value = image.previewCached ? await readWorkspaceImagePreview(image) : null;
        if (!value && image.sourceCached) {
          const source = await readWorkspaceImageSource(image);
          if (source) {
            const assets = await imageProcessing.createShareAssets({
              source: { kind: "blob", blob: source, name: image.name, mimeType: source.type || image.mimeType },
              container: { width: 320, height: 240 },
            }, { requestId: `workspace-media-thumbnail:${image.imageId}:${image.previewRevision}` });
            value = assets.thumbnail.blob;
            await saveWorkspaceImage({ ...image, preview: value, previewCached: true });
          }
        }
        if (active && value) setPreview(value);
      } catch { /* Keep the placeholder when this browser cannot decode the source. */ }
    })();
    return () => { active = false; };
  }, [image.imageId, image.name, image.mimeType, image.previewCached, image.previewRevision, image.sourceCached, imageProcessing, libraryOriginal, preferOriginal]);
  React.useEffect(() => {
    let active = true;
    setOriginal(undefined);
    if ((preferOriginal || libraryOriginal) && !image.source && !image.sourceAddress && image.sourceCached) {
      void readWorkspaceImageSource(image).then((value) => { if (active && value) setOriginal(value); });
    }
    return () => { active = false; };
  }, [image.imageId, image.previewRevision, image.source, image.sourceAddress, image.sourceCached, libraryOriginal, preferOriginal]);
  const previewUrl = useBlobUrl(preview);
  const originalUrl = useBlobUrl(original);
  const transientSourceUrl = useBlobUrl(image.source);
  const directSourceUrl = image.sourceAddress || transientSourceUrl || originalUrl;
  React.useEffect(() => setShowPreview(false), [image.imageId, image.previewRevision, preview]);
  const stopPreview = React.useCallback(() => setShowPreview(false), []);
  const originalMedia = directSourceUrl
    ? <ImageAddressMedia url={directSourceUrl} alt={image.name} fit={fit} onDimensions={onDimensions} />
    : <div className="flex h-full items-center justify-center text-slate-300"><FiRefreshCw className="h-5 w-5 animate-spin" /></div>;
  return <div className="relative h-full w-full overflow-hidden" style={{ background: image.placeholder?.dominantColor }}>
    {libraryOriginal || (role === "owner" && preferOriginal) ? originalMedia : role === "owner" && previewUrl ? <ImageAddressMedia url={previewUrl} alt={image.name} fit={fit} onDimensions={onDimensions} /> : image.placeholder ? <WorkspacePlaceholderMedia alt={image.name} placeholder={image.placeholder} /> : previewUrl ? <ImageAddressMedia url={previewUrl} alt={image.name} fit={fit} onDimensions={onDimensions} /> : <div className="flex h-full items-center justify-center text-slate-400"><FiImage className="h-8 w-8" /></div>}
    {role !== "owner" && showPreview && previewUrl ? <img src={previewUrl} alt="" className={`pointer-events-none absolute inset-0 z-[5] h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`} aria-hidden="true" /> : null}
    {role !== "owner" && controls && previewUrl ? <button type="button" className="absolute bottom-2 left-2 z-10 flex h-7 w-7 touch-none items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]" aria-label="Hold to preview" title="Hold to preview" onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setShowPreview(true); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); stopPreview(); }} onPointerCancel={stopPreview} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setShowPreview(true); } }} onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") stopPreview(); }} onBlur={stopPreview}><FiImage className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
  </div>;
}
