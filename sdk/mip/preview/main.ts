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
const timelineEnabled = requiredElement<HTMLInputElement>("#timeline-enabled");
const frameStrip = requiredElement<HTMLElement>("#frame-strip");
const segmentList = requiredElement<HTMLElement>("#segment-list");
const addSegmentButton = requiredElement<HTMLButtonElement>("#add-segment");
const removeSegmentButton = requiredElement<HTMLButtonElement>("#remove-segment");
const curveEditor = requiredElement<SVGSVGElement>("#curve-editor");
const curvePath = requiredElement<SVGPathElement>("#curve-path");
const curveControlLine = requiredElement<SVGPathElement>("#curve-control-line");
const curveSegmentLabel = requiredElement<HTMLElement>("#curve-segment-label");
const player = new MipPlayer(stage, { assetSize: 104 });

const INITIAL_FRAMES: MipMotionFrame[] = [
  { id: "frame-a", label: "A", position: { x: -180, y: 110 } },
  { id: "frame-b", label: "B", position: { x: -25, y: -115 } },
  { id: "frame-c", label: "C", position: { x: 180, y: -70 } },
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
  {
    id: "segment-b-c",
    from: "frame-b",
    to: "frame-c",
    motion: "bezier",
    duration: 1300,
    easing: "elastic",
    control1: { x: 45, y: -145 },
    control2: { x: 125, y: 30 },
  },
];
const frames: MipMotionFrame[] = structuredClone(INITIAL_FRAMES);
const segments: MipMotionSegment[] = structuredClone(INITIAL_SEGMENTS);
let activeSegmentId = segments[0].id;
let draggedHandle: "start" | "control1" | "control2" | "end" | null = null;
let draggedPointerId: number | null = null;

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
  activeSegmentId = segments[0].id;
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
    segments: segments.map((segment) => ({
      ...segment,
      ...(segment.control1 ? { control1: { ...segment.control1 } } : {}),
      ...(segment.control2 ? { control2: { ...segment.control2 } } : {}),
    })),
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

function isSelected(command: string) {
  return Boolean(document.querySelector(`[data-command="${command}"].active`));
}

function editorPoint(point: { x: number; y: number }) {
  return {
    x: ((point.x + 220) / 440) * 260,
    y: ((point.y + 160) / 320) * 150,
  };
}

function worldPoint(point: { x: number; y: number }) {
  return {
    x: (point.x / 260) * 440 - 220,
    y: (point.y / 150) * 320 - 160,
  };
}

function setCirclePosition(selector: string, pointValue: { x: number; y: number }) {
  const circle = requiredElement<SVGCircleElement>(selector);
  const converted = editorPoint(pointValue);
  circle.setAttribute("cx", String(converted.x));
  circle.setAttribute("cy", String(converted.y));
}

function updateCurveEditor() {
  const segment = activeSegment();
  if (!segment) return;
  const start = frameById(segment.from);
  const end = frameById(segment.to);
  if (!start || !end) return;
  ensureControls(segment);
  const startPoint = editorPoint(start.position);
  const endPoint = editorPoint(end.position);
  const control1 = editorPoint(segment.control1 ?? start.position);
  const control2 = editorPoint(segment.control2 ?? end.position);
  const isBezier = segment.motion === "bezier";
  curveSegmentLabel.textContent = `${start.label} → ${end.label}`;
  curvePath.setAttribute(
    "d",
    isBezier
      ? `M ${startPoint.x} ${startPoint.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${endPoint.x} ${endPoint.y}`
      : `M ${startPoint.x} ${startPoint.y} L ${endPoint.x} ${endPoint.y}`,
  );
  curveControlLine.setAttribute(
    "d",
    isBezier
      ? `M ${startPoint.x} ${startPoint.y} L ${control1.x} ${control1.y} M ${endPoint.x} ${endPoint.y} L ${control2.x} ${control2.y}`
      : "",
  );
  setCirclePosition("#curve-start", start.position);
  setCirclePosition("#curve-end", end.position);
  setCirclePosition("#curve-control-1", segment.control1 ?? start.position);
  setCirclePosition("#curve-control-2", segment.control2 ?? end.position);
  requiredElement<SVGCircleElement>("#curve-control-1").style.display = isBezier ? "" : "none";
  requiredElement<SVGCircleElement>("#curve-control-2").style.display = isBezier ? "" : "none";
}

function easingOptions(selected: MipEasing) {
  return ["linear", "ease", "easeIn", "easeOut", "bounce", "elastic"]
    .map(
      (value) =>
        `<option value="${value}"${value === selected ? " selected" : ""}>${value}</option>`,
    )
    .join("");
}

function renderTimelineEditor() {
  frameStrip.replaceChildren();
  frames.forEach((frame, index) => {
    if (index > 0) {
      const connector = document.createElement("span");
      connector.className = "frame-connector";
      frameStrip.appendChild(connector);
    }
    const chip = document.createElement("span");
    chip.className = "frame-chip";
    chip.textContent = frame.label;
    chip.title = `${frame.label}: ${Math.round(frame.position.x)}, ${Math.round(frame.position.y)}`;
    frameStrip.appendChild(chip);
  });

  segmentList.innerHTML = segments
    .map((segment) => {
      const start = frameById(segment.from);
      const end = frameById(segment.to);
      return `<div class="segment-row${segment.id === activeSegmentId ? " active" : ""}" data-segment-id="${segment.id}">
        <button type="button" data-select-segment="${segment.id}">${start?.label ?? "?"}→${end?.label ?? "?"}</button>
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
      renderTimelineEditor();
    });
  });
  segmentList.querySelectorAll<HTMLSelectElement>("[data-segment-motion]").forEach((select) => {
    select.addEventListener("change", () => {
      const segment = segments.find((item) => item.id === select.dataset.segmentMotion);
      if (!segment) return;
      segment.motion = select.value === "line" ? "line" : "bezier";
      ensureControls(segment);
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
  updateCurveEditor();
  segmentList
    .querySelector<HTMLElement>(`[data-segment-id="${activeSegmentId}"]`)
    ?.scrollIntoView({ block: "nearest" });
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

function buildInstructions() {
  const instructions: MipInstruction[] = [];
  const base = timing();
  if (isSelected("translate")) {
    instructions.push({
      id: "transform.translate",
      category: "transform",
      type: "translate",
      from: { x: -170, y: 120 },
      to: { x: 170, y: -120 },
      timing: base,
    });
  }
  if (isSelected("scale")) {
    instructions.push({
      id: "transform.scale",
      category: "transform",
      type: "scale",
      from: 0.65,
      to: 1.65,
      timing: base,
    });
  }
  if (isSelected("rotate")) {
    instructions.push({
      id: "transform.rotate",
      category: "transform",
      type: "rotate",
      from: 0,
      to: 720,
      timing: base,
    });
  }
  if (isSelected("skew")) {
    instructions.push({
      id: "transform.skew",
      category: "transform",
      type: "skew",
      from: { x: -8, y: 0 },
      to: { x: 18, y: -10 },
      timing: base,
    });
  }
  if (isSelected("line")) {
    instructions.push({
      id: "path.line",
      category: "motionPath",
      type: "line",
      from: { x: -170, y: 120 },
      to: { x: 170, y: -120 },
      timing: base,
    });
  }
  if (isSelected("bezier")) {
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
  if (isSelected("orbit")) {
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
  if (isSelected("fadeIn")) {
    instructions.push({
      id: "opacity.fadeIn",
      category: "opacity",
      type: "fadeIn",
      timing: timing({ duration: Math.max(180, base.duration * 0.35) }),
    });
  }
  if (isSelected("fadeOut")) {
    instructions.push({
      id: "opacity.fadeOut",
      category: "opacity",
      type: "fadeOut",
      timing: timing({
        duration: Math.max(180, base.duration * 0.35),
        delay: (base.delay ?? 0) + base.duration * 0.65,
      }),
    });
  }
  if (isSelected("shake")) instructions.push({ id: "effect.shake", category: "effect", type: "shake", intensity: 13, timing: base });
  if (isSelected("pulse")) instructions.push({ id: "effect.pulse", category: "effect", type: "pulse", scale: 1.28, timing: base });
  if (isSelected("blur")) instructions.push({ id: "effect.blur", category: "effect", type: "blur", radius: 9, timing: base });
  if (isSelected("glow")) instructions.push({ id: "effect.glow", category: "effect", type: "glow", color: colorInput.value, radius: 22, timing: base });
  if (isSelected("particle")) instructions.push({ id: "effect.particle", category: "effect", type: "particle", color: colorInput.value, count: 22, spread: 140, timing: base });
  return instructions;
}

function currentIntent() {
  return createMotionIntent(emojiInput.value, buildInstructions(), buildTimeline());
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
  statusText.textContent = `${intent.instructions.length} instructions${segmentCount ? ` · ${segmentCount} segments` : ""} running`;
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
    refreshInspector();
  });
});

timelineEnabled.addEventListener("change", () => {
  syncTimelineMode();
  refreshInspector();
});

addSegmentButton.addEventListener("click", () => {
  const start = frames[frames.length - 1];
  const index = frames.length;
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
  activeSegmentId = segment.id;
  renderTimelineEditor();
  refreshInspector();
});

removeSegmentButton.addEventListener("click", () => {
  if (segments.length <= 1) return;
  const removed = segments.pop();
  if (removed && frames[frames.length - 1]?.id === removed.to) frames.pop();
  activeSegmentId = segments[segments.length - 1].id;
  renderTimelineEditor();
  refreshInspector();
});

curveEditor.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof SVGCircleElement)) return;
  const handle = target.dataset.handle;
  if (handle !== "start" && handle !== "control1" && handle !== "control2" && handle !== "end") return;
  draggedHandle = handle;
  draggedPointerId = event.pointerId;
  curveEditor.setPointerCapture(event.pointerId);
});

curveEditor.addEventListener("pointermove", (event) => {
  if (!draggedHandle || draggedPointerId !== event.pointerId) return;
  const rect = curveEditor.getBoundingClientRect();
  const editor = {
    x: Math.max(0, Math.min(260, ((event.clientX - rect.left) / rect.width) * 260)),
    y: Math.max(0, Math.min(150, ((event.clientY - rect.top) / rect.height) * 150)),
  };
  const next = worldPoint(editor);
  const segment = activeSegment();
  const start = frameById(segment.from);
  const end = frameById(segment.to);
  if (draggedHandle === "start" && start) start.position = next;
  if (draggedHandle === "end" && end) end.position = next;
  if (draggedHandle === "control1") segment.control1 = next;
  if (draggedHandle === "control2") segment.control2 = next;
  updateCurveEditor();
  const intent = currentIntent();
  protocolOutput.textContent = serializeMotionIntent(intent);
  player.load(intent);
});

function releaseCurveHandle(event: PointerEvent) {
  if (draggedPointerId !== event.pointerId) return;
  draggedHandle = null;
  draggedPointerId = null;
  renderTimelineEditor();
  refreshInspector();
}

curveEditor.addEventListener("pointerup", releaseCurveHandle);
curveEditor.addEventListener("pointercancel", releaseCurveHandle);

document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".preset").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    applyPreset(button.dataset.preset ?? "flight");
  });
});

[emojiInput, durationInput, delayInput, repeatInput, loopInput, easingInput, colorInput].forEach(
  (input) => input.addEventListener("input", refreshInspector),
);

requiredElement("#play-button").addEventListener("click", runIntent);
requiredElement("#stop-button").addEventListener("click", () => {
  player.stop();
  statusText.textContent = "Stopped";
  statusDot.classList.remove("running");
});
requiredElement("#reset-button").addEventListener("click", () => {
  resetTimeline();
  applyPreset("flight");
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
