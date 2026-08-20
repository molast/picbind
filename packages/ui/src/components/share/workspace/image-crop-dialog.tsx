"use client";

import React from "react";
import { FiLoader, FiX } from "react-icons/fi";
import type { RoomImage } from "../share-room-types";
import type { ShareRoomLabels } from "../share-room-labels";
import {
  cropRoomImage,
  type NormalizedCrop,
  type RoomImageEditResult,
} from "../../../utils/room-image-editing";
import KonvaCropEditor from "./konva-crop-editor";

type ImageCropDialogProps = {
  image: RoomImage | null;
  labels: ShareRoomLabels;
  onClose(): void;
  onSave(source: RoomImage, result: RoomImageEditResult): void | Promise<void>;
  parameterAction?: "apply" | "proposal";
  onApplyParameters?(crop: NormalizedCrop): void | Promise<void>;
  initialCrop?: NormalizedCrop;
};

type RatioValue = "free" | "original" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

const INITIAL_CROP: NormalizedCrop = { x: 0.09, y: 0.09, width: 0.82, height: 0.82 };

export default function ImageCropDialog({ image, labels, onClose, onSave, parameterAction, onApplyParameters, initialCrop }: ImageCropDialogProps) {
  const [ratioValue, setRatioValue] = React.useState<RatioValue>("free");
  const [crop, setCrop] = React.useState<NormalizedCrop>(INITIAL_CROP);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!image) return;
    setRatioValue("free");
    setCrop(initialCrop || INITIAL_CROP);
    setWorking(false);
    setError(null);
  }, [image, initialCrop]);

  React.useEffect(() => {
    if (!image) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [image, onClose, working]);

  if (!image) return null;
  const ratios: Array<{ label: string; value: RatioValue; ratio: number | null }> = [
    { label: labels.freeCrop, value: "free", ratio: null },
    { label: labels.originalRatio, value: "original", ratio: -1 },
    { label: "1:1", value: "1:1", ratio: 1 },
    { label: "4:3", value: "4:3", ratio: 4 / 3 },
    { label: "3:4", value: "3:4", ratio: 3 / 4 },
    { label: "16:9", value: "16:9", ratio: 16 / 9 },
    { label: "9:16", value: "9:16", ratio: 9 / 16 },
  ];
  const sourceRatio = Math.max(1, image.width) / Math.max(1, image.height);
  const selected = ratios.find((item) => item.value === ratioValue) || ratios[0];
  const aspect = selected.ratio === -1 ? sourceRatio : selected.ratio;
  const cropWidth = Math.max(1, Math.round(crop.width * image.width));
  const cropHeight = Math.max(1, Math.round(crop.height * image.height));

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4">
      <section className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={labels.cropImage}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{labels.cropImage}</h2>
            <p className="mt-0.5 max-w-md truncate text-xs text-slate-500">{image.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={working} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={labels.closeDialog}><FiX className="h-4 w-4" aria-hidden="true" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap gap-2">
            {ratios.map((item) => (
              <button key={item.value} type="button" onClick={() => setRatioValue(item.value)} className={`h-8 rounded-md border px-3 text-xs font-semibold transition ${ratioValue === item.value ? "border-[#2f65cf] bg-blue-50 text-[#2f65cf]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{item.label}</button>
            ))}
          </div>

          <KonvaCropEditor
            imageUrl={image.url}
            aspect={aspect}
            initialCrop={initialCrop}
            onCropChange={setCrop}
          />

          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span>{labels.outputDimensions(cropWidth, cropHeight)}</span>
            <span>{selected.label}</span>
          </div>
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} disabled={working} className="h-9 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">{labels.cancel}</button>
          <button type="button" disabled={working} onClick={() => { setWorking(true); setError(null); const task=parameterAction&&onApplyParameters?Promise.resolve().then(()=>onApplyParameters(crop)):cropRoomImage(new File([image.blob], image.name, { type: image.type }), crop).then((result) => onSave(image, result)); void task.catch((reason) => setError(reason instanceof Error ? reason.message : labels.cropFailed)).finally(() => setWorking(false)); }} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:opacity-50">
            {working ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {working?(parameterAction==="proposal"?"Submitting...":parameterAction?"Applying...":labels.processing):parameterAction==="proposal"?"Submit proposal":parameterAction?"Apply changes":labels.generateResult}
          </button>
        </footer>
      </section>
    </div>
  );
}
