"use client";

import React from "react";
import { FiRotateCcw, FiTrash2 } from "react-icons/fi";
import {
  buildToneCurveLut,
  type ToneCurvePoint,
} from "../../../utils/room-color-adjustments";
import type { ShareRoomLabels } from "../share-room-labels";

type ToneCurveEditorProps = {
  points: ToneCurvePoint[];
  labels: ShareRoomLabels;
  onChange(points: ToneCurvePoint[]): void;
};

const WIDTH = 300;
const HEIGHT = 210;
const MIN_POINT_GAP = 0.025;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export default function ToneCurveEditor({ points, labels, onChange }: ToneCurveEditorProps) {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const dragIndexRef = React.useRef<number | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const sorted = React.useMemo(() => [...points].sort((a, b) => a.x - b.x), [points]);
  const lut = React.useMemo(() => buildToneCurveLut(sorted), [sorted]);
  const path = React.useMemo(() => {
    const coordinates: string[] = [];
    for (let index = 0; index < 256; index += 3) {
      coordinates.push(`${index / 255 * WIDTH},${HEIGHT - lut[index] / 255 * HEIGHT}`);
    }
    coordinates.push(`${WIDTH},${HEIGHT - lut[255] / 255 * HEIGHT}`);
    return `M ${coordinates.join(" L ")}`;
  }, [lut]);

  React.useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= sorted.length) setSelectedIndex(null);
  }, [selectedIndex, sorted.length]);

  const pointerPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp((clientX - rect.left) / rect.width),
      y: clamp(1 - (clientY - rect.top) / rect.height),
    };
  };

  const movePoint = (index: number, clientX: number, clientY: number) => {
    const pointer = pointerPoint(clientX, clientY);
    const next = [...sorted];
    const endpoint = index === 0 || index === next.length - 1;
    next[index] = {
      x: endpoint
        ? next[index].x
        : clamp(pointer.x, next[index - 1].x + MIN_POINT_GAP, next[index + 1].x - MIN_POINT_GAP),
      y: pointer.y,
    };
    onChange(next);
  };

  const canDelete = selectedIndex !== null && selectedIndex > 0 && selectedIndex < sorted.length - 1;
  return (
    <div className="select-none overflow-hidden rounded-md border border-slate-200 bg-slate-950">
      <div className="flex h-9 items-center justify-end gap-1 border-b border-white/10 px-2">
        <button type="button" disabled={!canDelete} onClick={() => { if (!canDelete || selectedIndex === null) return; onChange(sorted.filter((_, index) => index !== selectedIndex)); setSelectedIndex(null); }} className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-25" aria-label={labels.colorTools.deleteCurvePoint} title={labels.colorTools.deletePoint}><FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
        <button type="button" disabled={sorted.length === 2 && sorted[0].y === 0 && sorted[1].y === 1} onClick={() => { onChange([{ x: 0, y: 0 }, { x: 1, y: 1 }]); setSelectedIndex(null); }} className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-25" aria-label={labels.colorTools.resetCurve} title={labels.colorTools.resetCurve}><FiRotateCcw className="h-3.5 w-3.5" aria-hidden="true" /></button>
      </div>
      <div className="p-2">
        <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="block aspect-[10/7] w-full touch-none select-none cursor-crosshair rounded-sm ring-1 ring-white/10"
            style={{ WebkitUserSelect: "none", userSelect: "none" }}
            aria-label={labels.colorTools.curveInput}
            onPointerMove={(event) => {
              if (dragIndexRef.current !== null) movePoint(dragIndexRef.current, event.clientX, event.clientY);
            }}
            onPointerUp={() => { dragIndexRef.current = null; }}
            onPointerCancel={() => { dragIndexRef.current = null; }}
            onPointerDown={(event) => {
              event.preventDefault();
              if (event.target !== event.currentTarget || sorted.length >= 12) return;
              const point = pointerPoint(event.clientX, event.clientY);
              const next = [...sorted, point].sort((a, b) => a.x - b.x);
              onChange(next);
              setSelectedIndex(next.findIndex((item) => item === point));
            }}
          >
            <defs><linearGradient id="curve-background" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#020617" /><stop offset="1" stopColor="#334155" /></linearGradient></defs>
            <rect width={WIDTH} height={HEIGHT} fill="url(#curve-background)" pointerEvents="none" />
            {[0.25, 0.5, 0.75].map((position) => <React.Fragment key={position}><line x1={WIDTH * position} y1={0} x2={WIDTH * position} y2={HEIGHT} stroke="rgba(255,255,255,.12)" strokeWidth="1" pointerEvents="none" /><line x1={0} y1={HEIGHT * position} x2={WIDTH} y2={HEIGHT * position} stroke="rgba(255,255,255,.12)" strokeWidth="1" pointerEvents="none" /></React.Fragment>)}
            <line x1={0} y1={HEIGHT} x2={WIDTH} y2={0} stroke="rgba(255,255,255,.22)" strokeDasharray="5 5" pointerEvents="none" />
            <g fill="rgba(226,232,240,.62)" fontSize="9" fontWeight="500" pointerEvents="none">
              <text x="7" y="13">Y {labels.colorTools.curveOutput}</text>
              <text x={WIDTH - 7} y="13" textAnchor="end">X {labels.colorTools.curveInputTone}</text>
              <text x="7" y="27">{labels.colorTools.curveLight}</text>
              <text x="7" y={HEIGHT / 2 + 3}>{labels.colorTools.curveMid}</text>
              <text x="7" y={HEIGHT - 19}>{labels.colorTools.curveDark}</text>
              <text x="7" y={HEIGHT - 6}>{labels.colorTools.shadows}</text>
              <text x={WIDTH / 2} y={HEIGHT - 6} textAnchor="middle">{labels.colorTools.curveMid}</text>
              <text x={WIDTH - 7} y={HEIGHT - 6} textAnchor="end">{labels.colorTools.highlights}</text>
            </g>
            <path d={path} fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
            {sorted.map((point, index) => (
              <circle
                key={`${index}-${point.x}`}
                cx={point.x * WIDTH}
                cy={(1 - point.y) * HEIGHT}
                r={selectedIndex === index ? 6 : 5}
                fill={selectedIndex === index ? "#2f65cf" : "#ffffff"}
                stroke="#60a5fa"
                strokeWidth="2"
                className="cursor-move"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  dragIndexRef.current = index;
                  setSelectedIndex(index);
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (index > 0 && index < sorted.length - 1) {
                    onChange(sorted.filter((_, pointIndex) => pointIndex !== index));
                    setSelectedIndex(null);
                  }
                }}
              />
            ))}
        </svg>
      </div>
    </div>
  );
}
