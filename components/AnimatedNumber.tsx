"use client";

import { useEffect, useRef, useState } from "react";

// A number that counts smoothly to its new value (e.g. when a filter changes a KPI), in ~600 ms with ease-out.
// Jumps straight there when the user prefers reduced motion. Screen readers get the final value only.

const DURATION_MS = 600;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function useAnimatedNumber(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(value) || shownRef.current === value) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    from.current = shownRef.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const v = from.current + (value - from.current) * easeOut(t);
      shownRef.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return shown;
}

export function AnimatedNumber({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const shown = useAnimatedNumber(value);
  return (
    <span className={className}>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
