import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef } from "react";
import classes from "./CoachFigure.module.css";

// Die JBL-Figur: Bohnenkörper, Kopf ist die JBL-Box aus dem Logo.
// Gezeichnet mit den Füßen bei (0,0), Hüfte bei y -46, Hals bei y -130.

export type CoachAnimation = "hello" | "think" | "good" | "win" | "loss";

export type CoachFigureHandle = {
  play: (name: CoachAnimation) => Promise<void>;
};

type Key = [number, string | Keyframe, string?];

const EASE = "cubic-bezier(.45,0,.25,1)";
const OUT = "cubic-bezier(.22,1,.36,1)";
const IN = "cubic-bezier(.55,0,1,.45)";
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

const CoachFigure = forwardRef<CoachFigureHandle, { size?: number; title?: string }>(
  function CoachFigure({ size = 120, title = "JBL Coach" }, ref) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
    const id = (name: string) => `jbl${uid}${name}`;

    const svgRef = useRef<SVGSVGElement>(null);
    const fxRef = useRef<SVGGElement>(null);
    const fxBackRef = useRef<SVGGElement>(null);
    const jumpRef = useRef<SVGGElement>(null);
    const squashRef = useRef<SVGGElement>(null);
    const upperRef = useRef<SVGGElement>(null);
    const headRef = useRef<SVGGElement>(null);
    const shadowRef = useRef<SVGEllipseElement>(null);
    const armLRef = useRef<SVGGElement>(null);
    const armRRef = useRef<SVGGElement>(null);
    const eyeLRef = useRef<SVGGElement>(null);
    const eyeRRef = useRef<SVGGElement>(null);
    const busy = useRef(false);

    const all = (sel: string) =>
      Array.from(svgRef.current?.querySelectorAll(sel) ?? []) as Element[];

    // Ein Bewertungs-Chip entsteht hinter der Figur und kommt erst nach vorn,
    // sobald er aufsteigt.
    const chip = useCallback(
      (sym: string, color: string, x: number, y: number, T = 1300, delay = 0) => {
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
          delay + T * 0.14,
        );
        const anim = tl(
          g,
          [
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
          }
        } finally {
          busy.current = false;
        }
      },
      [chip, confetti],
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
        viewBox="0 0 300 300"
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
            <stop offset="0" stopColor="#474b54" />
            <stop offset=".55" stopColor="#2c2f35" />
            <stop offset="1" stopColor="#1a1b1f" />
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
                {/* Beine */}
                <g stroke="#17181b" strokeLinecap="round">
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
                      <rect x="-6" y="-136" width="12" height="26" rx="4" fill="#17181b" />
                      <g stroke="#17181b" strokeWidth="7" strokeLinecap="round" fill="none">
                        <g transform="translate(-15 -102)">
                          <g ref={armLRef} className={rig}>
                            <g transform="translate(15 102)">
                              <path d="M-15 -102 L-29 -74" />
                              <circle cx="-30" cy="-71.5" r="5.5" fill="#17181b" stroke="none" />
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

                      {/* Kopf: JBL-Box, Gelenk am Hals */}
                      <g transform="translate(0 -130)">
                        <g ref={headRef} className={rig}>
                          <g transform="translate(0 130)">
                            <g fill="none" stroke="#f58220" strokeWidth="5.5" strokeLinecap="round">
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
  },
);

export default CoachFigure;
