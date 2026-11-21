import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef } from "react";
import { useAtomValue } from "jotai";
import classes from "./CoachFigure.module.css";
import { isBirthdayAtom } from "./coachBirthday";
import { type CoachItemId, coachOutfitAtom, itemSlot } from "./coachRewards";

// Die JBL-Figur: Bohnenkörper, Kopf ist die JBL-Box aus dem Logo.
// Gezeichnet mit den Füßen bei (0,0), Hüfte bei y -46, Hals bei y -130.

export type CoachAnimation =
  | "hello"
  | "think"
  | "good"
  | "win"
  | "loss"
  | "bril"
  | "int"
  | "dub"
  | "mis"
  | "blu"
  | "salto"
  | "scared"
  | "facepalm";

export type CoachFigureHandle = {
  play: (name: CoachAnimation) => Promise<void>;
};

type Key = [number, string | Keyframe, string?];

const EASE = "cubic-bezier(.45,0,.25,1)";
const OUT = "cubic-bezier(.22,1,.36,1)";
const IN = "cubic-bezier(.55,0,1,.45)";
const BACK = "cubic-bezier(.34,1.56,.64,1)";
const INOUT = "cubic-bezier(.65,0,.35,1)";
const SVG_NS = "http://www.w3.org/2000/svg";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

// Zeitleiste: [ms, transform oder Eigenschaften, Easing des folgenden Abschnitts]
function tl(el: Element | null, keys: Key[], T: number, delay = 0): Animation | null {
  if (!el || typeof (el as HTMLElement).animate !== "function") return null;
  const frames = keys.map(([t, p, e]) => {
    const f: Keyframe = typeof p === "string" ? { transform: p } : { ...p };
    f.offset = Math.max(0, Math.min(1, t / T));
    f.easing = e || EASE;
    return f;
  });
  const anim = (el as HTMLElement).animate(frames, {
    duration: T,
    delay,
    fill: delay ? "backwards" : "none",
  });
  // Abgebrochene Animationen sind kein Fehler.
  anim.finished.catch(() => {});
  return anim;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Wie weit die Schallwellen nach oben rücken, wenn etwas auf dem Kopf sitzt
const HAT_LIFT: Partial<Record<CoachItemId, number>> = {
  beanie: 44,
  headphones: 40,
  crown: 40,
  partyHat: 62,
  bunnyEars: 66,
};

const CoachFigure = forwardRef<
  CoachFigureHandle,
  { size?: number; title?: string; outfit?: readonly CoachItemId[]; headOnly?: boolean }
>(function CoachFigure(
  { size = 120, title = "JBL Coach", outfit: outfitProp, headOnly = false },
  ref,
) {
  const storedOutfit = useAtomValue(coachOutfitAtom);
  const birthday = useAtomValue(isBirthdayAtom);
  // Am Geburtstag trägt JBL den ganzen Tag das Partyhütchen
  const outfit =
    outfitProp ??
    (birthday
      ? [...storedOutfit.filter((i) => itemSlot(i) !== "head"), "partyHat" as const]
      : storedOutfit);
  const wears = (item: CoachItemId) => outfit.includes(item);
  const lift = Math.max(0, ...outfit.map((i) => HAT_LIFT[i] ?? 0));
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `jbl${uid}${name}`;

  const svgRef = useRef<SVGSVGElement>(null);
  const fxRef = useRef<SVGGElement>(null);
  const fxBackRef = useRef<SVGGElement>(null);
  const jumpRef = useRef<SVGGElement>(null);
  const squashRef = useRef<SVGGElement>(null);
  const upperRef = useRef<SVGGElement>(null);
  const legsRef = useRef<SVGGElement>(null);
  const torsoRef = useRef<SVGGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const armLRef = useRef<SVGGElement>(null);
  const armRRef = useRef<SVGGElement>(null);
  const eyeLRef = useRef<SVGGElement>(null);
  const eyeRRef = useRef<SVGGElement>(null);
  const busy = useRef(false);

  const all = (sel: string) => Array.from(svgRef.current?.querySelectorAll(sel) ?? []) as Element[];

  // Ein Bewertungs-Chip entsteht hinter der Figur und kommt erst nach vorn,
  // sobald er aufsteigt.
  const chip = useCallback(
    (
      sym: string,
      color: string,
      x: number,
      y: number,
      T = 1300,
      delay = 0,
      keys?: Key[],
      switchAt = 0.14,
    ) => {
      const fx = fxRef.current;
      const back = fxBackRef.current;
      if (!fx || !back) return;
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", classes.rig);
      const shape =
        sym.length > 2
          ? `<rect x="-26" y="-15" width="52" height="30" rx="15" fill="${color}" stroke="#111" stroke-width="3"/>`
          : `<circle r="15" fill="${color}" stroke="#111" stroke-width="3"/>`;
      g.innerHTML = `${shape}<text text-anchor="middle" dominant-baseline="central" y="1" font-family="inherit" font-weight="800" font-size="${sym.length > 1 ? 15 : 19}" fill="#fff"></text>`;
      const text = g.querySelector("text");
      if (text) text.textContent = sym;
      back.appendChild(g);
      setTimeout(
        () => {
          if (g.isConnected) fx.appendChild(g);
        },
        delay + T * switchAt,
      );
      const anim = tl(
        g,
        keys ?? [
          [0, `translate(${x - 44}px,${y + 58}px) scale(.45)`, OUT],
          [T * 0.24, `translate(${x}px,${y}px) scale(1.12)`, EASE],
          [T * 0.35, `translate(${x}px,${y}px) scale(1)`],
          [T * 0.8, { transform: `translate(${x}px,${y - 6}px) scale(1)`, opacity: 1 }, IN],
          [T, { transform: `translate(${x}px,${y - 16}px) scale(.9)`, opacity: 0 }],
        ],
        T,
        delay,
      );
      if (anim)
        anim.finished.then(
          () => g.remove(),
          () => g.remove(),
        );
      else g.remove();
    },
    [],
  );

  const confetti = useCallback((x: number, y: number, n: number, dir: number, delay = 0) => {
    const fx = fxRef.current;
    if (!fx) return;
    const colors = ["#f58220", "#1baca6", "#4f86c6", "#cf3a33", "#ffd27a", "#2c2f35"];
    for (let i = 0; i < n; i++) {
      const c = document.createElementNS(SVG_NS, "rect");
      c.setAttribute("x", "-2.5");
      c.setAttribute("y", "-4");
      c.setAttribute("width", "5");
      c.setAttribute("height", "8");
      c.setAttribute("rx", "1.5");
      c.setAttribute("fill", colors[i % colors.length]);
      c.setAttribute("class", classes.rig);
      c.style.opacity = "0";
      fx.appendChild(c);
      const dx = dir * (16 + Math.random() * 80);
      const dy = -50 - Math.random() * 80;
      const fall = 130 + Math.random() * 60;
      const r = 300 + Math.random() * 500;
      const T = 1500 + Math.random() * 300;
      const anim = tl(
        c,
        [
          [0, { transform: `translate(${x}px,${y}px) rotate(0deg)`, opacity: 1 }, OUT],
          [
            T * 0.32,
            {
              transform: `translate(${x + dx * 0.55}px,${y + dy}px) rotate(${r * 0.4}deg)`,
              opacity: 1,
            },
            IN,
          ],
          [
            T,
            {
              transform: `translate(${x + dx}px,${y + dy + fall}px) rotate(${r}deg)`,
              opacity: 0,
            },
          ],
        ],
        T,
        delay + Math.random() * 160,
      );
      if (anim)
        anim.finished.then(
          () => c.remove(),
          () => c.remove(),
        );
      else c.remove();
    }
  }, []);

  // Schwebende Musiknote
  const note = useCallback((x: number, y: number, delay: number) => {
    const fx = fxRef.current;
    if (!fx) return;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", classes.rig);
    g.style.opacity = "0";
    g.innerHTML =
      '<g fill="#17181b"><ellipse cx="0" cy="0" rx="5.2" ry="3.9" transform="rotate(-22)"/><rect x="3.4" y="-19" width="2.2" height="19" rx="1"/><path d="M5.6 -19 c7 2 9 7 6 13 c-.5 -5 -2.5 -7 -6 -8z"/></g>';
    fx.appendChild(g);
    const dx = (x < 0 ? -1 : 1) * (14 + Math.random() * 40);
    const sway = (Math.random() - 0.5) * 24;
    const r = (Math.random() - 0.5) * 40;
    const T = 1400;
    const anim = tl(
      g,
      [
        [0, { transform: `translate(${x}px,${y}px) scale(.3)`, opacity: 0 }, OUT],
        [T * 0.2, { transform: `translate(${x + dx * 0.3}px,${y - 24}px) scale(1)`, opacity: 1 }],
        [
          T * 0.6,
          {
            transform: `translate(${x + dx * 0.7 + sway}px,${y - 66}px) rotate(${r / 2}deg) scale(1)`,
            opacity: 1,
          },
        ],
        [
          T,
          {
            transform: `translate(${x + dx}px,${y - 104}px) rotate(${r}deg) scale(.9)`,
            opacity: 0,
          },
        ],
      ],
      T,
      delay,
    );
    if (anim)
      anim.finished.then(
        () => g.remove(),
        () => g.remove(),
      );
    else g.remove();
  }, []);

  // Schallwellen-Ring um den Kopf
  const ring = useCallback((delay = 0, color = "#f58220") => {
    const fx = fxRef.current;
    if (!fx) return;
    const e = document.createElementNS(SVG_NS, "ellipse");
    e.setAttribute("cx", "0");
    e.setAttribute("cy", "-160");
    e.setAttribute("rx", "96");
    e.setAttribute("ry", "44");
    e.setAttribute("fill", "none");
    e.setAttribute("stroke", color);
    e.setAttribute("stroke-width", "3");
    e.setAttribute("class", classes.fbox);
    e.style.opacity = "0";
    fx.appendChild(e);
    const anim = tl(
      e,
      [
        [0, { transform: "scale(.9)", opacity: 0.7 }, OUT],
        [700, { transform: "scale(1.4)", opacity: 0 }],
      ],
      700,
      delay,
    );
    if (anim)
      anim.finished.then(
        () => e.remove(),
        () => e.remove(),
      );
    else e.remove();
  }, []);

  // Der Kopf zieht sich in den Körper zurück und spuckt Fragezeichen aus.
  const retract = useCallback(
    async (marks: 1 | 2, color: string, shake: boolean) => {
      const T = marks === 1 ? 2700 : 3500;
      const R = T - 520;
      const spits = marks === 1 ? [1150] : [1150, 1650];
      const down: Key[] = [
        [0, "scaleY(1)"],
        [110, "scaleY(1.05)", IN],
        [400, "scaleY(.03)"],
        [R, "scaleY(.03)", BACK],
        [T, "scaleY(1)"],
      ];
      tl(legsRef.current, down, T);
      tl(torsoRef.current, down, T);
      tl(
        upperRef.current,
        [
          [0, "translateY(0px)"],
          [110, "translateY(-3px)", IN],
          [400, "translateY(46px)"],
          [R, "translateY(46px)", BACK],
          [T, "translateY(0px)"],
        ],
        T,
      );
      const wob = shake ? [-6, 6, -5, 5, -3, 0] : [-4, 4, -2, 0];
      const hk: Key[] = [
        [0, "translateY(0px) rotate(0deg)"],
        [110, "translateY(-5px) rotate(0deg)", IN],
        [400, "translateY(82px) rotate(0deg)"],
        [520, "translateY(82px) rotate(0deg)"],
      ];
      wob.forEach((a, i) => hk.push([600 + i * 85, `translateY(82px) rotate(${a}deg)`]));
      hk.push([R, "translateY(82px) rotate(0deg)", BACK], [T, "translateY(0px) rotate(0deg)"]);
      tl(headRef.current, hk, T);
      const sk: Key[] = [
        [0, "scale(1,1)"],
        [400, "scale(1,1)", OUT],
        [460, "scale(1.12,.84)"],
        [580, "scale(.96,1.04)"],
        [680, "scale(1,1)"],
      ];
      spits.forEach((sp) =>
        sk.push(
          [sp - 120, "scale(1,1)", OUT],
          [sp - 40, "scale(1.08,.88)", OUT],
          [sp + 60, "scale(.95,1.07)"],
          [sp + 180, "scale(1,1)"],
        ),
      );
      sk.push(
        [R, "scale(1,1)"],
        [R + 150, "scale(.94,1.08)"],
        [R + 320, "scale(1.04,.97)"],
        [T, "scale(1,1)"],
      );
      tl(squashRef.current, sk, T);
      tl(
        shadowRef.current,
        [
          [0, "scale(1)"],
          [400, "scale(1.12)"],
          [R, "scale(1.12)"],
          [T, "scale(1)"],
        ],
        T,
      );
      [eyeLRef.current, eyeRRef.current].forEach((e) =>
        tl(
          e,
          [
            [0, "scaleY(1)"],
            [400, "scaleY(.55)"],
            [R, "scaleY(.55)", BACK],
            [T, "scaleY(1)"],
          ],
          T,
        ),
      );
      all("[data-wave]").forEach((w) =>
        tl(
          w,
          [
            [0, { opacity: 1 }],
            [300, { opacity: 0 }],
            [R, { opacity: 0 }],
            [T, { opacity: 1 }],
          ],
          T,
        ),
      );
      spits.forEach((sp, i) => {
        const side = i % 2 ? -1 : 1;
        const D = 1500;
        chip(
          "?",
          color,
          0,
          -60,
          D,
          sp - 40,
          [
            [0, "translate(0px,-56px) scale(.25) rotate(0deg)", OUT],
            [D * 0.26, `translate(${side * 26}px,-150px) scale(1.15) rotate(${side * -12}deg)`, IN],
            [D * 0.5, `translate(${side * 52}px,-118px) scale(1) rotate(${side * 10}deg)`, BACK],
            [D * 0.58, `translate(${side * 54}px,-124px) scale(1) rotate(${side * 6}deg)`],
            [
              D * 0.85,
              {
                transform: `translate(${side * 54}px,-124px) scale(1) rotate(${side * 6}deg)`,
                opacity: 1,
              },
              IN,
            ],
            [
              D,
              {
                transform: `translate(${side * 56}px,-132px) scale(.85) rotate(${side * 6}deg)`,
                opacity: 0,
              },
            ],
          ],
          0.1,
        );
      });
      await wait(T);
    },
    [chip],
  );

  // Musikbox: Tanz im Takt bei !!
  const dance = useCallback(async () => {
    const o = 120;
    const beat = 280;
    const beats = 6;
    const T = o + beats * beat + 220;
    const jk: Key[] = [
      [0, "translateY(0px)"],
      [o, "translateY(0px)", OUT],
    ];
    const sk: Key[] = [
      [0, "scale(1,1)", OUT],
      [o, "scale(1.08,.92)"],
    ];
    const hk: Key[] = [[0, "rotate(0deg)"]];
    const ek: Key[] = [[0, "scale(1)"]];
    const shk: Key[] = [
      [0, "scale(1)"],
      [o, "scale(1)", OUT],
    ];
    const al: Key[] = [[0, "rotate(0deg)", OUT]];
    const ar: Key[] = [[0, "rotate(0deg)", OUT]];
    for (let i = 0; i < beats; i++) {
      const t0 = o + i * beat;
      const ap = t0 + beat / 2;
      const g = o + (i + 1) * beat;
      jk.push([ap, "translateY(-15px)", IN], [g, "translateY(0px)", OUT]);
      sk.push([t0 + 70, "scale(.96,1.05)"], [ap, "scale(1,1)"], [g, "scale(1.08,.92)", OUT]);
      hk.push([ap, `rotate(${i % 2 ? 6 : -6}deg)`]);
      ek.push([ap, "scale(1.22)"], [g, "scale(1)"]);
      shk.push([ap, "scale(.8)", IN], [g, "scale(1)", OUT]);
      al.push([ap, `rotate(${i % 2 ? 115 : 150}deg)`]);
      ar.push([ap, `rotate(${i % 2 ? -150 : -115}deg)`]);
      ring(ap);
    }
    jk.push([T, "translateY(0px)"]);
    sk.push([T, "scale(1,1)"]);
    hk.push([T, "rotate(0deg)"]);
    ek.push([T, "scale(1)"]);
    shk.push([T, "scale(1)"]);
    al.push([T - 160, "rotate(130deg)", INOUT], [T, "rotate(0deg)"]);
    ar.push([T - 160, "rotate(-130deg)", INOUT], [T, "rotate(0deg)"]);
    tl(jumpRef.current, jk, T);
    tl(squashRef.current, sk, T);
    tl(headRef.current, hk, T);
    tl(shadowRef.current, shk, T);
    [eyeLRef.current, eyeRRef.current].forEach((e) => tl(e, ek, T));
    tl(armLRef.current, al, T);
    tl(armRRef.current, ar, T);
    for (let i = 0; i < 10; i++) note(i % 2 ? -72 : 72, -165, 150 + i * 160);
    chip("!!", "#1baca6", 100, -222, 1700, 60);
    await wait(T);
  }, [chip, note, ring]);

  const play = useCallback(
    async (name: CoachAnimation) => {
      if (busy.current || prefersReducedMotion()) return;
      busy.current = true;
      const head = headRef.current;
      const squash = squashRef.current;
      const armL = armLRef.current;
      const armR = armRRef.current;
      try {
        if (name === "hello") {
          const T = 1900;
          const k: Key[] = [
            [0, "rotate(0deg)", OUT],
            [320, "rotate(-150deg)", INOUT],
          ];
          for (let i = 0; i < 4; i++)
            k.push([520 + i * 260, `rotate(${i % 2 ? -150 : -122}deg)`, INOUT]);
          k.push([1650, "rotate(-140deg)", INOUT], [T, "rotate(0deg)"]);
          tl(armR, k, T);
          tl(
            head,
            [
              [0, "rotate(0deg)", INOUT],
              [400, "rotate(5deg)"],
              [1500, "rotate(5deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          tl(
            squash,
            [
              [0, "scale(1,1)", OUT],
              [140, "scale(1.04,.96)"],
              [320, "scale(1,1)"],
              [T, "scale(1,1)"],
            ],
            T,
          );
          await wait(T);
        } else if (name === "think") {
          const T = 2100;
          all("[data-btn]").forEach((b, i) => {
            const k: Key[] = [[0, { fill: "#f58220" }]];
            for (let r = 0; r < 4; r++) {
              const t = 100 + r * 480 + i * 140;
              k.push(
                [t, { fill: "#f58220" }, OUT],
                [t + 120, { fill: "#fff6d6" }, EASE],
                [t + 330, { fill: "#f58220" }],
              );
            }
            k.push([T, { fill: "#f58220" }]);
            tl(b, k, T);
          });
          tl(
            head,
            [
              [0, "rotate(0deg)", INOUT],
              [500, "rotate(-3deg)", INOUT],
              [1100, "rotate(3deg)", INOUT],
              [1700, "rotate(-2deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          all("[data-wave]").forEach((w) =>
            tl(
              w,
              [
                [0, { opacity: 1 }],
                [300, { opacity: 0.15 }],
                [T - 300, { opacity: 0.15 }],
                [T, { opacity: 1 }],
              ],
              T,
            ),
          );
          await wait(T);
        } else if (name === "good") {
          const T = 900;
          tl(
            head,
            [
              [0, "translateY(0px) scale(1,1)"],
              [150, "translateY(5px) scale(1.02,.95)", OUT],
              [330, "translateY(-2px) scale(1,1)"],
              [480, "translateY(4px) scale(1.02,.96)", OUT],
              [660, "translateY(0px) scale(1,1)"],
              [T, "translateY(0px) scale(1,1)"],
            ],
            T,
          );
          tl(
            armR,
            [
              [0, "rotate(0deg)", OUT],
              [250, "rotate(-75deg)"],
              [380, "rotate(-60deg)"],
              [520, "rotate(-75deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          chip("!", "#4f86c6", 100, -222, 1200, 80);
          await wait(T + 200);
        } else if (name === "win") {
          const T = 1900;
          tl(
            squash,
            [
              [0, "scale(1,1)", OUT],
              [180, "scale(1.1,.88)", OUT],
              [300, "scale(.94,1.08)"],
              [520, "scale(1,1)"],
              [760, "scale(1,1)", OUT],
              [820, "scale(1.12,.86)", OUT],
              [960, "scale(.97,1.03)"],
              [1100, "scale(1,1)"],
              [1300, "scale(1.05,.95)", OUT],
              [1420, "scale(1,1)"],
              [T, "scale(1,1)"],
            ],
            T,
          );
          tl(
            jumpRef.current,
            [
              [0, "translateY(0px)"],
              [180, "translateY(0px)", OUT],
              [480, "translateY(-46px)", IN],
              [780, "translateY(0px)", OUT],
              [1040, "translateY(-14px)", IN],
              [1300, "translateY(0px)"],
              [T, "translateY(0px)"],
            ],
            T,
          );
          tl(
            shadowRef.current,
            [
              [0, "scale(1)"],
              [180, "scale(1)", OUT],
              [480, "scale(.6)", IN],
              [780, "scale(1)"],
              [T, "scale(1)"],
            ],
            T,
          );
          tl(
            armL,
            [
              [0, "rotate(0deg)", OUT],
              [300, "rotate(150deg)"],
              [1500, "rotate(140deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          tl(
            armR,
            [
              [0, "rotate(0deg)", OUT],
              [300, "rotate(-150deg)"],
              [1500, "rotate(-140deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          confetti(-72, -160, 16, -1, 420);
          confetti(72, -160, 16, 1, 420);
          await wait(T);
        } else if (name === "bril") {
          await dance();
        } else if (name === "mis") {
          await retract(1, "#e07b24", false);
        } else if (name === "blu") {
          await retract(2, "#cf3a33", true);
        } else if (name === "int") {
          const T = 1300;
          tl(
            head,
            [
              [0, "translateY(0px)", BACK],
              [260, "translateY(-10px)"],
              [950, "translateY(-10px)", INOUT],
              [T, "translateY(0px)"],
            ],
            T,
          );
          [eyeLRef.current, eyeRRef.current].forEach((e) =>
            tl(
              e,
              [
                [0, "scale(1)", BACK],
                [240, "scale(1.32)"],
                [950, "scale(1.32)", INOUT],
                [T, "scale(1)"],
              ],
              T,
            ),
          );
          tl(
            squash,
            [
              [0, "scale(1,1)", OUT],
              [120, "scale(.97,1.04)"],
              [300, "scale(1,1)"],
              [T, "scale(1,1)"],
            ],
            T,
          );
          chip("!?", "#b45fc9", 100, -222, 1300, 120);
          await wait(T);
        } else if (name === "dub") {
          const T = 1500;
          tl(
            head,
            [
              [0, "rotate(0deg)", BACK],
              [320, "rotate(11deg)"],
              [1100, "rotate(11deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          tl(
            eyeRRef.current,
            [
              [0, "scaleY(1)", OUT],
              [300, "scaleY(.55)"],
              [1100, "scaleY(.55)", INOUT],
              [T, "scaleY(1)"],
            ],
            T,
          );
          tl(
            armL,
            [
              [0, "rotate(0deg)", OUT],
              [350, "rotate(95deg)"],
              [1100, "rotate(95deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          chip("?!", "#d9a514", 100, -222, 1400, 200);
          await wait(T);
        } else if (name === "loss") {
          const T = 2300;
          tl(
            upperRef.current,
            [
              [0, "translateY(0px)", INOUT],
              [500, "translateY(5px)"],
              [1900, "translateY(5px)", INOUT],
              [T, "translateY(0px)"],
            ],
            T,
          );
          tl(
            head,
            [
              [0, "rotate(0deg)", INOUT],
              [500, "rotate(-7deg)"],
              [1900, "rotate(-7deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          [eyeLRef.current, eyeRRef.current].forEach((e) =>
            tl(
              e,
              [
                [0, "scaleY(1)", INOUT],
                [500, "scaleY(.45)"],
                [1900, "scaleY(.45)", INOUT],
                [T, "scaleY(1)"],
              ],
              T,
            ),
          );
          tl(
            armL,
            [
              [0, "rotate(0deg)", OUT],
              [700, "rotate(28deg)"],
              [900, "rotate(28deg)", IN],
              [1200, "rotate(0deg)"],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          tl(
            armR,
            [
              [0, "rotate(0deg)", OUT],
              [700, "rotate(-28deg)"],
              [900, "rotate(-28deg)", IN],
              [1200, "rotate(0deg)"],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          all("[data-wave]").forEach((w) =>
            tl(
              w,
              [
                [0, { opacity: 1 }],
                [500, { opacity: 0 }],
                [1900, { opacity: 0 }],
                [T, { opacity: 1 }],
              ],
              T,
            ),
          );
          await wait(T);
        } else if (name === "salto") {
          // Rückwärtssalto um die Körpermitte (en passant)
          const T = 1200;
          const at = (y: number, a: number) =>
            `translateY(${y}px) translate(0px,-120px) rotate(${a}deg) translate(0px,120px)`;
          tl(
            jumpRef.current,
            [
              [0, at(0, 0), OUT],
              [160, at(6, 0), OUT],
              [560, at(-80, -180), IN],
              [960, at(0, -360), OUT],
              [T, at(0, -360)],
            ],
            T,
          );
          tl(
            squash,
            [
              [0, "scale(1,1)", OUT],
              [160, "scale(1.1,.88)", OUT],
              [300, "scale(.95,1.06)"],
              [960, "scale(1,1)", OUT],
              [1060, "scale(1.08,.92)", OUT],
              [T, "scale(1,1)"],
            ],
            T,
          );
          tl(
            shadowRef.current,
            [
              [0, "scale(1)", OUT],
              [560, "scale(.55)", IN],
              [960, "scale(1)"],
              [T, "scale(1)"],
            ],
            T,
          );
          await wait(T);
        } else if (name === "scared") {
          // Erschrickt und fällt fast nach hinten um
          const T = 1700;
          tl(
            jumpRef.current,
            [
              [0, "translate(0px,0px) rotate(0deg)", OUT],
              [160, "translate(10px,-34px) rotate(-8deg)", IN],
              [420, "translate(22px,0px) rotate(-24deg)", OUT],
              [700, "translate(22px,0px) rotate(-14deg)", INOUT],
              [950, "translate(22px,0px) rotate(-20deg)", INOUT],
              [1350, "translate(8px,0px) rotate(-3deg)", INOUT],
              [T, "translate(0px,0px) rotate(0deg)"],
            ],
            T,
          );
          [eyeLRef.current, eyeRRef.current].forEach((e) =>
            tl(
              e,
              [
                [0, "scale(1)", BACK],
                [160, "scale(1.5)"],
                [1200, "scale(1.4)", INOUT],
                [T, "scale(1)"],
              ],
              T,
            ),
          );
          tl(
            armL,
            [
              [0, "rotate(0deg)", BACK],
              [200, "rotate(120deg)"],
              [1200, "rotate(110deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          tl(
            armR,
            [
              [0, "rotate(0deg)", BACK],
              [200, "rotate(-120deg)"],
              [1200, "rotate(-110deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          await wait(T);
        } else if (name === "facepalm") {
          // Hand vor die Box
          const T = 2000;
          tl(
            armR,
            [
              [0, "rotate(0deg)", OUT],
              [350, "rotate(-165deg)"],
              [1600, "rotate(-160deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          tl(
            head,
            [
              [0, "rotate(0deg)", OUT],
              [380, "rotate(9deg)"],
              [1600, "rotate(7deg)", INOUT],
              [T, "rotate(0deg)"],
            ],
            T,
          );
          tl(
            squash,
            [
              [0, "scale(1,1)", OUT],
              [380, "scale(1.03,.95)"],
              [1600, "scale(1.03,.95)", INOUT],
              [T, "scale(1,1)"],
            ],
            T,
          );
          await wait(T);
        }
      } finally {
        busy.current = false;
      }
    },
    [chip, confetti, dance, retract],
  );

  useImperativeHandle(ref, () => ({ play }), [play]);

  // Laufende Animationen beim Verlassen beenden.
  useEffect(() => {
    const svg = svgRef.current;
    return () => {
      svg?.getAnimations?.({ subtree: true }).forEach((a) => {
        if (a instanceof CSSAnimation) return;
        a.cancel();
      });
    };
  }, []);

  const rig = classes.rig;

  return (
    <svg
      ref={svgRef}
      className={classes.svg}
      viewBox={headOnly ? "50 12 200 200" : "0 0 300 300"}
      role="img"
      aria-label={title}
      style={{ width: size, height: size }}
    >
      <defs>
        <linearGradient id={id("cap")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffa04a" />
          <stop offset="1" stopColor="#dd640f" />
        </linearGradient>
        <linearGradient id={id("fab")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={wears("blueBox") ? "#4f86c6" : "#474b54"} />
          <stop offset=".55" stopColor={wears("blueBox") ? "#2f5f9e" : "#2c2f35"} />
          <stop offset="1" stopColor={wears("blueBox") ? "#1d3f6e" : "#1a1b1f"} />
        </linearGradient>
        <radialGradient id={id("rad")} cx=".4" cy=".35" r=".8">
          <stop offset="0" stopColor="#666a73" />
          <stop offset="1" stopColor="#1d1e22" />
        </radialGradient>
        <linearGradient id={id("torso")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#22242a" />
          <stop offset=".45" stopColor="#3b3f47" />
          <stop offset="1" stopColor="#1c1d22" />
        </linearGradient>
        <linearGradient id={id("shoe")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9d45" />
          <stop offset="1" stopColor="#d9600c" />
        </linearGradient>
        <pattern id={id("grille")} width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="3.5" cy="3.5" r="1.3" fill="#0d0e10" opacity=".55" />
        </pattern>
      </defs>

      <g transform="translate(150 280)">
        <ellipse
          ref={shadowRef}
          className={classes.fbox}
          cx="0"
          cy="2"
          rx="62"
          ry="7"
          fill="#000"
          opacity=".2"
        />
        <g ref={fxBackRef} />
        <g ref={jumpRef} className={rig}>
          <g className={`${rig} ${classes.breath}`}>
            <g ref={squashRef} className={rig}>
              {/* Beine, Gelenk an den Füßen */}
              <g ref={legsRef} className={rig} stroke="#17181b" strokeLinecap="round">
                <path d="M-9 -46 L-11 -8 M9 -46 L11 -8" strokeWidth="8" fill="none" />
                <rect
                  x="-25"
                  y="-10"
                  width="22"
                  height="10"
                  rx="5"
                  fill={`url(#${id("shoe")})`}
                  strokeWidth="3"
                />
                <rect
                  x="3"
                  y="-10"
                  width="22"
                  height="10"
                  rx="5"
                  fill={`url(#${id("shoe")})`}
                  strokeWidth="3"
                />
              </g>

              {/* Oberkörper, Gelenk an der Hüfte */}
              <g transform="translate(0 -46)">
                <g ref={upperRef} className={rig}>
                  <g transform="translate(0 46)">
                    {/* Rumpf mit Armen, Gelenk an der Hüfte */}
                    <g transform="translate(0 -46)">
                      <g ref={torsoRef} className={rig}>
                        <g transform="translate(0 46)">
                          <rect x="-6" y="-136" width="12" height="26" rx="4" fill="#17181b" />
                          <g stroke="#17181b" strokeWidth="7" strokeLinecap="round" fill="none">
                            <g transform="translate(-15 -102)">
                              <g ref={armLRef} className={rig}>
                                <g transform="translate(15 102)">
                                  <path d="M-15 -102 L-29 -74" />
                                  <circle
                                    cx="-30"
                                    cy="-71.5"
                                    r="5.5"
                                    fill="#17181b"
                                    stroke="none"
                                  />
                                </g>
                              </g>
                            </g>
                            <g transform="translate(15 -102)">
                              <g ref={armRRef} className={rig}>
                                <g transform="translate(-15 102)">
                                  <path d="M15 -102 L29 -74" />
                                  <circle cx="30" cy="-71.5" r="5.5" fill="#17181b" stroke="none" />
                                </g>
                              </g>
                            </g>
                          </g>
                          <rect
                            x="-21"
                            y="-118"
                            width="42"
                            height="76"
                            rx="21"
                            fill={`url(#${id("torso")})`}
                            stroke="#111"
                            strokeWidth="3.5"
                          />
                          <path
                            d="M-11 -106 Q-13 -82 -11 -60"
                            stroke="#fff"
                            strokeWidth="3"
                            opacity=".12"
                            fill="none"
                            strokeLinecap="round"
                          />
                          <circle cx="0" cy="-96" r="3.2" fill="#f58220" />
                        </g>
                      </g>
                    </g>

                    {/* Kopf: JBL-Box, Gelenk am Hals */}
                    <g transform="translate(0 -130)">
                      <g ref={headRef} className={rig}>
                        <g transform="translate(0 130)">
                          {(wears("bunnyEars") || wears("headphones")) && (
                            <HeadBack outfit={outfit} />
                          )}
                          <g
                            fill="none"
                            stroke="#f58220"
                            strokeWidth="5.5"
                            strokeLinecap="round"
                            transform={lift ? `translate(0 ${-lift})` : undefined}
                          >
                            <path
                              data-wave
                              className={classes.wave}
                              d="M-18 -201 Q0 -210 18 -201"
                            />
                            <path
                              data-wave
                              className={`${classes.wave} ${classes.wave2}`}
                              d="M-31 -215 Q0 -230 31 -215"
                              opacity=".7"
                            />
                          </g>
                          <rect
                            x="-86"
                            y="-191"
                            width="52"
                            height="62"
                            rx="29"
                            fill={`url(#${id("cap")})`}
                            stroke="#111"
                            strokeWidth="3.5"
                          />
                          <rect
                            x="34"
                            y="-191"
                            width="52"
                            height="62"
                            rx="29"
                            fill={`url(#${id("cap")})`}
                            stroke="#111"
                            strokeWidth="3.5"
                          />
                          <rect
                            x="-62"
                            y="-188"
                            width="124"
                            height="56"
                            fill={`url(#${id("fab")})`}
                            stroke="#111"
                            strokeWidth="3.5"
                          />
                          <rect
                            x="-60"
                            y="-178"
                            width="120"
                            height="44"
                            fill={`url(#${id("grille")})`}
                          />
                          <path
                            d="M-56 -181 H56"
                            stroke="#fff"
                            strokeWidth="1.6"
                            opacity=".15"
                            strokeLinecap="round"
                          />
                          <g stroke="#111" strokeWidth="1.8">
                            <rect
                              data-btn
                              x="-21"
                              y="-185"
                              width="12"
                              height="5"
                              rx="2.5"
                              fill="#f58220"
                            />
                            <rect
                              data-btn
                              x="-6"
                              y="-185"
                              width="12"
                              height="5"
                              rx="2.5"
                              fill="#f58220"
                            />
                            <rect
                              data-btn
                              x="9"
                              y="-185"
                              width="12"
                              height="5"
                              rx="2.5"
                              fill="#f58220"
                            />
                          </g>
                          {[-72, 72].map((cx) => (
                            <g key={cx} ref={cx < 0 ? eyeLRef : eyeRRef} className={classes.fbox}>
                              <g className={`${classes.fbox} ${classes.blink}`}>
                                <ellipse
                                  cx={cx}
                                  cy="-160"
                                  rx="9.5"
                                  ry="21"
                                  fill={`url(#${id("rad")})`}
                                  stroke="#111"
                                  strokeWidth="2.8"
                                />
                                <ellipse cx={cx} cy="-160" rx="3.8" ry="8.6" fill="#f58220" />
                                <ellipse
                                  cx={cx - 2.5}
                                  cy="-170"
                                  rx="2"
                                  ry="3.5"
                                  fill="#fff"
                                  opacity=".35"
                                />
                              </g>
                            </g>
                          ))}
                          <Outfit outfit={outfit} />
                        </g>
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
        <g ref={fxRef} />
      </g>
    </svg>
  );
});

// Was hinter dem Kopf sitzt (Hasenohren, Kopfhörerbügel)
function HeadBack({ outfit }: { outfit: readonly CoachItemId[] }) {
  return (
    <g stroke="#111" strokeWidth="3">
      {outfit.includes("bunnyEars") &&
        [-1, 1].map((d) => (
          <g key={d} transform={`rotate(${d * 14} ${d * 24} -186)`}>
            <ellipse cx={d * 24} cy="-228" rx="12" ry="40" fill="#f3efe9" />
            <ellipse cx={d * 24} cy="-226" rx="5.5" ry="29" fill="#f6b5c4" stroke="none" />
          </g>
        ))}
      {outfit.includes("headphones") && (
        <path
          d="M-84 -168 Q-86 -236 0 -238 Q86 -236 84 -168"
          fill="none"
          stroke="#25272c"
          strokeWidth="9"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

// Verzierungen vor dem Kopf
function Outfit({ outfit }: { outfit: readonly CoachItemId[] }) {
  const has = (i: CoachItemId) => outfit.includes(i);
  return (
    <g stroke="#111" strokeWidth="2.8" strokeLinejoin="round">
      {has("sunglasses") &&
        [-72, 72].map((cx) => (
          <g key={cx}>
            <rect x={cx - 15} y="-177" width="30" height="24" rx="9" fill="#141518" />
            <path
              d={`M${cx - 8} -172 L${cx - 2} -166`}
              stroke="#fff"
              strokeWidth="2.4"
              opacity=".5"
              strokeLinecap="round"
            />
          </g>
        ))}
      {has("headphones") &&
        [-1, 1].map((d) => (
          <rect
            key={d}
            x={d < 0 ? -102 : 84}
            y="-184"
            width="18"
            height="44"
            rx="8"
            fill="#25272c"
          />
        ))}
      {has("beanie") && (
        <g>
          <path d="M-42 -190 Q-44 -236 0 -238 Q44 -236 42 -190 Z" fill="#cf3a33" />
          <rect x="-47" y="-197" width="94" height="13" rx="6.5" fill="#e8e1d6" />
          <circle cx="0" cy="-242" r="9" fill="#e8e1d6" />
        </g>
      )}
      {has("crown") && (
        <path
          d="M-32 -189 L-36 -226 L-16 -207 L0 -232 L16 -207 L36 -226 L32 -189 Z"
          fill="#f2c94c"
        />
      )}
      {has("partyHat") && (
        <g>
          <path d="M-24 -189 L0 -248 L24 -189 Z" fill="#4f86c6" />
          <path d="M-14 -213 L10 -229 M-19 -201 L17 -215" stroke="#ffd27a" strokeWidth="5" />
          <circle cx="0" cy="-251" r="7" fill="#f58220" />
        </g>
      )}
      {has("scarf") && (
        <g>
          <rect x="-22" y="-134" width="44" height="13" rx="6.5" fill="#1baca6" />
          <rect x="6" y="-126" width="12" height="30" rx="4" fill="#1baca6" />
          <path d="M8 -112 H16 M8 -104 H16" stroke="#e8e1d6" strokeWidth="3" />
        </g>
      )}
      {has("bowtie") && (
        <path d="M0 -126 L-17 -135 L-17 -117 Z M0 -126 L17 -135 L17 -117 Z" fill="#cf3a33" />
      )}
      {has("medal") && (
        <g>
          <path d="M-12 -133 L0 -110 L12 -133" fill="none" stroke="#4f86c6" strokeWidth="6" />
          <circle cx="0" cy="-104" r="10" fill="#f2c94c" />
        </g>
      )}
    </g>
  );
}

export default CoachFigure;
