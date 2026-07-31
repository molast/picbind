# @picbind/mip

Motion Intent Protocol (MIP) is a lightweight vector animation command protocol.
Emoji input is converted to an SVG asset before instructions are executed.

Supported instruction groups:

- Transform: translate, scale, rotate, skew
- Motion Path: line, cubic Bezier, orbit
- Opacity: fade in, fade out
- Time Control: duration, delay, repeat, loop
- Easing: linear, ease, easeIn, easeOut, bounce, elastic
- Effect: shake, pulse, blur, glow, particle
- Motion Frames: unlimited frames and segments with per-segment motion,
  duration, easing, and Bezier control points

Timeline segments are stored as arrays, so the protocol does not impose a
segment count limit. A segment references its start and end frame by ID:

```ts
timeline: {
  frames: [
    { id: "a", label: "A", position: { x: -160, y: 100 } },
    { id: "b", label: "B", position: { x: 0, y: -100 } },
    { id: "c", label: "C", position: { x: 160, y: -60 } },
  ],
  segments: [
    { id: "ab", from: "a", to: "b", motion: "bezier", duration: 800 },
    { id: "bc", from: "b", to: "c", motion: "line", duration: 1200 },
  ],
}
```

MIP supports two animation assignment modes. `synchronized` keeps shared
commands in the document-level `instructions` array. `perSegment` keeps the
document-level array empty and stores commands in the owning timeline segment,
with instruction timing relative to the start of that segment:

```ts
{
  animationMode: "perSegment",
  instructions: [],
  timeline: {
    frames: [/* ... */],
    segments: [
      {
        id: "segment-a",
        from: "frame-a",
        to: "frame-b",
        motion: "bezier",
        duration: 900,
        instructions: [
          {
            id: "segment.segment-a.effect.glow",
            category: "effect",
            type: "glow",
            color: "#22d3ee",
            timing: { duration: 900, delay: 0, easing: "easeOut" },
          },
        ],
      },
    ],
  },
}
```

Documents without `animationMode` remain valid and are interpreted as
`synchronized` for backward compatibility.

An authored preview region is serialized as a viewport. Its origin is local
`(0, 0)` and its dimensions provide the scaling reference used by the player:

```ts
{
  viewport: { width: 640, height: 360 },
}
```

`viewport` is optional for backward compatibility. When present, the player
adapts spatial coordinates and visual effect dimensions to the actual playback
container while preserving the authored aspect ratio.

## Development

```bash
pnpm install
pnpm dev
```

The preview runs at `http://127.0.0.1:4173`.

## SDK

```ts
import { MipPlayer, createMotionIntent } from "@picbind/mip";

const intent = createMotionIntent("🔥", [
  {
    id: "flight",
    category: "transform",
    type: "translate",
    from: { x: -160, y: 120 },
    to: { x: 160, y: -120 },
    timing: { duration: 1800, easing: "easeOut" },
  },
]);

const player = new MipPlayer(document.querySelector("#stage")!);
player.play(intent);
```
