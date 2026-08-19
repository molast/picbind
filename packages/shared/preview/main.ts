import "./style.css";
import {
  MipPlayer,
  createMotionIntent,
  emojiToSvg,
  serializeMotionIntent,
  type MipEasing,
  type MipInstruction,
  type MipMotionFrame,
  type MipMotionSegment,
  type MipPathAnchor,
  type MipPoint,
  type MipTiming,
  type MipTimeline,
} from "../src";

function requiredElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing preview element: ${selector}`);
  return element;
}

const stage = requiredElement<HTMLElement>("#mip-stage");
const emojiInput = requiredElement<HTMLInputElement>("#emoji-input");
const durationInput = requiredElement<HTMLInputElement>("#duration-input");
const delayInput = requiredElement<HTMLInputElement>("#delay-input");
const repeatInput = requiredElement<HTMLInputElement>("#repeat-input");
const loopInput = requiredElement<HTMLInputElement>("#loop-input");
const easingInput = requiredElement<HTMLSelectElement>("#easing-input");
const colorInput = requiredElement<HTMLInputElement>("#color-input");
const protocolOutput = requiredElement<HTMLElement>("#protocol-output");
const svgOutput = requiredElement<HTMLElement>("#svg-output");
const svgSize = requiredElement<HTMLElement>("#svg-size");
const assetPreview = requiredElement<HTMLImageElement>("#asset-preview");
const statusText = requiredElement<HTMLElement>("#status-text");
const statusDot = requiredElement<HTMLElement>("#status-dot");
const previewViewport = requiredElement<HTMLElement>("#preview-viewport");
const previewSelection = requiredElement<HTMLElement>("#preview-selection");
const selectPreviewButton = requiredElement<HTMLButtonElement>("#select-preview-button");
const timelineEnabled = requiredElement<HTMLInputElement>("#timeline-enabled");
const controlsPanel = requiredElement<HTMLElement>(".controls");
const motionFramesControl = requiredElement<HTMLElement>(".motion-frames-control");
const perSegmentModules = requiredElement<HTMLElement>("#per-segment-modules");
const frameStrip = requiredElement<HTMLElement>("#frame-strip");
const segmentList = requiredElement<HTMLElement>("#segment-list");
const segmentActions = requiredElement<HTMLElement>("#segment-actions");
const perSegmentActions = requiredElement<HTMLElement>("#per-segment-actions");
const addSegmentButton = requiredElement<HTMLButtonElement>("#add-segment");
const removeSegmentButton = requiredElement<HTMLButtonElement>("#remove-segment");
const curveEditor = requiredElement<SVGSVGElement>("#curve-editor");
const curvePath = requiredElement<SVGPathElement>("#curve-path");
const curveControlLine = requiredElement<SVGPathElement>("#curve-control-line");
const curveFrameHandles = requiredElement<SVGGElement>("#curve-frame-handles");
const curveGuideX = requiredElement<SVGLineElement>("#curve-guide-x");
const curveGuideY = requiredElement<SVGLineElement>("#curve-guide-y");
const curveSegmentLabel = requiredElement<HTMLElement>("#curve-segment-label");
const deleteAnchorButton = requiredElement<HTMLButtonElement>("#delete-anchor-button");
const curveEditTool = requiredElement<HTMLButtonElement>("#curve-edit-tool");
const curvePanTool = requiredElement<HTMLButtonElement>("#curve-pan-tool");
const player = new MipPlayer(previewViewport, { assetSize: 104 });
const MAX_SEGMENTS = 26;
const segmentEditorSections = [
  motionFramesControl,
  ...[...document.querySelectorAll<HTMLElement>(".controls > .control-section")].filter(
    (section) =>
      !section.classList.contains("asset-control") &&
      !section.classList.contains("motion-frames-control"),
  ),
];

const INITIAL_FRAMES: MipMotionFrame[] = [
  { id: "frame-a", label: "A", position: { x: -180, y: 110 } },
  { id: "frame-b", label: "B", position: { x: -25, y: -115 } },
];
const INITIAL_SEGMENTS: MipMotionSegment[] = [
  {
    id: "segment-a-b",
    from: "frame-a",
    to: "frame-b",
    motion: "bezier",
    duration: 900,
    easing: "easeOut",
    control1: { x: -155, y: -80 },
    control2: { x: -80, y: -155 },
  },
];
const frames: MipMotionFrame[] = structuredClone(INITIAL_FRAMES);
const segments: MipMotionSegment[] = structuredClone(INITIAL_SEGMENTS);
let activeSegmentId = segments[0].id;
let activeAnchorIndex = 0;
let selectedAnchorId: string | null = null;
type AnimationMode = "synchronized" | "perSegment";
let animationMode: AnimationMode = "synchronized";
const synchronizedCommands = new Set<string>();
const segmentCommands = new Map<string, Set<string>>();
type AnimationSettings = {
  duration: number;
  delay: number;
  repeat: number;
  loop: boolean;
  easing: MipEasing;
  color: string;
};
const synchronizedSettings: AnimationSettings = {
  duration: 2200,
  delay: 0,
  repeat: 0,
  loop: false,
  easing: "easeOut",
  color: "#22d3ee",
};
const segmentSettings = new Map<string, AnimationSettings>();
type DraggedHandle =
  | { kind: "anchor"; anchorId: string }
  | { kind: "control1" | "control2"; segmentId: string; anchorIndex: number }
  | {
      kind: "path";
      segmentId: string;
      start: MipPoint;
      anchors: Array<{
        id: string;
        position: MipPoint;
        controlIn?: MipPoint;
        controlOut?: MipPoint;
      }>;
    };
let draggedHandle: DraggedHandle | null = null;
let draggedPointerId: number | null = null;
type CurveToolMode = "edit" | "pan";
let curveToolMode: CurveToolMode = "edit";
const ALIGNMENT_SNAP_DISTANCE = 5;
type PreviewRegion = { x: number; y: number; width: number; height: number };
type PreviewResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type PreviewResizeState = {
  handle: PreviewResizeHandle;
  pointerId: number;
  startPointer: MipPoint;
  startRegion: PreviewRegion;
};
let previewRegion: PreviewRegion | null = null;
let previewSelectionStart: MipPoint | null = null;
let previewSelectionPointerId: number | null = null;
let previewSelectionMode = false;
let previewResizeState: PreviewResizeState | null = null;
const MIN_PREVIEW_REGION_SIZE = 40;

function stagePoint(event: PointerEvent): MipPoint {
  const bounds = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
    y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
  };
}

function regionFromPoints(start: MipPoint, end: MipPoint): PreviewRegion {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function resizedPreviewRegion(state: PreviewResizeState, pointer: MipPoint) {
  const deltaX = pointer.x - state.startPointer.x;
  const deltaY = pointer.y - state.startPointer.y;
  let left = state.startRegion.x;
  let top = state.startRegion.y;
  let right = state.startRegion.x + state.startRegion.width;
  let bottom = state.startRegion.y + state.startRegion.height;

  if (state.handle.includes("w")) {
    left = Math.max(0, Math.min(right - MIN_PREVIEW_REGION_SIZE, left + deltaX));
  }
  if (state.handle.includes("e")) {
    right = Math.min(
      stage.clientWidth,
      Math.max(left + MIN_PREVIEW_REGION_SIZE, right + deltaX),
    );
  }
  if (state.handle.includes("n")) {
    top = Math.max(0, Math.min(bottom - MIN_PREVIEW_REGION_SIZE, top + deltaY));
  }
  if (state.handle.includes("s")) {
    bottom = Math.min(
      stage.clientHeight,
      Math.max(top + MIN_PREVIEW_REGION_SIZE, bottom + deltaY),
    );
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function normalizedRegion(region: PreviewRegion): PreviewRegion {
  return {
    x: region.x / Math.max(1, stage.clientWidth),
    y: region.y / Math.max(1, stage.clientHeight),
    width: region.width / Math.max(1, stage.clientWidth),
    height: region.height / Math.max(1, stage.clientHeight),
  };
}

function pixelRegion(region: PreviewRegion): PreviewRegion {
  return {
    x: region.x * stage.clientWidth,
    y: region.y * stage.clientHeight,
    width: region.width * stage.clientWidth,
    height: region.height * stage.clientHeight,
  };
}

function positionSelection(region: PreviewRegion) {
  previewSelection.hidden = false;
  previewSelection.style.left = `${region.x}px`;
  previewSelection.style.top = `${region.y}px`;
  previewSelection.style.width = `${region.width}px`;
  previewSelection.style.height = `${region.height}px`;
}

function applyPreviewRegion() {
  if (!previewRegion) {
    previewViewport.style.inset = "0";
    previewViewport.style.width = "auto";
    previewViewport.style.height = "auto";
    previewSelection.hidden = true;
    return;
  }
  const region = pixelRegion(previewRegion);
  previewViewport.style.inset = "auto";
  previewViewport.style.left = `${region.x}px`;
  previewViewport.style.top = `${region.y}px`;
  previewViewport.style.width = `${region.width}px`;
  previewViewport.style.height = `${region.height}px`;
  positionSelection(region);
}

function buildPreviewViewport() {
  if (!previewRegion) return undefined;
  const region = pixelRegion(previewRegion);
  return {
    width: Math.max(1, Math.round(region.width)),
    height: Math.max(1, Math.round(region.height)),
  };
}

function setPreviewSelectionMode(active: boolean) {
  previewSelectionMode = active;
  selectPreviewButton.classList.toggle("active", active);
  selectPreviewButton.setAttribute("aria-pressed", String(active));
  stage.classList.toggle("selecting-preview", active);
  if (!active) {
    previewSelectionStart = null;
    previewSelectionPointerId = null;
    applyPreviewRegion();
  }
}

type SystemPathName = "circle" | "square" | "heart" | "wave";

type SystemPathPreset = {
  frames: MipMotionFrame[];
  segments: MipMotionSegment[];
};

function pathFrame(path: SystemPathName, index: number, x: number, y: number): MipMotionFrame {
  return {
    id: `system-${path}-frame-${index}`,
    label: frameLabel(index),
    position: { x, y },
  };
}

function pathSegment(
  path: SystemPathName,
  index: number,
  motion: "line" | "bezier",
  duration: number,
  easing: MipEasing,
  control1?: MipPoint,
  control2?: MipPoint,
): MipMotionSegment {
  return {
    id: `system-${path}-segment-${index}`,
    from: `system-${path}-frame-${index}`,
    to: `system-${path}-frame-${index + 1}`,
    motion,
    duration,
    easing,
    ...(control1 ? { control1 } : {}),
    ...(control2 ? { control2 } : {}),
  };
}

function createSystemPath(path: SystemPathName): SystemPathPreset {
  if (path === "circle") {
    const points = [
      [0, -110],
      [110, 0],
      [0, 110],
      [-110, 0],
      [0, -110],
    ] as const;
    const controls = [
      [{ x: 60.75, y: -110 }, { x: 110, y: -60.75 }],
      [{ x: 110, y: 60.75 }, { x: 60.75, y: 110 }],
      [{ x: -60.75, y: 110 }, { x: -110, y: 60.75 }],
      [{ x: -110, y: -60.75 }, { x: -60.75, y: -110 }],
    ] as const;
    return {
      frames: points.map(([x, y], index) => pathFrame(path, index, x, y)),
      segments: controls.map(([control1, control2], index) =>
        pathSegment(path, index, "bezier", 550, "linear", control1, control2),
      ),
    };
  }

  if (path === "square") {
    const points = [
      [-105, -105],
      [105, -105],
      [105, 105],
      [-105, 105],
      [-105, -105],
    ] as const;
    return {
      frames: points.map(([x, y], index) => pathFrame(path, index, x, y)),
      segments: points.slice(0, -1).map((_, index) =>
        pathSegment(path, index, "line", 500, "linear"),
      ),
    };
  }

  if (path === "heart") {
    const points = [
      [0, 115],
      [-110, -25],
      [0, -75],
      [110, -25],
      [0, 115],
    ] as const;
    const controls = [
      [{ x: -38, y: 70 }, { x: -110, y: 35 }],
      [{ x: -110, y: -100 }, { x: -36, y: -105 }],
      [{ x: 36, y: -105 }, { x: 110, y: -100 }],
      [{ x: 110, y: 35 }, { x: 38, y: 70 }],
    ] as const;
    return {
      frames: points.map(([x, y], index) => pathFrame(path, index, x, y)),
      segments: controls.map(([control1, control2], index) =>
        pathSegment(path, index, "bezier", 600, "ease", control1, control2),
      ),
    };
  }

  const points = [
    [-190, 0],
    [-65, 0],
    [65, 0],
    [190, 0],
  ] as const;
  const controls = [
    [{ x: -155, y: -110 }, { x: -100, y: -110 }],
    [{ x: -30, y: 110 }, { x: 30, y: 110 }],
    [{ x: 100, y: -110 }, { x: 155, y: -110 }],
  ] as const;
  return {
    frames: points.map(([x, y], index) => pathFrame(path, index, x, y)),
    segments: controls.map(([control1, control2], index) =>
      pathSegment(path, index, "bezier", 650, "ease", control1, control2),
    ),
  };
}

function segmentLabel(segment: MipMotionSegment) {
  const index = Math.max(0, segments.findIndex((item) => item.id === segment.id));
  return frameLabel(index);
}

function ensureSegmentAnchors(segment: MipMotionSegment) {
  const label = segmentLabel(segment);
  if (segment.anchors && segment.anchors.length >= 2) {
    segment.anchors.forEach((anchor, index) => (anchor.label = `${label}${index + 1}`));
    return segment.anchors;
  }
  const start = frameById(segment.from);
  const end = frameById(segment.to);
  if (!start || !end) return [];
  segment.anchors = [
    {
      id: `anchor-${crypto.randomUUID()}`,
      label: `${label}1`,
      position: { ...start.position },
      motionToNext: segment.motion,
      ...(segment.control1 ? { controlOut: { ...segment.control1 } } : {}),
    },
    {
      id: `anchor-${crypto.randomUUID()}`,
      label: `${label}2`,
      position: { ...end.position },
      ...(segment.control2 ? { controlIn: { ...segment.control2 } } : {}),
    },
  ];
  return segment.anchors;
}

function replaceCurrentPath(path: SystemPathName) {
  const preset = createSystemPath(path);
  const segment = activeSegment();
  const label = segmentLabel(segment);
  const anchors: MipPathAnchor[] = preset.frames.map((frame, index) => ({
    id: `anchor-${crypto.randomUUID()}`,
    label: `${label}${index + 1}`,
    position: { ...frame.position },
  }));
  preset.segments.forEach((pathSegment, index) => {
    anchors[index].motionToNext = pathSegment.motion;
    if (pathSegment.control1) {
      anchors[index].controlOut = { ...pathSegment.control1 };
    }
    if (pathSegment.control2) {
      anchors[index + 1].controlIn = { ...pathSegment.control2 };
    }
  });
  segment.anchors = anchors;
  segment.motion = preset.segments[0]?.motion ?? "bezier";
  segment.control1 = anchors[0].controlOut ? { ...anchors[0].controlOut } : undefined;
  segment.control2 = anchors[1].controlIn ? { ...anchors[1].controlIn } : undefined;
  activeAnchorIndex = 0;
  selectedAnchorId = null;
  timelineEnabled.checked = true;
  syncTimelineMode();
  renderTimelineEditor();
  refreshInspector();
}

function frameLabel(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function resetTimeline() {
  frames.splice(0, frames.length, ...structuredClone(INITIAL_FRAMES));
  segments.splice(0, segments.length, ...structuredClone(INITIAL_SEGMENTS));
  synchronizedCommands.clear();
  segmentCommands.clear();
  segmentSettings.clear();
  Object.assign(synchronizedSettings, {
    duration: 2200,
    delay: 0,
    repeat: 0,
    loop: false,
    easing: "easeOut",
    color: "#22d3ee",
  });
  activeSegmentId = segments[0].id;
  activeAnchorIndex = 0;
  selectedAnchorId = null;
}

function frameById(id: string) {
  return frames.find((frame) => frame.id === id);
}

function activeSegment() {
  return segments.find((segment) => segment.id === activeSegmentId) ?? segments[0];
}

function defaultControls(start: MipMotionFrame, end: MipMotionFrame) {
  const dx = end.position.x - start.position.x;
  const dy = end.position.y - start.position.y;
  return {
    control1: {
      x: start.position.x + dx / 3 - dy * 0.28,
      y: start.position.y + dy / 3 + dx * 0.28,
    },
    control2: {
      x: start.position.x + (dx * 2) / 3 + dy * 0.28,
      y: start.position.y + (dy * 2) / 3 - dx * 0.28,
    },
  };
}

function ensureControls(segment: MipMotionSegment) {
  if (segment.control1 && segment.control2) return;
  const start = frameById(segment.from);
  const end = frameById(segment.to);
  if (!start || !end) return;
  Object.assign(segment, defaultControls(start, end));
}

function buildTimeline(): MipTimeline | undefined {
  if (!timelineEnabled.checked) return undefined;
  return {
    frames: frames.map((frame) => ({
      ...frame,
      position: { ...frame.position },
    })),
    segments: segments.map((segment) => {
      const commands = segmentCommands.get(segment.id) ?? new Set<string>();
      const settings = settingsForSegment(segment);
      return {
        ...segment,
        ...(segment.control1 ? { control1: { ...segment.control1 } } : {}),
        ...(segment.control2 ? { control2: { ...segment.control2 } } : {}),
        ...(segment.anchors
          ? {
              anchors: segment.anchors.map((anchor) => ({
                ...anchor,
                position: { ...anchor.position },
                ...(anchor.controlIn ? { controlIn: { ...anchor.controlIn } } : {}),
                ...(anchor.controlOut ? { controlOut: { ...anchor.controlOut } } : {}),
              })),
            }
          : {}),
        ...(animationMode === "perSegment"
          ? {
              instructions: buildInstructionsFor(
                commands,
                {
                  duration: settings.duration,
                  delay: settings.delay,
                  repeat: settings.repeat,
                  loop: settings.loop,
                  easing: settings.easing,
                },
                `segment.${segment.id}`,
                settings.color,
              ),
            }
          : {}),
      };
    }),
    delay: Math.max(0, Number(delayInput.value) || 0),
    loop: loopInput.checked,
  };
}

function timing(overrides: Partial<MipTiming> = {}): MipTiming {
  return {
    duration: Math.max(100, Number(durationInput.value) || 2200),
    delay: Math.max(0, Number(delayInput.value) || 0),
    repeat: Math.max(0, Number(repeatInput.value) || 0),
    loop: loopInput.checked,
    easing: easingInput.value as MipEasing,
    ...overrides,
  };
}

function selectedCommands() {
  return new Set(
    [...document.querySelectorAll<HTMLElement>("[data-command].active")]
      .map((button) => button.dataset.command)
      .filter((command): command is string => Boolean(command)),
  );
}

function readVisibleSettings(): AnimationSettings {
  return {
    duration: Math.max(100, Number(durationInput.value) || 2200),
    delay: Math.max(0, Number(delayInput.value) || 0),
    repeat: Math.max(0, Number(repeatInput.value) || 0),
    loop: loopInput.checked,
    easing: easingInput.value as MipEasing,
    color: colorInput.value,
  };
}

function settingsForSegment(segment: MipMotionSegment) {
  return (
    segmentSettings.get(segment.id) ?? {
      duration: Math.max(100, segment.duration),
      delay: 0,
      repeat: 0,
      loop: false,
      easing: segment.easing ?? "ease",
      color: synchronizedSettings.color,
    }
  );
}

function applyVisibleSettings(settings: AnimationSettings) {
  durationInput.value = String(settings.duration);
  delayInput.value = String(settings.delay);
  repeatInput.value = String(settings.repeat);
  loopInput.checked = settings.loop;
  easingInput.value = settings.easing;
  colorInput.value = settings.color;
}

function storeVisibleSettings() {
  const settings = readVisibleSettings();
  if (animationMode === "synchronized") {
    Object.assign(synchronizedSettings, settings);
  } else {
    segmentSettings.set(activeSegmentId, settings);
  }
}

function storeVisibleCommands() {
  const selected = selectedCommands();
  if (animationMode === "synchronized") {
    synchronizedCommands.clear();
    selected.forEach((command) => synchronizedCommands.add(command));
  } else {
    segmentCommands.set(activeSegmentId, selected);
  }
}

function showCommandsForCurrentMode() {
  const commands =
    animationMode === "synchronized"
      ? synchronizedCommands
      : (segmentCommands.get(activeSegmentId) ?? new Set<string>());
  setCommands([...commands]);
  applyVisibleSettings(
    animationMode === "synchronized"
      ? synchronizedSettings
      : settingsForSegment(activeSegment()),
  );
}

function updateAddSegmentPlacement() {
  if (animationMode === "perSegment") {
    perSegmentActions.hidden = false;
    perSegmentActions.appendChild(addSegmentButton);
    return;
  }
  segmentActions.insertBefore(addSegmentButton, removeSegmentButton);
  perSegmentActions.hidden = true;
}

function renderAnimationModeLayout() {
  segmentEditorSections.forEach((section) => section.remove());
  perSegmentModules.replaceChildren();

  if (animationMode === "synchronized") {
    perSegmentModules.hidden = true;
    frameStrip.hidden = false;
    segmentEditorSections.forEach((section) => controlsPanel.appendChild(section));
    updateAddSegmentPlacement();
    return;
  }

  perSegmentModules.hidden = false;
  frameStrip.hidden = true;
  segments.forEach((segment) => {
    const article = document.createElement("section");
    article.className = `per-segment-module${segment.id === activeSegmentId ? " active" : ""}`;
    article.dataset.segmentModule = segment.id;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "per-segment-module-header";
    header.innerHTML = `<span>Segment ${segmentLabel(segment)}</span><span>${ensureSegmentAnchors(segment).length} anchors</span>`;
    header.setAttribute("aria-expanded", String(segment.id === activeSegmentId));
    header.addEventListener("click", () => {
      if (segment.id === activeSegmentId) return;
      activeSegmentId = segment.id;
      activeAnchorIndex = 0;
      showCommandsForCurrentMode();
      renderTimelineEditor();
      refreshInspector();
    });
    article.appendChild(header);

    if (segment.id === activeSegmentId) {
      const body = document.createElement("div");
      body.className = "per-segment-module-body";
      segmentEditorSections.forEach((section) => body.appendChild(section));
      article.appendChild(body);
    }
    perSegmentModules.appendChild(article);
  });
  updateAddSegmentPlacement();
}

function editorPoint(point: { x: number; y: number }) {
  const scale = Math.min(260 / 440, 150 / 320);
  return {
    x: 130 + point.x * scale,
    y: 75 + point.y * scale,
  };
}

function worldPoint(point: { x: number; y: number }) {
  const scale = Math.min(260 / 440, 150 / 320);
  return {
    x: (point.x - 130) / scale,
    y: (point.y - 75) / scale,
  };
}

function curveEventEditorPoint(event: PointerEvent) {
  const rect = curveEditor.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(260, ((event.clientX - rect.left) / rect.width) * 260)),
    y: Math.max(0, Math.min(150, ((event.clientY - rect.top) / rect.height) * 150)),
  };
}

function syncSegmentControlsFromAnchors(segment: MipMotionSegment) {
  const anchors = ensureSegmentAnchors(segment);
  segment.motion = anchors[0]?.motionToNext ?? segment.motion;
  segment.control1 = anchors[0]?.controlOut
    ? { ...anchors[0].controlOut }
    : undefined;
  segment.control2 = anchors[1]?.controlIn
    ? { ...anchors[1].controlIn }
    : undefined;
}

function appendAnchorAt(position: MipPoint) {
  const segment = activeSegment();
  const anchors = ensureSegmentAnchors(segment);
  const previous = anchors[anchors.length - 1];
  const anchor: MipPathAnchor = {
    id: `anchor-${crypto.randomUUID()}`,
    label: "",
    position,
  };
  previous.motionToNext = segment.motion;
  if (segment.motion === "bezier") {
    const controls = defaultControls(
      { id: previous.id, label: previous.label, position: previous.position },
      { id: anchor.id, label: anchor.label, position: anchor.position },
    );
    previous.controlOut = controls.control1;
    anchor.controlIn = controls.control2;
  } else {
    previous.controlOut = undefined;
    anchor.controlIn = undefined;
  }
  anchors.push(anchor);
  activeAnchorIndex = anchors.length - 2;
  selectedAnchorId = anchor.id;
  ensureSegmentAnchors(segment);
  syncSegmentControlsFromAnchors(segment);
}

function deleteSelectedAnchor() {
  if (!selectedAnchorId) return;
  const segment = activeSegment();
  const anchors = ensureSegmentAnchors(segment);
  if (anchors.length <= 2) return;
  const index = anchors.findIndex((anchor) => anchor.id === selectedAnchorId);
  if (index < 0) return;
  const hadPrevious = index > 0;
  const hadNext = index < anchors.length - 1;
  anchors.splice(index, 1);

  if (hadPrevious && hadNext) {
    const previous = anchors[index - 1];
    const next = anchors[index];
    previous.motionToNext = segment.motion;
    if (segment.motion === "bezier") {
      const controls = defaultControls(
        { id: previous.id, label: previous.label, position: previous.position },
        { id: next.id, label: next.label, position: next.position },
      );
      previous.controlOut = controls.control1;
      next.controlIn = controls.control2;
    } else {
      previous.controlOut = undefined;
      next.controlIn = undefined;
    }
  }
  anchors[0].controlIn = undefined;
  const last = anchors[anchors.length - 1];
  last.controlOut = undefined;
  last.motionToNext = undefined;
  selectedAnchorId = null;
  activeAnchorIndex = Math.max(0, Math.min(index - 1, anchors.length - 2));
  ensureSegmentAnchors(segment);
  syncSegmentControlsFromAnchors(segment);
  renderTimelineEditor();
  refreshInspector();
}

function setCurveToolMode(mode: CurveToolMode) {
  curveToolMode = mode;
  const isEdit = mode === "edit";
  curveEditTool.classList.toggle("active", isEdit);
  curveEditTool.setAttribute("aria-pressed", String(isEdit));
  curvePanTool.classList.toggle("active", !isEdit);
  curvePanTool.setAttribute("aria-pressed", String(!isEdit));
  curveEditor.classList.toggle("pan-mode", !isEdit);
  draggedHandle = null;
  draggedPointerId = null;
  hideAlignmentGuides();
}

function setControlHandlePosition(handle: "control1" | "control2", pointValue: MipPoint) {
  const id = handle === "control1" ? "control-1" : "control-2";
  const converted = editorPoint(pointValue);
  [`#curve-${id}`, `#curve-${id}-hit`].forEach((selector) => {
    const circle = requiredElement<SVGCircleElement>(selector);
    circle.setAttribute("cx", String(converted.x));
    circle.setAttribute("cy", String(converted.y));
  });
}

function setHandleVisible(handle: "control1" | "control2", visible: boolean) {
  const id = handle === "control1" ? "control-1" : "control-2";
  requiredElement<SVGCircleElement>(`#curve-${id}`).style.display = visible ? "" : "none";
  requiredElement<SVGCircleElement>(`#curve-${id}-hit`).style.display = visible ? "" : "none";
}

function hideAlignmentGuides() {
  curveGuideX.style.display = "none";
  curveGuideY.style.display = "none";
}

function snapToOtherHandles(point: MipPoint, currentHandle: DraggedHandle) {
  const segment = activeSegment();
  const anchors = ensureSegmentAnchors(segment);
  const anchorReferences = anchors
    .filter((anchor) => currentHandle.kind !== "anchor" || anchor.id !== currentHandle.anchorId)
    .map((anchor) => anchor.position);
  const controlReferences = anchors.flatMap((anchor, index) => {
    const controls: MipPoint[] = [];
    if (
      anchor.controlOut &&
      !(
        currentHandle.kind === "control1" &&
        currentHandle.segmentId === segment.id &&
        currentHandle.anchorIndex === index
      )
    ) controls.push(anchor.controlOut);
    if (
      anchor.controlIn &&
      !(
        currentHandle.kind === "control2" &&
        currentHandle.segmentId === segment.id &&
        currentHandle.anchorIndex + 1 === index
      )
    ) controls.push(anchor.controlIn);
    return controls;
  });
  const references = [...anchorReferences, ...controlReferences].map(editorPoint);
  const snapped = { ...point };
  let closestX: number | null = null;
  let closestY: number | null = null;
  let xDistance = ALIGNMENT_SNAP_DISTANCE + 1;
  let yDistance = ALIGNMENT_SNAP_DISTANCE + 1;

  references.forEach((reference) => {
    const nextXDistance = Math.abs(point.x - reference.x);
    if (nextXDistance <= ALIGNMENT_SNAP_DISTANCE && nextXDistance < xDistance) {
      closestX = reference.x;
      xDistance = nextXDistance;
    }
    const nextYDistance = Math.abs(point.y - reference.y);
    if (nextYDistance <= ALIGNMENT_SNAP_DISTANCE && nextYDistance < yDistance) {
      closestY = reference.y;
      yDistance = nextYDistance;
    }
  });

  if (closestX !== null) {
    snapped.x = closestX;
    curveGuideX.setAttribute("x1", String(closestX));
    curveGuideX.setAttribute("x2", String(closestX));
    curveGuideX.style.display = "inline";
  } else {
    curveGuideX.style.display = "none";
  }
  if (closestY !== null) {
    snapped.y = closestY;
    curveGuideY.setAttribute("y1", String(closestY));
    curveGuideY.setAttribute("y2", String(closestY));
    curveGuideY.style.display = "inline";
  } else {
    curveGuideY.style.display = "none";
  }

  return snapped;
}

function snapPathTranslation(
  handle: Extract<DraggedHandle, { kind: "path" }>,
  pointer: MipPoint,
) {
  const delta = {
    x: pointer.x - handle.start.x,
    y: pointer.y - handle.start.y,
  };
  const movedPoints = handle.anchors.map((anchor) =>
    editorPoint({
      x: anchor.position.x + delta.x,
      y: anchor.position.y + delta.y,
    }),
  );
  const xs = movedPoints.map((point) => point.x);
  const ys = movedPoints.map((point) => point.y);
  movedPoints.push({
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  });

  const verticalAxis = 130;
  const horizontalAxis = 75;
  const nearestX = movedPoints.reduce(
    (nearest, point) =>
      Math.abs(point.x - verticalAxis) < Math.abs(nearest - verticalAxis)
        ? point.x
        : nearest,
    movedPoints[0].x,
  );
  const nearestY = movedPoints.reduce(
    (nearest, point) =>
      Math.abs(point.y - horizontalAxis) < Math.abs(nearest - horizontalAxis)
        ? point.y
        : nearest,
    movedPoints[0].y,
  );
  const editorScale = Math.min(260 / 440, 150 / 320);

  if (Math.abs(nearestX - verticalAxis) <= ALIGNMENT_SNAP_DISTANCE) {
    delta.x += (verticalAxis - nearestX) / editorScale;
    curveGuideX.setAttribute("x1", String(verticalAxis));
    curveGuideX.setAttribute("x2", String(verticalAxis));
    curveGuideX.style.display = "inline";
  } else {
    curveGuideX.style.display = "none";
  }
  if (Math.abs(nearestY - horizontalAxis) <= ALIGNMENT_SNAP_DISTANCE) {
    delta.y += (horizontalAxis - nearestY) / editorScale;
    curveGuideY.setAttribute("y1", String(horizontalAxis));
    curveGuideY.setAttribute("y2", String(horizontalAxis));
    curveGuideY.style.display = "inline";
  } else {
    curveGuideY.style.display = "none";
  }
  return delta;
}

function renderFrameHandles(segment: MipMotionSegment) {
  const namespace = "http://www.w3.org/2000/svg";
  curveFrameHandles.replaceChildren();
  const anchors = ensureSegmentAnchors(segment);
  anchors.forEach((anchor, index) => {
    const point = editorPoint(anchor.position);
    const hit = document.createElementNS(namespace, "circle");
    hit.classList.add("curve-handle-hit");
    hit.setAttribute("r", "13");
    hit.setAttribute("cx", String(point.x));
    hit.setAttribute("cy", String(point.y));
    hit.dataset.handle = "anchor";
    hit.dataset.anchorId = anchor.id;
    hit.dataset.anchorIndex = String(index);

    const visual = document.createElementNS(namespace, "circle");
    visual.classList.add("curve-handle-visual", "curve-frame-visual");
    if (index === activeAnchorIndex || index === activeAnchorIndex + 1) {
      visual.classList.add("active");
    }
    if (anchor.id === selectedAnchorId) {
      visual.classList.add("selected");
    }
    visual.setAttribute("r", "5");
    visual.setAttribute("cx", String(point.x));
    visual.setAttribute("cy", String(point.y));
    const label = document.createElementNS(namespace, "text");
    label.classList.add("curve-anchor-label");
    label.setAttribute("x", String(point.x + 7));
    label.setAttribute("y", String(point.y - 7));
    label.textContent = anchor.label;
    curveFrameHandles.append(hit, visual, label);
  });
}

function updateCurveEditor() {
  const segment = activeSegment();
  if (!segment) return;
  ensureControls(segment);
  const anchors = ensureSegmentAnchors(segment);
  if (anchors.length < 2) return;
  if (selectedAnchorId && !anchors.some((anchor) => anchor.id === selectedAnchorId)) {
    selectedAnchorId = null;
  }
  deleteAnchorButton.hidden = !selectedAnchorId;
  deleteAnchorButton.disabled = anchors.length <= 2;
  activeAnchorIndex = Math.min(activeAnchorIndex, anchors.length - 2);
  const activeStart = anchors[activeAnchorIndex];
  const activeEnd = anchors[activeAnchorIndex + 1];
  const startPoint = editorPoint(activeStart.position);
  const endPoint = editorPoint(activeEnd.position);
  const control1 = editorPoint(activeStart.controlOut ?? activeStart.position);
  const control2 = editorPoint(activeEnd.controlIn ?? activeEnd.position);
  const isBezier = (activeStart.motionToNext ?? segment.motion) === "bezier";
  curveSegmentLabel.textContent = `${segmentLabel(segment)} · ${anchors.length} anchors`;

  let path = `M ${editorPoint(anchors[0].position).x} ${editorPoint(anchors[0].position).y} `;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const from = anchors[index];
    const to = anchors[index + 1];
    const toPoint = editorPoint(to.position);
    if ((from.motionToNext ?? segment.motion) === "bezier" && from.controlOut && to.controlIn) {
      const fromControl = editorPoint(from.controlOut);
      const toControl = editorPoint(to.controlIn);
      path += `C ${fromControl.x} ${fromControl.y}, ${toControl.x} ${toControl.y}, ${toPoint.x} ${toPoint.y} `;
    } else {
      path += `L ${toPoint.x} ${toPoint.y} `;
    }
  }
  curvePath.setAttribute("d", path.trim());
  curveControlLine.setAttribute(
    "d",
    isBezier
      ? `M ${startPoint.x} ${startPoint.y} L ${control1.x} ${control1.y} M ${endPoint.x} ${endPoint.y} L ${control2.x} ${control2.y}`
      : "",
  );
  renderFrameHandles(segment);
  setControlHandlePosition("control1", activeStart.controlOut ?? activeStart.position);
  setControlHandlePosition("control2", activeEnd.controlIn ?? activeEnd.position);
  setHandleVisible("control1", isBezier);
  setHandleVisible("control2", isBezier);
}

function easingOptions(selected: MipEasing) {
  return ["linear", "ease", "easeIn", "easeOut", "bounce", "elastic"]
    .map(
      (value) =>
        `<option value="${value}"${value === selected ? " selected" : ""}>${value}</option>`,
    )
    .join("");
}

function segmentDisplayLabels() {
  return new Map(
    segments.map((segment, index) => [segment.id, frameLabel(index)]),
  );
}

function renderTimelineEditor() {
  frameStrip.replaceChildren();
  segments.forEach((segment, index) => {
    if (index > 0) {
      const connector = document.createElement("span");
      connector.className = "frame-connector";
      frameStrip.appendChild(connector);
    }
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `frame-chip${segment.id === activeSegmentId ? " active" : ""}`;
    chip.textContent = frameLabel(index);
    chip.title = `Segment ${frameLabel(index)} · ${ensureSegmentAnchors(segment).length} anchors`;
    chip.dataset.frameSegment = segment.id;
    chip.setAttribute("role", "option");
    chip.setAttribute("aria-selected", String(segment.id === activeSegmentId));
    frameStrip.appendChild(chip);
  });

  frameStrip.querySelectorAll<HTMLButtonElement>("[data-frame-segment]").forEach((button) => {
    button.addEventListener("click", () => {
      activeSegmentId = button.dataset.frameSegment ?? activeSegmentId;
      activeAnchorIndex = 0;
      showCommandsForCurrentMode();
      renderTimelineEditor();
    });
  });

  const displayLabels = segmentDisplayLabels();
  const visibleSegments =
    animationMode === "perSegment"
      ? segments.filter((segment) => segment.id === activeSegmentId)
      : segments;
  segmentList.innerHTML = visibleSegments
    .map((segment) => {
      const start = frameById(segment.from);
      const end = frameById(segment.to);
      return `<div class="segment-row${segment.id === activeSegmentId ? " active" : ""}" data-segment-id="${segment.id}">
        <button type="button" data-select-segment="${segment.id}" title="${start?.label ?? "?"} → ${end?.label ?? "?"}">${displayLabels.get(segment.id) ?? "A1"}</button>
        <select data-segment-motion="${segment.id}" aria-label="${start?.label} to ${end?.label} motion">
          <option value="line"${segment.motion === "line" ? " selected" : ""}>Line</option>
          <option value="bezier"${segment.motion === "bezier" ? " selected" : ""}>Bezier</option>
        </select>
        <span class="segment-duration"><input data-segment-duration="${segment.id}" type="number" min="50" step="50" value="${segment.duration}" aria-label="${start?.label} to ${end?.label} duration" />ms</span>
        <span></span>
        <select data-segment-easing="${segment.id}" aria-label="${start?.label} to ${end?.label} easing">${easingOptions(segment.easing ?? "ease")}</select>
      </div>`;
    })
    .join("");

  segmentList.querySelectorAll<HTMLButtonElement>("[data-select-segment]").forEach((button) => {
    button.addEventListener("click", () => {
      activeSegmentId = button.dataset.selectSegment ?? activeSegmentId;
      activeAnchorIndex = 0;
      showCommandsForCurrentMode();
      renderTimelineEditor();
    });
  });
  segmentList.querySelectorAll<HTMLSelectElement>("[data-segment-motion]").forEach((select) => {
    select.addEventListener("change", () => {
      const segment = segments.find((item) => item.id === select.dataset.segmentMotion);
      if (!segment) return;
      segment.motion = select.value === "line" ? "line" : "bezier";
      ensureControls(segment);
      const anchors = ensureSegmentAnchors(segment);
      anchors.slice(0, -1).forEach((anchor, index) => {
        anchor.motionToNext = segment.motion;
        if (segment.motion === "bezier" && (!anchor.controlOut || !anchors[index + 1].controlIn)) {
          const controls = defaultControls(
            { id: anchor.id, label: anchor.label, position: anchor.position },
            { id: anchors[index + 1].id, label: anchors[index + 1].label, position: anchors[index + 1].position },
          );
          anchor.controlOut = controls.control1;
          anchors[index + 1].controlIn = controls.control2;
        }
      });
      activeSegmentId = segment.id;
      updateCurveEditor();
      refreshInspector();
    });
  });
  segmentList.querySelectorAll<HTMLInputElement>("[data-segment-duration]").forEach((input) => {
    input.addEventListener("input", () => {
      const segment = segments.find((item) => item.id === input.dataset.segmentDuration);
      if (!segment) return;
      segment.duration = Math.max(50, Number(input.value) || 50);
      refreshInspector();
    });
  });
  segmentList.querySelectorAll<HTMLSelectElement>("[data-segment-easing]").forEach((select) => {
    select.addEventListener("change", () => {
      const segment = segments.find((item) => item.id === select.dataset.segmentEasing);
      if (!segment) return;
      segment.easing = select.value as MipEasing;
      refreshInspector();
    });
  });
  removeSegmentButton.disabled = segments.length <= 1;
  addSegmentButton.disabled = segments.length >= MAX_SEGMENTS;
  addSegmentButton.title =
    segments.length >= MAX_SEGMENTS ? "Segment limit reached (A-Z)" : "Add segment";
  updateCurveEditor();
  segmentList
    .querySelector<HTMLElement>(`[data-segment-id="${activeSegmentId}"]`)
    ?.scrollIntoView({ block: "nearest" });
  frameStrip
    .querySelector<HTMLElement>(`[data-frame-segment="${activeSegmentId}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  renderAnimationModeLayout();
}

function syncTimelineMode() {
  const conflicts = ["translate", "line", "bezier", "orbit"];
  conflicts.forEach((command) => {
    const button = document.querySelector<HTMLButtonElement>(`[data-command="${command}"]`);
    if (!button) return;
    button.disabled = timelineEnabled.checked;
    if (timelineEnabled.checked) button.classList.remove("active");
  });
}

function buildInstructionsFor(
  commands: ReadonlySet<string>,
  base: MipTiming,
  idPrefix: string,
  effectColor = colorInput.value,
) {
  const instructions: MipInstruction[] = [];
  if (commands.has("translate")) {
    instructions.push({
      id: "transform.translate",
      category: "transform",
      type: "translate",
      from: { x: -170, y: 120 },
      to: { x: 170, y: -120 },
      timing: base,
    });
  }
  if (commands.has("scale")) {
    instructions.push({
      id: "transform.scale",
      category: "transform",
      type: "scale",
      from: 0.65,
      to: 1.65,
      timing: base,
    });
  }
  if (commands.has("rotate")) {
    instructions.push({
      id: "transform.rotate",
      category: "transform",
      type: "rotate",
      from: 0,
      to: 720,
      timing: base,
    });
  }
  if (commands.has("skew")) {
    instructions.push({
      id: "transform.skew",
      category: "transform",
      type: "skew",
      from: { x: -8, y: 0 },
      to: { x: 18, y: -10 },
      timing: base,
    });
  }
  if (commands.has("line")) {
    instructions.push({
      id: "path.line",
      category: "motionPath",
      type: "line",
      from: { x: -170, y: 120 },
      to: { x: 170, y: -120 },
      timing: base,
    });
  }
  if (commands.has("bezier")) {
    instructions.push({
      id: "path.bezier",
      category: "motionPath",
      type: "bezier",
      from: { x: -170, y: 110 },
      control1: { x: -50, y: -160 },
      control2: { x: 70, y: 160 },
      to: { x: 170, y: -110 },
      timing: base,
    });
  }
  if (commands.has("orbit")) {
    instructions.push({
      id: "path.orbit",
      category: "motionPath",
      type: "orbit",
      radius: 120,
      startAngle: -90,
      turns: 1,
      timing: base,
    });
  }
  if (commands.has("fadeIn")) {
    instructions.push({
      id: "opacity.fadeIn",
      category: "opacity",
      type: "fadeIn",
      timing: { ...base, duration: Math.max(180, base.duration * 0.35) },
    });
  }
  if (commands.has("fadeOut")) {
    instructions.push({
      id: "opacity.fadeOut",
      category: "opacity",
      type: "fadeOut",
      timing: {
        ...base,
        duration: Math.max(180, base.duration * 0.35),
        delay: (base.delay ?? 0) + base.duration * 0.65,
      },
    });
  }
  if (commands.has("shake")) instructions.push({ id: "effect.shake", category: "effect", type: "shake", intensity: 13, timing: base });
  if (commands.has("pulse")) instructions.push({ id: "effect.pulse", category: "effect", type: "pulse", scale: 1.28, timing: base });
  if (commands.has("blur")) instructions.push({ id: "effect.blur", category: "effect", type: "blur", radius: 9, timing: base });
  if (commands.has("glow")) instructions.push({ id: "effect.glow", category: "effect", type: "glow", color: effectColor, radius: 22, timing: base });
  if (commands.has("particle")) instructions.push({ id: "effect.particle", category: "effect", type: "particle", color: effectColor, count: 22, spread: 140, timing: base });
  return instructions.map((instruction) => ({
    ...instruction,
    id: `${idPrefix}.${instruction.id}`,
  }));
}

function buildInstructions() {
  return animationMode === "synchronized"
    ? buildInstructionsFor(
        synchronizedCommands,
        timing(),
        "sync",
        synchronizedSettings.color,
      )
    : [];
}

function currentIntent() {
  return createMotionIntent(
    emojiInput.value,
    buildInstructions(),
    buildTimeline(),
    animationMode,
    buildPreviewViewport(),
  );
}

function refreshInspector() {
  const intent = currentIntent();
  const svg = emojiToSvg(intent.asset.value, { size: 104, padding: 8 });
  assetPreview.src = svg.dataUrl;
  assetPreview.alt = svg.emoji;
  svgOutput.textContent = svg.svg;
  svgSize.textContent = `${svg.width} × ${svg.height}`;
  protocolOutput.textContent = serializeMotionIntent(intent);
  player.load(intent);
}

function runIntent() {
  const intent = currentIntent();
  protocolOutput.textContent = serializeMotionIntent(intent);
  player.play(intent);
  const segmentCount = intent.timeline?.segments.length ?? 0;
  const segmentInstructionCount =
    intent.timeline?.segments.reduce(
      (count, segment) => count + (segment.instructions?.length ?? 0),
      0,
    ) ?? 0;
  statusText.textContent = `${intent.instructions.length + segmentInstructionCount} instructions${segmentCount ? ` · ${segmentCount} segments` : ""} running`;
  statusDot.classList.add("running");
  if (!intent.timeline?.loop && !intent.instructions.some((item) => item.timing.loop)) {
    const timelineDuration =
      (intent.timeline?.delay ?? 0) +
      (intent.timeline?.segments.reduce((sum, segment) => sum + segment.duration, 0) ?? 0);
    const endsAt = Math.max(
      timelineDuration,
      ...intent.instructions.map(
        (item) => (item.timing.delay ?? 0) + item.timing.duration * ((item.timing.repeat ?? 0) + 1),
      ),
    );
    window.setTimeout(() => {
      statusText.textContent = "Complete";
      statusDot.classList.remove("running");
    }, endsAt + 80);
  }
}

function setCommands(commands: string[]) {
  document.querySelectorAll<HTMLElement>("[data-command]").forEach((button) => {
    button.classList.toggle("active", commands.includes(button.dataset.command ?? ""));
  });
}

function clearCommandsAndEffects() {
  synchronizedCommands.clear();
  segmentCommands.clear();
  setCommands([]);
  document.querySelectorAll(".preset").forEach((item) => item.classList.remove("active"));
  player.stop();
  statusText.textContent = "Ready";
  statusDot.classList.remove("running");
  refreshInspector();
}

function applyPreset(name: string) {
  if (name === "orbit") {
    timelineEnabled.checked = false;
    setCommands(["orbit", "pulse", "glow"]);
    emojiInput.value = "😀";
    easingInput.value = "linear";
    loopInput.checked = true;
  } else if (name === "effects") {
    timelineEnabled.checked = false;
    setCommands(["shake", "pulse", "blur", "glow", "particle"]);
    emojiInput.value = "✨";
    easingInput.value = "elastic";
    loopInput.checked = false;
  } else {
    timelineEnabled.checked = true;
    setCommands(["scale", "rotate", "fadeOut"]);
    emojiInput.value = "🔥";
    easingInput.value = "easeOut";
    loopInput.checked = false;
  }
  syncTimelineMode();
  storeVisibleCommands();
  storeVisibleSettings();
  renderTimelineEditor();
  refreshInspector();
}

document.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    const parent = button.closest<HTMLElement>("[data-exclusive]");
    if (parent && !button.classList.contains("active")) {
      parent.querySelectorAll(".command").forEach((item) => item.classList.remove("active"));
    }
    button.classList.toggle("active");
    storeVisibleCommands();
    refreshInspector();
  });
});

document.querySelectorAll<HTMLInputElement>('input[name="animation-mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    storeVisibleSettings();
    animationMode = input.value === "perSegment" ? "perSegment" : "synchronized";
    showCommandsForCurrentMode();
    renderTimelineEditor();
    refreshInspector();
  });
});

timelineEnabled.addEventListener("change", () => {
  syncTimelineMode();
  refreshInspector();
});

document.querySelectorAll<HTMLButtonElement>("[data-add-system-path]").forEach((button) => {
  button.addEventListener("click", () => {
    replaceCurrentPath(button.dataset.addSystemPath as SystemPathName);
  });
});

addSegmentButton.addEventListener("click", () => {
  if (segments.length >= MAX_SEGMENTS) return;
  const start = frameById(segments[segments.length - 1]?.to) ?? frames[frames.length - 1];
  const index = frames.filter((frame) => /^[A-Z]+$/.test(frame.label)).length;
  const label = frameLabel(index);
  const angle = (-135 + index * 67) * (Math.PI / 180);
  const end: MipMotionFrame = {
    id: `frame-${crypto.randomUUID()}`,
    label,
    position: {
      x: Math.cos(angle) * 180,
      y: Math.sin(angle) * 120,
    },
  };
  const controls = defaultControls(start, end);
  const segment: MipMotionSegment = {
    id: `segment-${crypto.randomUUID()}`,
    from: start.id,
    to: end.id,
    motion: "bezier",
    duration: 900,
    easing: easingInput.value as MipEasing,
    ...controls,
  };
  frames.push(end);
  segments.push(segment);
  ensureSegmentAnchors(segment);
  activeSegmentId = segment.id;
  activeAnchorIndex = 0;
  showCommandsForCurrentMode();
  renderTimelineEditor();
  refreshInspector();
});

removeSegmentButton.addEventListener("click", () => {
  if (segments.length <= 1) return;
  const removed = segments.pop();
  if (removed && frames[frames.length - 1]?.id === removed.to) frames.pop();
  activeSegmentId = segments[segments.length - 1].id;
  activeAnchorIndex = 0;
  segmentCommands.delete(removed?.id ?? "");
  segmentSettings.delete(removed?.id ?? "");
  showCommandsForCurrentMode();
  renderTimelineEditor();
  refreshInspector();
});

curveEditor.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (curveToolMode === "pan") {
    const segment = activeSegment();
    const anchors = ensureSegmentAnchors(segment);
    draggedHandle = {
      kind: "path",
      segmentId: segment.id,
      start: worldPoint(curveEventEditorPoint(event)),
      anchors: anchors.map((anchor) => ({
        id: anchor.id,
        position: { ...anchor.position },
        ...(anchor.controlIn ? { controlIn: { ...anchor.controlIn } } : {}),
        ...(anchor.controlOut ? { controlOut: { ...anchor.controlOut } } : {}),
      })),
    };
    draggedPointerId = event.pointerId;
    hideAlignmentGuides();
    event.preventDefault();
    curveEditor.setPointerCapture(event.pointerId);
    return;
  }
  const target = event.target;
  if (!(target instanceof SVGCircleElement)) {
    appendAnchorAt(worldPoint(curveEventEditorPoint(event)));
    event.preventDefault();
    renderTimelineEditor();
    refreshInspector();
    return;
  }
  const handle = target.dataset.handle;
  if (handle === "anchor") {
    const anchorId = target.dataset.anchorId;
    const anchorIndex = Number(target.dataset.anchorIndex);
    if (!anchorId || !Number.isInteger(anchorIndex)) return;
    const anchors = ensureSegmentAnchors(activeSegment());
    activeAnchorIndex = Math.min(anchorIndex, anchors.length - 2);
    selectedAnchorId = anchorId;
    draggedHandle = { kind: "anchor", anchorId };
  } else if (handle === "control1" || handle === "control2") {
    draggedHandle = {
      kind: handle,
      segmentId: activeSegmentId,
      anchorIndex: activeAnchorIndex,
    };
  } else {
    return;
  }
  draggedPointerId = event.pointerId;
  hideAlignmentGuides();
  updateCurveEditor();
  event.preventDefault();
  curveEditor.setPointerCapture(event.pointerId);
});

curveEditor.addEventListener("pointermove", (event) => {
  if (!draggedHandle || draggedPointerId !== event.pointerId) return;
  const handle = draggedHandle;
  const editorPointValue = curveEventEditorPoint(event);
  const snappedEditorPoint =
    handle.kind === "path"
      ? editorPointValue
      : snapToOtherHandles(editorPointValue, handle);
  const next = worldPoint(snappedEditorPoint);
  const segment = activeSegment();
  const anchors = ensureSegmentAnchors(segment);
  if (handle.kind === "anchor") {
    const anchorIndex = anchors.findIndex((anchor) => anchor.id === handle.anchorId);
    if (anchorIndex >= 0) {
      anchors[anchorIndex].position = next;
    }
  } else if (handle.kind === "path") {
    const targetSegment = segments.find((item) => item.id === handle.segmentId);
    const targetAnchors = targetSegment ? ensureSegmentAnchors(targetSegment) : [];
    const delta = snapPathTranslation(handle, next);
    handle.anchors.forEach((snapshot) => {
      const anchor = targetAnchors.find((item) => item.id === snapshot.id);
      if (!anchor) return;
      anchor.position = {
        x: snapshot.position.x + delta.x,
        y: snapshot.position.y + delta.y,
      };
      anchor.controlIn = snapshot.controlIn
        ? {
            x: snapshot.controlIn.x + delta.x,
            y: snapshot.controlIn.y + delta.y,
          }
        : undefined;
      anchor.controlOut = snapshot.controlOut
        ? {
            x: snapshot.controlOut.x + delta.x,
            y: snapshot.controlOut.y + delta.y,
          }
        : undefined;
    });
    if (targetSegment) syncSegmentControlsFromAnchors(targetSegment);
  } else {
    const targetSegment = segments.find((item) => item.id === handle.segmentId);
    const targetAnchors = targetSegment ? ensureSegmentAnchors(targetSegment) : [];
    if (handle.kind === "control1" && targetAnchors[handle.anchorIndex]) {
      targetAnchors[handle.anchorIndex].controlOut = next;
    }
    if (handle.kind === "control2" && targetAnchors[handle.anchorIndex + 1]) {
      targetAnchors[handle.anchorIndex + 1].controlIn = next;
    }
  }
  updateCurveEditor();
  const intent = currentIntent();
  protocolOutput.textContent = serializeMotionIntent(intent);
  player.load(intent);
});

function releaseCurveHandle(event: PointerEvent) {
  if (draggedPointerId !== event.pointerId) return;
  draggedHandle = null;
  draggedPointerId = null;
  hideAlignmentGuides();
  renderTimelineEditor();
  refreshInspector();
}

curveEditor.addEventListener("pointerup", releaseCurveHandle);
curveEditor.addEventListener("pointercancel", releaseCurveHandle);
deleteAnchorButton.addEventListener("click", deleteSelectedAnchor);
curveEditTool.addEventListener("click", () => setCurveToolMode("edit"));
curvePanTool.addEventListener("click", () => setCurveToolMode("pan"));

document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".preset").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    applyPreset(button.dataset.preset ?? "flight");
  });
});

[emojiInput, durationInput, delayInput, repeatInput, loopInput, easingInput, colorInput].forEach(
  (input) =>
    input.addEventListener("input", () => {
      storeVisibleSettings();
      refreshInspector();
    }),
);

requiredElement("#play-button").addEventListener("click", runIntent);
requiredElement("#stop-button").addEventListener("click", () => {
  player.stop();
  statusText.textContent = "Stopped";
  statusDot.classList.remove("running");
});
selectPreviewButton.addEventListener("click", () => {
  setPreviewSelectionMode(!previewSelectionMode);
  if (previewSelectionMode) {
    statusText.textContent = "Drag to select a preview area";
    statusDot.classList.remove("running");
  }
});
previewSelection
  .querySelectorAll<HTMLElement>("[data-preview-resize]")
  .forEach((handleElement) => {
    handleElement.addEventListener("pointerdown", (event) => {
      if (!previewRegion || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      previewResizeState = {
        handle: handleElement.dataset.previewResize as PreviewResizeHandle,
        pointerId: event.pointerId,
        startPointer: stagePoint(event),
        startRegion: pixelRegion(previewRegion),
      };
      handleElement.setPointerCapture(event.pointerId);
    });
    handleElement.addEventListener("pointermove", (event) => {
      if (!previewResizeState || previewResizeState.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const region = resizedPreviewRegion(previewResizeState, stagePoint(event));
      previewRegion = normalizedRegion(region);
      applyPreviewRegion();
    });
    const finishResize = (event: PointerEvent, cancelled = false) => {
      if (!previewResizeState || previewResizeState.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (cancelled) {
        previewRegion = normalizedRegion(previewResizeState.startRegion);
        applyPreviewRegion();
      }
      if (handleElement.hasPointerCapture(event.pointerId)) {
        handleElement.releasePointerCapture(event.pointerId);
      }
      previewResizeState = null;
      statusText.textContent = "Preview area resized";
      refreshInspector();
    };
    handleElement.addEventListener("pointerup", (event) => finishResize(event));
    handleElement.addEventListener("pointercancel", (event) => finishResize(event, true));
  });
stage.addEventListener("pointerdown", (event) => {
  if (!previewSelectionMode || event.button !== 0) return;
  event.preventDefault();
  previewSelectionStart = stagePoint(event);
  previewSelectionPointerId = event.pointerId;
  stage.setPointerCapture(event.pointerId);
  positionSelection({
    x: previewSelectionStart.x,
    y: previewSelectionStart.y,
    width: 0,
    height: 0,
  });
});
stage.addEventListener("pointermove", (event) => {
  if (
    !previewSelectionMode ||
    !previewSelectionStart ||
    previewSelectionPointerId !== event.pointerId
  ) return;
  event.preventDefault();
  positionSelection(regionFromPoints(previewSelectionStart, stagePoint(event)));
});

function finishPreviewSelection(event: PointerEvent, cancelled = false) {
  if (
    !previewSelectionStart ||
    previewSelectionPointerId !== event.pointerId
  ) return;
  const region = regionFromPoints(previewSelectionStart, stagePoint(event));
  if (stage.hasPointerCapture(event.pointerId)) {
    stage.releasePointerCapture(event.pointerId);
  }
  if (
    !cancelled &&
    region.width >= MIN_PREVIEW_REGION_SIZE &&
    region.height >= MIN_PREVIEW_REGION_SIZE
  ) {
    previewRegion = normalizedRegion(region);
    setPreviewSelectionMode(false);
    statusText.textContent = "Preview area selected";
    refreshInspector();
    return;
  }
  setPreviewSelectionMode(false);
}

stage.addEventListener("pointerup", (event) => finishPreviewSelection(event));
stage.addEventListener("pointercancel", (event) => finishPreviewSelection(event, true));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && previewSelectionMode) {
    setPreviewSelectionMode(false);
  }
});
new ResizeObserver(() => {
  applyPreviewRegion();
  protocolOutput.textContent = serializeMotionIntent(currentIntent());
}).observe(stage);
requiredElement("#clear-button").addEventListener("click", clearCommandsAndEffects);
requiredElement("#reset-button").addEventListener("click", () => {
  resetTimeline();
  timelineEnabled.checked = true;
  emojiInput.value = "🔥";
  durationInput.value = "2200";
  delayInput.value = "0";
  repeatInput.value = "0";
  loopInput.checked = false;
  easingInput.value = "easeOut";
  setCommands([]);
  document.querySelectorAll(".preset").forEach((item) => item.classList.remove("active"));
  statusText.textContent = "Ready";
  statusDot.classList.remove("running");
  syncTimelineMode();
  renderTimelineEditor();
  refreshInspector();
});
requiredElement("#copy-button").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(protocolOutput.textContent ?? "");
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = "Copied";
  window.setTimeout(() => (button.textContent = "Copy"), 1200);
});

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".inspector-tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".inspector-panel").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    requiredElement(`#${tab.dataset.tab}-panel`).classList.add("active");
  });
});

syncTimelineMode();
renderTimelineEditor();
refreshInspector();
