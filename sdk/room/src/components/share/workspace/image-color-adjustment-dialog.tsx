"use client";

import React from "react";
import {
  FiAperture,
  FiAlignJustify,
  FiBarChart2,
  FiColumns,
  FiDroplet,
  FiGrid,
  FiLayers,
  FiLoader,
  FiMaximize2,
  FiMinimize2,
  FiRepeat,
  FiRotateCcw,
  FiSliders,
  FiSun,
  FiTarget,
  FiThermometer,
  FiTrendingUp,
  FiX,
} from "react-icons/fi";
import type { RoomImage } from "../share-room-types";
import { adjustRoomImage, type RoomImageEditResult } from "../../../utils/room-image-editing";
import {
  DEFAULT_COLOR_ADJUSTMENTS,
  type ColorToneRange,
  type RoomColorAdjustments,
} from "../../../utils/room-color-adjustments";
import ColorAdjustmentPreview, { type ColorComparisonMode } from "./color-adjustment-preview";
import ToneCurveEditor from "./tone-curve-editor";
import type { ShareRoomLabels } from "../share-room-labels";

type ImageColorAdjustmentDialogProps = {
  image: RoomImage | null;
  labels: ShareRoomLabels;
  onClose(): void;
  onSave(source: RoomImage, result: RoomImageEditResult): void | Promise<void>;
};

type Category = "light" | "color" | "balance" | "advanced";
type Submenu = "tone" | "levels" | "curves" | "saturation" | "temperature" | "balance" | "photo" | "selective" | "replace" | "channels" | "recolor";

const DEFAULT_SUBMENU: Record<Category, Submenu> = {
  light: "tone",
  color: "saturation",
  balance: "balance",
  advanced: "selective",
};

type SliderRowProps = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  resetValue?: number;
  resetLabel?(label: string): string;
  onChange(value: number): void;
};

function SliderRow({ label, value, min = -100, max = 100, suffix = "%", resetValue = 0, resetLabel = (text) => text, onChange }: SliderRowProps) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.75rem_1.75rem] items-center gap-2.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-1.5 w-full cursor-pointer accent-[#2f65cf]" aria-label={label} />
      <span className="text-right text-[11px] tabular-nums text-slate-500">{value > 0 && min < 0 ? "+" : ""}{value}{suffix}</span>
      <button type="button" disabled={value === resetValue} onClick={() => onChange(resetValue)} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-20" aria-label={resetLabel(label)} title={resetLabel(label)}><FiRotateCcw className="h-3.5 w-3.5" aria-hidden="true" /></button>
    </div>
  );
}

export default function ImageColorAdjustmentDialog({ image, labels, onClose, onSave }: ImageColorAdjustmentDialogProps) {
  const [category, setCategory] = React.useState<Category>("light");
  const [submenu, setSubmenu] = React.useState<Submenu>("tone");
  const [comparisonMode, setComparisonMode] = React.useState<ColorComparisonMode>("in-place");
  const [maximized, setMaximized] = React.useState(false);
  const [toneRange, setToneRange] = React.useState<ColorToneRange>("midtones");
  const [adjustments, setAdjustments] = React.useState<RoomColorAdjustments>(DEFAULT_COLOR_ADJUSTMENTS);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!image) return;
    setCategory("light");
    setSubmenu("tone");
    setComparisonMode("in-place");
    setMaximized(false);
    setToneRange("midtones");
    setAdjustments(DEFAULT_COLOR_ADJUSTMENTS);
    setWorking(false);
    setError(null);
  }, [image]);
  React.useEffect(() => {
    if (!image) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !working) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [image, onClose, working]);

  if (!image) return null;
  const copy = labels.colorTools;
  const categories = [
    { value: "light", label: copy.basicLight, icon: FiSun },
    { value: "color", label: copy.colorProperties, icon: FiDroplet },
    { value: "balance", label: copy.toneBalance, icon: FiSliders },
    { value: "advanced", label: copy.advanced, icon: FiGrid },
  ] satisfies Array<{ value: Category; label: string; icon: typeof FiSun }>;
  const submenus: Record<Category, Array<{ value: Submenu; label: string; icon: typeof FiSun }>> = {
    light: [{ value: "tone", label: copy.tone, icon: FiSun }, { value: "levels", label: copy.levels, icon: FiBarChart2 }, { value: "curves", label: copy.curves, icon: FiTrendingUp }],
    color: [{ value: "saturation", label: copy.saturationGroup, icon: FiDroplet }, { value: "temperature", label: copy.temperatureGroup, icon: FiThermometer }],
    balance: [{ value: "balance", label: copy.balance, icon: FiSliders }, { value: "photo", label: copy.photoFilter, icon: FiAperture }],
    advanced: [{ value: "selective", label: copy.selective, icon: FiTarget }, { value: "replace", label: copy.replace, icon: FiRepeat }, { value: "channels", label: copy.channels, icon: FiLayers }, { value: "recolor", label: copy.recolor, icon: FiDroplet }],
  };
  const unchanged = JSON.stringify(adjustments) === JSON.stringify(DEFAULT_COLOR_ADJUSTMENTS);
  const setValue = <Key extends keyof RoomColorAdjustments>(key: Key, value: RoomColorAdjustments[Key]) => setAdjustments((current) => ({ ...current, [key]: value }));
  const setBalance = (key: keyof RoomColorAdjustments["balance"][ColorToneRange], value: number) => setAdjustments((current) => ({
    ...current,
    balance: { ...current.balance, [toneRange]: { ...current.balance[toneRange], [key]: value } },
  }));

  return (
    <div className={`fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 ${maximized ? "p-0" : "p-4"}`}>
      <section className={`flex w-full flex-col overflow-hidden bg-white shadow-2xl transition-[width,height,border-radius] duration-200 ${maximized ? "h-screen max-w-none rounded-none" : "h-[min(760px,calc(100vh-2rem))] max-w-5xl rounded-lg"}`} role="dialog" aria-modal="true" aria-label={labels.colorAdjustDialog}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div><h2 className="text-base font-semibold text-slate-900">{labels.imageAdjust}</h2><p className="mt-0.5 max-w-md truncate text-xs text-slate-500">{image.name}</p></div>
          <div className="flex items-center gap-1"><button type="button" onClick={() => setMaximized((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={maximized ? labels.restoreDialog : labels.maximizeDialog} title={maximized ? labels.restore : labels.maximize}>{maximized ? <FiMinimize2 className="h-4 w-4" aria-hidden="true" /> : <FiMaximize2 className="h-4 w-4" aria-hidden="true" />}</button><button type="button" onClick={onClose} disabled={working} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={labels.closeDialog}><FiX className="h-4 w-4" aria-hidden="true" /></button></div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto bg-slate-50 lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
          <div className="flex min-h-0 min-w-0 items-center p-6 lg:overflow-hidden">
            <div className={`flex h-full w-full min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm ${maximized ? "max-h-none" : "max-h-[620px]"}`}>
              <div className="flex h-11 shrink-0 items-center justify-end gap-1 border-b border-slate-100 px-2">
                {([
                  { value: "stacked" as const, label: labels.compareStacked, icon: FiAlignJustify },
                  { value: "in-place" as const, label: labels.compareInPlace, icon: FiLayers },
                  { value: "split" as const, label: labels.compareSplit, icon: FiColumns },
                ]).map((item) => {
                  const Icon = item.icon;
                  return <button key={item.value} type="button" onClick={() => setComparisonMode(item.value)} className={`flex h-8 w-8 items-center justify-center rounded-md transition ${comparisonMode === item.value ? "bg-blue-50 text-[#2f65cf] ring-1 ring-blue-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`} aria-label={item.label} title={item.label}><Icon className="h-4 w-4" aria-hidden="true" /></button>;
                })}
              </div>
              <div className="min-h-0 flex-1 p-2">
                <ColorAdjustmentPreview imageUrl={image.url} adjustments={adjustments} labels={labels} mode={comparisonMode} samplingEnabled={submenu === "replace" && adjustments.replaceEnabled} onSample={(color) => setAdjustments((current) => ({ ...current, replaceSource: color, replaceEnabled: true }))} />
              </div>
            </div>
          </div>

          <div className="grid min-h-0 grid-cols-[56px_minmax(0,1fr)] border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
            <nav className="flex flex-col items-center gap-2 border-r border-slate-100 px-2 py-3" aria-label={labels.colorCategories}>
              {categories.map((item) => {
                const Icon = item.icon;
                return <button key={item.value} type="button" onClick={() => { setCategory(item.value); setSubmenu(DEFAULT_SUBMENU[item.value]); }} className={`relative flex h-10 w-10 items-center justify-center rounded-md transition ${category === item.value ? "bg-[#2f65cf] text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`} aria-label={item.label} title={item.label}>{category === item.value ? <span className="absolute -left-2 h-5 w-0.5 rounded-r bg-[#2f65cf]" /> : null}<Icon className="h-[18px] w-[18px]" aria-hidden="true" /></button>;
              })}
            </nav>
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="border-b border-slate-100 px-4 pb-3 pt-3">
                <div className="mb-2 text-xs font-semibold text-slate-800">{categories.find((item) => item.value === category)?.label}</div>
                <div className="flex items-center gap-1 overflow-x-auto">
                  {submenus[category].map((item) => {
                    const Icon = item.icon;
                    return <button key={item.value} type="button" onClick={() => setSubmenu(item.value)} className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition ${submenu === item.value ? "bg-blue-50 text-[#2f65cf] ring-1 ring-blue-100" : "text-slate-500 hover:bg-slate-100"}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{item.label}</button>;
                  })}
                </div>
              </div>
              <div className="min-h-0 overflow-y-auto p-5">
              {submenu === "tone" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.brightnessContrast}</h3><SliderRow label={copy.brightness} resetLabel={labels.resetSetting} value={adjustments.brightness} onChange={(value) => setValue("brightness", value)} /><SliderRow label={copy.contrast} resetLabel={labels.resetSetting} value={adjustments.contrast} min={-99} max={99} onChange={(value) => setValue("contrast", value)} /></div> : null}
              {submenu === "levels" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.levels}</h3><SliderRow label={copy.blackPoint} resetLabel={labels.resetSetting} value={adjustments.blackPoint} min={0} max={100} suffix="" onChange={(value) => setValue("blackPoint", Math.min(value, adjustments.whitePoint - 1))} /><SliderRow label={copy.midtone} resetLabel={labels.resetSetting} value={adjustments.midtone} onChange={(value) => setValue("midtone", value)} /><SliderRow label={copy.whitePoint} resetLabel={labels.resetSetting} value={adjustments.whitePoint} min={155} max={255} resetValue={255} suffix="" onChange={(value) => setValue("whitePoint", Math.max(value, adjustments.blackPoint + 1))} /></div> : null}
              {submenu === "curves" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.toneCurve}</h3><ToneCurveEditor points={adjustments.curvePoints} labels={labels} onChange={(points) => setValue("curvePoints", points)} /></div> : null}
              {submenu === "saturation" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.saturationGroup}</h3><SliderRow label={copy.saturation} resetLabel={labels.resetSetting} value={adjustments.saturation} onChange={(value) => setValue("saturation", value)} /><SliderRow label={copy.vibrance} resetLabel={labels.resetSetting} value={adjustments.vibrance} onChange={(value) => setValue("vibrance", value)} /></div> : null}
              {submenu === "temperature" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.temperatureGroup}</h3><SliderRow label={copy.hue} resetLabel={labels.resetSetting} value={adjustments.hue} min={-180} max={180} suffix="°" onChange={(value) => setValue("hue", value)} /><SliderRow label={copy.temperature} resetLabel={labels.resetSetting} value={adjustments.temperature} onChange={(value) => setValue("temperature", value)} /></div> : null}
              {submenu === "balance" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.balance}</h3><div className="grid grid-cols-3 rounded-md bg-slate-100 p-1">{(["shadows", "midtones", "highlights"] as const).map((tone) => <button key={tone} type="button" onClick={() => setToneRange(tone)} className={`h-8 rounded text-[11px] font-semibold ${toneRange === tone ? "bg-white text-[#2f65cf] shadow-sm" : "text-slate-500"}`}>{tone === "shadows" ? copy.shadows : tone === "midtones" ? copy.midtone : copy.highlights}</button>)}</div><SliderRow label={copy.cyanRed} resetLabel={labels.resetSetting} value={adjustments.balance[toneRange].cyanRed} onChange={(value) => setBalance("cyanRed", value)} /><SliderRow label={copy.magentaGreen} resetLabel={labels.resetSetting} value={adjustments.balance[toneRange].magentaGreen} onChange={(value) => setBalance("magentaGreen", value)} /><SliderRow label={copy.yellowBlue} resetLabel={labels.resetSetting} value={adjustments.balance[toneRange].yellowBlue} onChange={(value) => setBalance("yellowBlue", value)} /></div> : null}
              {submenu === "photo" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.photoFilter}</h3><div className="grid grid-cols-[5.5rem_1fr] items-center gap-3"><span className="text-xs text-slate-600">{copy.filterColor}</span><input type="color" value={adjustments.photoFilterColor} onChange={(event) => setValue("photoFilterColor", event.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white p-1" /></div><SliderRow label={copy.density} resetLabel={labels.resetSetting} value={adjustments.photoFilterDensity} min={0} max={100} onChange={(value) => setValue("photoFilterDensity", value)} /></div> : null}
              {submenu === "selective" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.selective}</h3><select value={adjustments.selectiveRange} onChange={(event) => setValue("selectiveRange", event.target.value as RoomColorAdjustments["selectiveRange"])} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-600"><option value="reds">{copy.red}</option><option value="yellows">{copy.yellow}</option><option value="greens">{copy.green}</option><option value="cyans">{copy.cyan}</option><option value="blues">{copy.blue}</option><option value="magentas">{copy.magenta}</option></select><SliderRow label={copy.selectiveHue} resetLabel={labels.resetSetting} value={adjustments.selectiveHue} min={-180} max={180} suffix="°" onChange={(value) => setValue("selectiveHue", value)} /><SliderRow label={copy.selectiveSaturation} resetLabel={labels.resetSetting} value={adjustments.selectiveSaturation} onChange={(value) => setValue("selectiveSaturation", value)} /><SliderRow label={copy.selectiveLightness} resetLabel={labels.resetSetting} value={adjustments.selectiveLightness} onChange={(value) => setValue("selectiveLightness", value)} /></div> : null}
              {submenu === "replace" ? <div className="space-y-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">{copy.replace}</h3><input type="checkbox" checked={adjustments.replaceEnabled} onChange={(event) => setValue("replaceEnabled", event.target.checked)} className="h-4 w-4 accent-[#2f65cf]" /></div><div className="grid grid-cols-2 gap-3"><label className="text-[11px] text-slate-500">{copy.sourceColor}<input type="color" value={adjustments.replaceSource} onChange={(event) => setValue("replaceSource", event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-200 p-1" /></label><label className="text-[11px] text-slate-500">{copy.targetColor}<input type="color" value={adjustments.replaceTarget} onChange={(event) => setValue("replaceTarget", event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-200 p-1" /></label></div><SliderRow label={copy.tolerance} resetLabel={labels.resetSetting} value={adjustments.replaceTolerance} min={1} max={100} resetValue={20} onChange={(value) => setValue("replaceTolerance", value)} /><SliderRow label={copy.replaceStrength} resetLabel={labels.resetSetting} value={adjustments.replaceStrength} min={0} max={100} resetValue={100} onChange={(value) => setValue("replaceStrength", value)} /></div> : null}
              {submenu === "channels" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.channels}</h3><SliderRow label={copy.redChannel} resetLabel={labels.resetSetting} value={adjustments.redChannel} onChange={(value) => setValue("redChannel", value)} /><SliderRow label={copy.greenChannel} resetLabel={labels.resetSetting} value={adjustments.greenChannel} onChange={(value) => setValue("greenChannel", value)} /><SliderRow label={copy.blueChannel} resetLabel={labels.resetSetting} value={adjustments.blueChannel} onChange={(value) => setValue("blueChannel", value)} /></div> : null}
              {submenu === "recolor" ? <div className="space-y-4"><h3 className="text-sm font-semibold text-slate-800">{copy.recolor}</h3><div className="grid grid-cols-4 gap-1 rounded-md bg-slate-100 p-1">{(["color", "grayscale", "sepia", "monochrome"] as const).map((mode) => <button key={mode} type="button" onClick={() => setValue("recolorMode", mode)} className={`h-9 rounded text-[10px] font-semibold ${adjustments.recolorMode === mode ? "bg-white text-[#2f65cf] shadow-sm" : "text-slate-500"}`}>{copy[mode]}</button>)}</div>{adjustments.recolorMode === "monochrome" ? <input type="color" value={adjustments.monochromeColor} onChange={(event) => setValue("monochromeColor", event.target.value)} className="h-9 w-full rounded-md border border-slate-200 p-1" /> : null}</div> : null}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-4"><button type="button" disabled={unchanged} onClick={() => setAdjustments(DEFAULT_COLOR_ADJUSTMENTS)} className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-[#2f65cf] hover:bg-blue-50 disabled:text-slate-300"><FiRotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{labels.resetAll}</button><div className="flex gap-2"><button type="button" onClick={onClose} disabled={working} className="h-9 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">{labels.cancel}</button><button type="button" disabled={unchanged || working} onClick={() => { setWorking(true); setError(null); void adjustRoomImage(new File([image.blob], image.name, { type: image.type }), adjustments).then((result) => onSave(image, result)).catch((reason) => setError(reason instanceof Error ? reason.message : labels.colorAdjustmentFailed)).finally(() => setWorking(false)); }} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:opacity-50">{working ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{working ? labels.processing : labels.generateResult}</button></div></footer>
        {error ? <p className="border-t border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">{error}</p> : null}
      </section>
    </div>
  );
}
