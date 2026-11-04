"use client";

import { useEffect, useRef } from "react";
import type { TimedLine } from "@/lib/library";
import { currentLine } from "@/lib/lrc";

// iPhone-Music-style lyrics: the current line is big and bright and scrolls
// to the middle; sung lines dim, upcoming lines are softer.
export default function TimedLyrics({ lines, time }: { lines: TimedLine[]; time: number }) {
  // Show each line a moment early so you can read it before singing.
  const idx = currentLine(lines, time + 0.25);
  const refs = useRef<(HTMLParagraphElement | null)[]>([]);

  useEffect(() => {
    refs.current[Math.max(idx, 0)]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [idx]);

  return (
    <div className="h-full overflow-hidden px-5 [mask-image:linear-gradient(transparent,black_20%,black_80%,transparent)]">
      <div className="py-[40%]">
        {lines.map((l, i) => (
          <p
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={`my-3 text-center font-bold leading-snug transition-all duration-300 [text-shadow:0_1px_6px_#000] ${
              i === idx
                ? "scale-105 text-2xl text-white"
                : i < idx
                  ? "text-xl text-white/35"
                  : "text-xl text-white/60"
            }`}
          >
            {l.text || "♪"}
          </p>
        ))}
      </div>
    </div>
  );
}
