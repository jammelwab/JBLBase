import { Portal } from "@mantine/core";
import { atom, useAtom } from "jotai";
import { useEffect, useState } from "react";
import classes from "./CoachCelebration.module.css";
import { playCoachTone } from "./coachSound";

// Krasse Momente (1.2.20): großer Jubel über dem ganzen Fenster. Konfetti,
// ein Lichtblitz, ein großer Schriftzug mit Untertitel und eine Fanfare.
// „big“ für !! oder Matt, „mega“ für Level-up, ersten Sieg auf einer Stufe,
// neue Bestleistung oder den Boss.

export type Celebration = {
  id: number;
  tier: "big" | "mega";
  title: string;
  subtitle?: string;
};

export const coachCelebrationAtom = atom<Celebration[]>([]);

let nextId = 1;
export function celebration(c: Omit<Celebration, "id">): Celebration {
  return { ...c, id: nextId++ };
}

const SHOW_MS = { big: 2200, mega: 3200 };
const COLORS = ["#ff922b", "#fcc419", "#ff6b6b", "#51cf66", "#339af0", "#cc5de8", "#ffffff"];

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  w: number;
  h: number;
  color: string;
};

function burst(canvas: HTMLCanvasElement, tier: Celebration["tier"]): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  const pieces: Piece[] = [];
  const add = (x: number, y: number, n: number, angle: number, spread: number, speed: number) => {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.6 + Math.random() * 0.6);
      pieces.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }
  };
  const n = tier === "mega" ? 140 : 80;
  // Zwei Kanonen unten links und rechts, dazu ein Ring aus der Mitte
  add(0, height, n, -Math.PI / 3, 0.6, 22);
  add(width, height, n, (-2 * Math.PI) / 3, 0.6, 22);
  add(width / 2, height * 0.4, tier === "mega" ? 90 : 40, 0, Math.PI * 2, 12);
  let frame = 0;
  let raf = 0;
  const step = () => {
    frame++;
    ctx.clearRect(0, 0, width, height);
    const fade = Math.max(0, 1 - Math.max(0, frame - 90) / 60);
    for (const p of pieces) {
      p.vy += 0.35;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
      ctx.restore();
    }
    if (fade > 0) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

// Einmal im Fenster eingehängt: zeigt die Feiern nacheinander
export default function CoachCelebration() {
  const [queue, setQueue] = useAtom(coachCelebrationAtom);
  const current = queue[0] ?? null;
  // Die Leinwand kommt erst mit dem Portal, daher als Zustand statt Ref
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!current) return;
    playCoachTone(current.tier === "mega" ? "mega" : "fanfare");
    const timer = setTimeout(
      () => setQueue((q) => q.filter((c) => c.id !== current.id)),
      SHOW_MS[current.tier],
    );
    return () => clearTimeout(timer);
  }, [current, setQueue]);

  useEffect(() => {
    if (!current || !canvas || reducedMotion()) return;
    return burst(canvas, current.tier);
  }, [current, canvas]);

  if (!current) return null;
  return (
    <Portal>
      <div className={classes.layer} data-tier={current.tier} key={current.id} aria-live="polite">
        <div className={classes.flash} />
        <canvas ref={setCanvas} className={classes.canvas} />
        <div className={classes.banner}>
          <div className={classes.title}>{current.title}</div>
          {current.subtitle && <div className={classes.subtitle}>{current.subtitle}</div>}
        </div>
      </div>
    </Portal>
  );
}
