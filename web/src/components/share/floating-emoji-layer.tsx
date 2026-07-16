import type { FloatingEmoji } from "./share-room-types";

export default function FloatingEmojiLayer({ items }: { items: FloatingEmoji[] }) {
  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 z-[105] overflow-hidden"
        aria-hidden="true"
      >
        {items.map((item) => (
          <span
            key={item.id}
            className="picbind-live-emoji-motion absolute top-[72%]"
            style={{
              left: `calc(50% + ${item.startX}px)`,
              offsetPath: item.path,
              animationDuration: `${item.duration}ms`,
            }}
          >
            <span
              className="picbind-live-emoji-visual block text-5xl"
              style={{ animationDuration: `${item.duration}ms` }}
            >
              {item.emoji}
            </span>
          </span>
        ))}
      </div>
      <style jsx global>{`
        .picbind-live-emoji-motion {
          offset-distance: 0%;
          offset-rotate: 0deg;
          animation-name: picbind-emoji-motion;
          animation-timing-function: cubic-bezier(0.18, 0.7, 0.22, 1);
          animation-fill-mode: forwards;
          will-change: offset-distance;
        }
        .picbind-live-emoji-visual {
          animation-name: picbind-emoji-visual;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
          will-change: transform, opacity, filter;
        }
        @keyframes picbind-emoji-motion {
          from { offset-distance: 0%; }
          to { offset-distance: 100%; }
        }
        @keyframes picbind-emoji-visual {
          0% { opacity: 0; filter: blur(1px); transform: scale(0.45) rotate(-6deg); }
          10% { opacity: 1; filter: blur(0); transform: scale(0.7) rotate(2deg); }
          55% { opacity: 0.95; filter: blur(0); transform: scale(1.35) rotate(-2deg); }
          78% { opacity: 0.72; filter: blur(1.5px); transform: scale(1.75) rotate(2deg); }
          100% { opacity: 0; filter: blur(9px); transform: scale(2.35) rotate(0deg); }
        }
      `}</style>
    </>
  );
}
