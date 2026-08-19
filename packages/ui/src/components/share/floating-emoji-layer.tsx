import type { FloatingEmoji } from "./share-room-types";

export default function FloatingEmojiLayer({ items }: { items: FloatingEmoji[] }) {
  return (
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
  );
}
