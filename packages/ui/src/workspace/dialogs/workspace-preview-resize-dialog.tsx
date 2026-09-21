import React from "react";
import { FiChevronDown, FiLock, FiUnlock, FiX } from "react-icons/fi";
import { getLang, getWorkspaceEditorLabels } from "../../locales";

const MAX_DIMENSION = 16384;
const INITIAL_RESOLUTION_PPI = 72;
const SQUARE_PRESETS = [320, 640, 800, 1024, 1280];
const LARGE_SQUARE_PRESETS = [1280, 1920];
type DimensionUnit = "px" | "percent" | "inch" | "cm" | "mm" | "pt";

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pixelsToDimension(pixels: number, unit: DimensionUnit, sourcePixels: number, resolution: number) {
  if (unit === "percent") return pixels / Math.max(sourcePixels, 1) * 100;
  if (unit === "inch") return pixels / Math.max(resolution, 1);
  if (unit === "cm") return pixels / Math.max(resolution, 1) * 2.54;
  if (unit === "mm") return pixels / Math.max(resolution, 1) * 25.4;
  if (unit === "pt") return pixels / Math.max(resolution, 1) * 72;
  return pixels;
}

function dimensionToPixels(value: number, unit: DimensionUnit, sourcePixels: number, resolution: number) {
  if (unit === "percent") return value / 100 * sourcePixels;
  if (unit === "inch") return value * resolution;
  if (unit === "cm") return value / 2.54 * resolution;
  if (unit === "mm") return value / 25.4 * resolution;
  if (unit === "pt") return value / 72 * resolution;
  return value;
}

export function WorkspacePreviewResizeDialog({
  width: initialWidth,
  height: initialHeight,
  originalSize = 0,
  onApply,
  onClose,
}: {
  width: number;
  height: number;
  originalSize?: number;
  onApply(width: number, height: number): void | Promise<void>;
  onClose(): void;
}) {
  const labels = getWorkspaceEditorLabels(getLang());
  const sourceWidth = Math.max(1, Math.round(initialWidth));
  const sourceHeight = Math.max(1, Math.round(initialHeight));
  const [width, setWidth] = React.useState(sourceWidth);
  const [height, setHeight] = React.useState(sourceHeight);
  const [widthDraft, setWidthDraft] = React.useState<string | null>(null);
  const [heightDraft, setHeightDraft] = React.useState<string | null>(null);
  const [preset, setPreset] = React.useState("custom");
  const [locked, setLocked] = React.useState(true);
  const [dimensionUnit, setDimensionUnit] = React.useState<DimensionUnit>("px");
  const [resolution, setResolution] = React.useState(INITIAL_RESOLUTION_PPI);
  const [resolutionDraft, setResolutionDraft] = React.useState<string | null>(null);
  const [resolutionUnit, setResolutionUnit] = React.useState("ppi");
  const [resample, setResample] = React.useState(true);
  const [resultUnit, setResultUnit] = React.useState<DimensionUnit>("percent");
  const ratioRef = React.useRef(sourceWidth / sourceHeight);
  const [working, setWorking] = React.useState(false);
  const [calculating, setCalculating] = React.useState(false);
  const calculationTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const calculationKeyRef = React.useRef<string | null>(null);
  const valid = Number.isFinite(width) && Number.isFinite(height) && Number.isFinite(resolution)
    && width >= 1 && height >= 1 && width <= MAX_DIMENSION && height <= MAX_DIMENSION && resolution > 0;
  const canEstimateSize = valid && Number.isFinite(originalSize) && originalSize > 0;
  const estimatedSize = canEstimateSize
    ? Math.max(1, Math.round(originalSize * (width * height) / (sourceWidth * sourceHeight)))
    : 0;
  const resolutionPpi = resolutionUnit === "ppcm" ? resolution * 2.54 : resolution;
  const dimensionValue = (pixels: number, sourcePixels: number) => {
    if (!resample && dimensionUnit === "percent") {
      const currentInches = pixels / Math.max(resolutionPpi, Number.EPSILON);
      const originalInches = sourcePixels / INITIAL_RESOLUTION_PPI;
      return currentInches / Math.max(originalInches, Number.EPSILON) * 100;
    }
    return pixelsToDimension(pixels, dimensionUnit, sourcePixels, resolutionPpi);
  };
  const formatDimensionValue = (pixels: number, sourcePixels: number) => {
    const value = dimensionValue(pixels, sourcePixels);
    return dimensionUnit === "px" ? String(Math.round(value)) : String(Number(value.toFixed(2)));
  };
  const resultUnits: DimensionUnit[] = ["percent", "px", "inch", "cm", "mm", "pt"];
  const resultUnitIndex = resultUnits.indexOf(resultUnit);
  const nextResultUnit = () => setResultUnit(resultUnits[(resultUnitIndex + 1) % resultUnits.length]);
  const resultText = (() => {
    if (!valid) return labels.resizeUnknownResult;
    if (resultUnit === "percent") {
      const percent = !resample
        ? width / Math.max(resolutionPpi, Number.EPSILON) / (sourceWidth / INITIAL_RESOLUTION_PPI) * 100
        : width / sourceWidth * 100;
      return labels.resizePercent(Number(percent.toFixed(1)));
    }
    if (resultUnit === "px") return labels.resizePhysicalSize(String(Math.round(width)), String(Math.round(height)), labels.resizePixels);
    const centimetersPerPixel = 2.54 / Math.max(resolutionPpi, 1);
    const widthInCentimeters = width * centimetersPerPixel;
    const heightInCentimeters = height * centimetersPerPixel;
    const factors: Record<Exclude<DimensionUnit, "percent" | "px">, { width: number; height: number; label: string }> = {
      inch: { width: widthInCentimeters / 2.54, height: heightInCentimeters / 2.54, label: labels.resizeUnitInch },
      cm: { width: widthInCentimeters, height: heightInCentimeters, label: labels.resizeUnitCentimeter },
      mm: { width: widthInCentimeters * 10, height: heightInCentimeters * 10, label: labels.resizeUnitMillimeter },
      pt: { width: widthInCentimeters / 2.54 * 72, height: heightInCentimeters / 2.54 * 72, label: labels.resizeUnitPoint },
    };
    const result = factors[resultUnit];
    const formatResultDimension = resultUnit === "pt"
      ? (value: number) => String(Math.round(value))
      : (value: number) => value.toFixed(2);
    return labels.resizePhysicalSize(formatResultDimension(result.width), formatResultDimension(result.height), result.label);
  })();

  const selectClass = "h-8 w-full appearance-none rounded-md border border-slate-200 bg-white px-2 pr-7 text-xs text-slate-800 outline-none focus:border-[#2f65cf] focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
  const inputClass = "h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm tabular-nums text-slate-800 outline-none focus:border-[#2f65cf] focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

  const setWidthValue = (displayValue: number) => {
    if (!resample && dimensionUnit !== "px") {
      const targetInches = dimensionUnit === "percent"
        ? sourceWidth / INITIAL_RESOLUTION_PPI * displayValue / 100
        : dimensionUnit === "inch"
          ? displayValue
          : dimensionUnit === "cm"
            ? displayValue / 2.54
            : dimensionUnit === "mm"
              ? displayValue / 25.4
              : displayValue / 72;
      if (Number.isFinite(targetInches) && targetInches > 0) {
        const nextPpi = width / targetInches;
        setResolution(resolutionUnit === "ppcm" ? nextPpi / 2.54 : nextPpi);
      }
      setPreset("custom");
      return;
    }
    const next = dimensionToPixels(displayValue, dimensionUnit, sourceWidth, resolutionPpi);
    setPreset("custom");
    setWidth(Math.round(next));
    if (locked && Number.isFinite(next) && next > 0) {
      setHeight(Math.max(1, Math.round(next / ratioRef.current)));
      setHeightDraft(null);
    }
  };
  const setHeightValue = (displayValue: number) => {
    if (!resample && dimensionUnit !== "px") {
      const targetInches = dimensionUnit === "percent"
        ? sourceHeight / INITIAL_RESOLUTION_PPI * displayValue / 100
        : dimensionUnit === "inch"
          ? displayValue
          : dimensionUnit === "cm"
            ? displayValue / 2.54
            : dimensionUnit === "mm"
              ? displayValue / 25.4
              : displayValue / 72;
      if (Number.isFinite(targetInches) && targetInches > 0) {
        const nextPpi = height / targetInches;
        setResolution(resolutionUnit === "ppcm" ? nextPpi / 2.54 : nextPpi);
      }
      setPreset("custom");
      return;
    }
    const next = dimensionToPixels(displayValue, dimensionUnit, sourceHeight, resolutionPpi);
    setPreset("custom");
    setHeight(Math.round(next));
    if (locked && Number.isFinite(next) && next > 0) {
      setWidth(Math.max(1, Math.round(next * ratioRef.current)));
      setWidthDraft(null);
    }
  };
  const setResolutionValue = (nextValue: number) => {
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      setResolution(nextValue);
      return;
    }
    setResolution(nextValue);
  };
  const setResolutionUnitValue = (nextUnit: string) => {
    if ((nextUnit !== "ppi" && nextUnit !== "ppcm") || nextUnit === resolutionUnit) return;
    const currentPpi = resolutionUnit === "ppcm" ? resolution * 2.54 : resolution;
    setResolutionUnit(nextUnit);
    setResolution(nextUnit === "ppcm" ? currentPpi / 2.54 : currentPpi);
    setResolutionDraft(null);
  };
  const changePreset = (value: string) => {
    if (!resample) return;
    setPreset(value);
    if (value === "original") {
      setWidth(sourceWidth);
      setHeight(sourceHeight);
      return;
    }
    const squareSize = Number(value.startsWith("large-") ? value.slice(6) : value);
    if (Number.isFinite(squareSize) && squareSize > 0) {
      setWidth(squareSize);
      setHeight(squareSize);
    }
  };
  const updateResample = (next: boolean) => {
    setResample(next);
    if (!next) {
      setLocked(true);
      if (dimensionUnit === "px") setDimensionUnit("inch");
    }
  };
  const calculationKey = `${width}:${height}:${resolution}:${dimensionUnit}:${resolutionUnit}:${resample}`;
  React.useEffect(() => {
    if (calculationKeyRef.current === null) {
      calculationKeyRef.current = calculationKey;
      return;
    }
    if (calculationKeyRef.current === calculationKey) return;
    calculationKeyRef.current = calculationKey;
    if (calculationTimerRef.current) clearTimeout(calculationTimerRef.current);
    setCalculating(true);
    calculationTimerRef.current = setTimeout(() => setCalculating(false), 420);
  }, [calculationKey]);
  React.useEffect(() => () => {
    if (calculationTimerRef.current) clearTimeout(calculationTimerRef.current);
  }, []);

  const dimensionUnits: Array<[DimensionUnit, string]> = [
    ["px", labels.resizePixels],
    ["percent", labels.resizeUnitPercent],
    ["inch", labels.resizeUnitInch],
    ["cm", labels.resizeUnitCentimeter],
    ["mm", labels.resizeUnitMillimeter],
    ["pt", labels.resizeUnitPoint],
  ];
  const bracketRowSpan = resample ? "row-span-2" : "row-span-3";
  const bracketPath = resample
    ? "M 0 22.222 H 8 V 77.778 H 0"
    : "M 0 14.286 H 8 V 85.714 H 0 M 0 50 H 8";

  return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 p-2">
    <section className="w-full max-w-sm overflow-hidden rounded-lg bg-white text-slate-800 shadow-2xl" role="dialog" aria-modal="true" aria-label={labels.resizeDialogTitle}>
      <header className="flex items-center justify-between px-4 pb-1 pt-3">
        <h2 className="text-base font-semibold text-slate-900">{labels.resizeDialogTitle}</h2>
        <button type="button" onClick={onClose} disabled={working} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40" aria-label={labels.closeDialog}><FiX className="h-4 w-4" /></button>
      </header>

      <div className="space-y-3 px-4 pb-4">
        <section className="rounded-lg bg-slate-50 p-3">
          <div className="space-y-2">
            <div className="grid grid-cols-[4rem_minmax(0,1fr)_4rem] items-center gap-x-2">
              <span className="text-xs font-semibold text-slate-700">{labels.resizeFit}:</span>
              <div className="relative">
                <select value={preset} onChange={(event) => changePreset(event.target.value)} disabled={!resample} className={selectClass} aria-label={labels.resizeFit}>
                  <option value="custom">{labels.resizeCustom}</option>
                  {SQUARE_PRESETS.map((size) => <option key={`small-${size}`} value={size}>{size} × {size}</option>)}
                  <option value="separator" disabled>──────────</option>
                  {LARGE_SQUARE_PRESETS.map((size, index) => <option key={`large-${size}-${index}`} value={`large-${size}`}>{size} × {size}</option>)}
                </select>
                <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              </div>
              <span className="text-xs font-semibold text-slate-600">{labels.resizePixels}</span>
            </div>

            <div className="grid grid-rows-[2rem_2rem_2rem] grid-cols-[4rem_minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
              <label className="col-start-1 row-start-1 text-xs font-semibold text-slate-700">{labels.widthPx.replace(" (px)", "").replace("（px）", "")}:</label>
              <input type="number" name="workspace-resize-width" autoComplete="off" min={0.01} max={MAX_DIMENSION} value={widthDraft ?? formatDimensionValue(width, sourceWidth)} onChange={(event) => { const raw = event.target.value; setWidthDraft(raw); if (raw !== "") setWidthValue(Number(raw)); }} onBlur={() => setWidthDraft(null)} className={`${inputClass} col-start-2 row-start-1`} />
              <div className={`relative col-start-3 row-start-1 ${bracketRowSpan} flex h-full w-8 items-center justify-center`}>
                <svg className="pointer-events-none absolute -left-2 top-0 h-full w-10 overflow-visible" viewBox="0 0 40 100" preserveAspectRatio="none" aria-hidden="true">
                  <path d={bracketPath} fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="absolute inset-x-0 top-0 flex h-[4.5rem] items-center justify-center">
                  <button type="button" onClick={() => setLocked((value) => !value)} disabled={!resample} className="relative z-10 flex h-7 w-7 items-center justify-center rounded-md bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf] disabled:cursor-not-allowed disabled:opacity-45" aria-label={locked ? labels.unlockAspectRatio : labels.lockAspectRatio} title={locked ? labels.aspectRatioLocked : labels.freelyResize}>{locked ? <FiLock className="h-3.5 w-3.5" /> : <FiUnlock className="h-3.5 w-3.5" />}</button>
                </div>
              </div>
              <div className="relative col-start-4 row-start-1 row-span-2 self-center">
                <select value={dimensionUnit} onChange={(event) => setDimensionUnit(event.target.value as DimensionUnit)} className={selectClass} aria-label={labels.resizePixels}>
                  {dimensionUnits.map(([value, label]) => <option key={value} value={value} disabled={!resample && value === "px"}>{label}</option>)}
                </select>
                <FiChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              </div>
              <label className="col-start-1 row-start-2 text-xs font-semibold text-slate-700">{labels.heightPx.replace(" (px)", "").replace("（px）", "")}:</label>
              <input type="number" name="workspace-resize-height" autoComplete="off" min={0.01} max={MAX_DIMENSION} value={heightDraft ?? formatDimensionValue(height, sourceHeight)} onChange={(event) => { const raw = event.target.value; setHeightDraft(raw); if (raw !== "") setHeightValue(Number(raw)); }} onBlur={() => setHeightDraft(null)} className={`${inputClass} col-start-2 row-start-2`} />
              <span className="col-start-1 row-start-3 text-xs font-semibold text-slate-700">{labels.resizeResolution}:</span>
              <input type="number" name="workspace-resize-resolution" autoComplete="off" min={1} max={2400} value={resolutionDraft ?? resolution} onChange={(event) => { const raw = event.target.value; setResolutionDraft(raw); if (raw !== "") setResolutionValue(Number(raw)); }} onBlur={() => setResolutionDraft(null)} className={`${inputClass} col-start-2 row-start-3`} />
              <div className="relative col-start-4 row-start-3">
                <select value={resolutionUnit} onChange={(event) => setResolutionUnitValue(event.target.value)} className={selectClass} aria-label={labels.resizeResolution}>
                  <option value="ppi">{labels.resizePixelsPerInch}</option>
                  <option value="ppcm">Pixels/cm</option>
                </select>
                <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              </div>
            </div>

            <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-1">
              <span />
              <label className={`flex items-center gap-1.5 text-xs font-semibold ${resample ? "text-slate-700" : "text-slate-400"}`}><input type="checkbox" checked={locked} disabled={!resample} onChange={(event) => setLocked(event.target.checked)} className="h-4 w-4 accent-[#1683ff]" />{labels.resizeScaleProportionally}</label>
              <span />
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><input type="checkbox" checked={resample} onChange={(event) => updateResample(event.target.checked)} className="h-4 w-4 accent-[#1683ff]" />{labels.resizeResampleImage}</label>
            </div>
          </div>
          {!valid ? <p className="mt-4 text-sm text-red-600">{labels.dimensionRangeError(MAX_DIMENSION)}</p> : null}
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold text-slate-800">{labels.resizeResultSize}</h3>
          <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2.5">
            <button type="button" onClick={nextResultUnit} className="block h-5 w-full overflow-hidden text-ellipsis whitespace-nowrap text-left text-[13px] font-medium tabular-nums text-slate-800 hover:text-[#2f65cf]" title={labels.resizeResultSize}>{resultText}</button>
            <div className="h-5 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium tabular-nums text-slate-800">{calculating ? labels.resizeCalculating(formatFileSize(originalSize)) : canEstimateSize ? labels.resizeFileSize(formatFileSize(estimatedSize), formatFileSize(originalSize)) : labels.resizeUnknownResult}</div>
          </div>
        </section>
      </div>

      <footer className="flex justify-end gap-2 px-4 pb-4">
        <button type="button" onClick={onClose} disabled={working} className="h-8 rounded-md bg-slate-100 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">{labels.cancel}</button>
        <button type="button" disabled={!valid || working} onClick={async () => { setWorking(true); try { await onApply(Math.round(width), Math.round(height)); } finally { setWorking(false); } }} className="h-8 rounded-md bg-[#1683ff] px-5 text-xs font-semibold text-white hover:bg-[#0874e8] disabled:opacity-50">{getLang() === "zh" ? "好" : labels.applyChanges}</button>
      </footer>
    </section>
  </div>;
}
