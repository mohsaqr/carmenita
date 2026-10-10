"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import {
  HEART_START_KEY,
  initialHeartPhase,
  nextHeartPhase,
  type HeartPhase,
} from "@/lib/heart-schedule";

/** Visit start for this tab, kept across reloads so they don't restart the intro. */
function visitStart(): number {
  const now = Date.now();
  try {
    const saved = Number(window.sessionStorage.getItem(HEART_START_KEY));
    if (Number.isFinite(saved) && saved > 0 && saved <= now) return saved;
    window.sessionStorage.setItem(HEART_START_KEY, String(now));
  } catch {
    // sessionStorage unavailable (privacy mode): the intro restarts per load.
  }
  return now;
}

/**
 * A small heart beside the "Carmenita" name — shown for the first 10
 * minutes of a visit, then now and then for a few minutes (see
 * `heart-schedule.ts`). Always mounted and faded with opacity, so the
 * layout never shifts. Hidden on the server render to avoid a hydration
 * mismatch. Not shown in the public static build.
 */
export function CarmenitaHeart() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STATIC_BUILD === "1") return;
    let timer: ReturnType<typeof setTimeout>;
    const enter = (phase: HeartPhase) => {
      setVisible(phase.visible);
      timer = setTimeout(() => enter(nextHeartPhase(phase, Math.random())), phase.durationMs);
    };
    enter(initialHeartPhase(Date.now() - visitStart(), Math.random()));
    return () => clearTimeout(timer);
  }, []);

  return (
    <Heart
      aria-hidden="true"
      className={`h-4 w-4 fill-rose-500 text-rose-500 transition-opacity duration-1000 motion-safe:animate-pulse ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
