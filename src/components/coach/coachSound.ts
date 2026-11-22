import { getDefaultStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { soundVolumeAtom } from "@/state/atoms";

// Leise Töne des Coaches (1.2.9): passend zur Stimmung, im Browser erzeugt,
// ohne Tondateien. Lautstärke folgt der normalen Lautstärke, nur leiser;
// abschalten unter Einstellungen → Ton.

export const coachSoundAtom = atomWithStorage<boolean>("jbl-coach-sound", true);

export type CoachTone =
    | "brilliant"
    | "good"
    | "interesting"
    | "dubious"
    | "mistake"
    | "blunder"
    | "win"
    | "draw"
    | "loss"
    | "lesson"
    // Krasse Momente (1.2.20): Jubel und großer Jubel
    | "fanfare"
    | "mega";

// Ein Ton: Frequenz (Hz), Beginn und Dauer (s), optional ein Gleiten zur
// Zielfrequenz (für die traurige Posaune)
export type Note = { f: number; at: number; dur: number; to?: number; wave?: OscillatorType };

// Noten als Frequenzen (gleichstufig, A4 = 440 Hz)
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const A4 = 440;
const D5 = 587.33;
const F4 = 349.23;
const Fs4 = 369.99;
const Bb3 = 233.08;
const G3 = 196;

export const COACH_TONES: Record<CoachTone, Note[]> = {
    // Dur-Arpeggio nach oben
    brilliant: [
        { f: C5, at: 0, dur: 0.12 },
        { f: E5, at: 0.1, dur: 0.12 },
        { f: G5, at: 0.2, dur: 0.12 },
        { f: C6, at: 0.3, dur: 0.3 },
    ],
    // Zwei Töne nach oben
    good: [
        { f: E5, at: 0, dur: 0.1 },
        { f: G5, at: 0.09, dur: 0.18 },
    ],
    // Fragend: Quarte nach oben, kurz
    interesting: [
        { f: D5, at: 0, dur: 0.1 },
        { f: G5, at: 0.1, dur: 0.14, wave: "triangle" },
    ],
    // Leicht schief: kleine Sekunde nach unten
    dubious: [
        { f: A4, at: 0, dur: 0.12, wave: "triangle" },
        { f: 415.3, at: 0.11, dur: 0.18, wave: "triangle" },
    ],
    // Misston: zwei Töne, die sich reiben
    mistake: [
        { f: F4, at: 0, dur: 0.28, wave: "triangle" },
        { f: Fs4, at: 0, dur: 0.28, wave: "triangle" },
    ],
    // Tiefer, schräger Akkord
    blunder: [
        { f: Bb3, at: 0, dur: 0.45, wave: "sawtooth" },
        { f: 246.94, at: 0, dur: 0.45, wave: "sawtooth" },
    ],
    // Kleine Fanfare
    win: [
        { f: G5 / 2, at: 0, dur: 0.12 },
        { f: C5, at: 0.12, dur: 0.12 },
        { f: E5, at: 0.24, dur: 0.12 },
        { f: G5, at: 0.36, dur: 0.4 },
    ],
    draw: [
        { f: C5, at: 0, dur: 0.18, wave: "triangle" },
        { f: C5, at: 0.2, dur: 0.25, wave: "triangle" },
    ],
    // Traurige Posaune, nach unten gleitend
    loss: [
        { f: A4 / 2 + 20, at: 0, dur: 0.3, wave: "sawtooth" },
        { f: A4 / 2, at: 0.32, dur: 0.3, wave: "sawtooth" },
        { f: G3 + 10, at: 0.64, dur: 0.7, to: G3 - 20, wave: "sawtooth" },
    ],
    // Schnelles Arpeggio über zwei Oktaven, am Ende ein voller Akkord
    fanfare: [
        { f: C5, at: 0, dur: 0.1 },
        { f: E5, at: 0.07, dur: 0.1 },
        { f: G5, at: 0.14, dur: 0.1 },
        { f: C6, at: 0.21, dur: 0.1 },
        { f: C6 * 1.26, at: 0.28, dur: 0.1 },
        { f: C6, at: 0.4, dur: 0.6 },
        { f: G5, at: 0.4, dur: 0.6 },
        { f: E5, at: 0.4, dur: 0.6 },
    ],
    // Siegesfanfare: Ta-ta-taa, dann ein großer Dur-Akkord mit Bass
    mega: [
        { f: G5, at: 0, dur: 0.12, wave: "triangle" },
        { f: G5, at: 0.14, dur: 0.12, wave: "triangle" },
        { f: G5, at: 0.28, dur: 0.12, wave: "triangle" },
        { f: C6, at: 0.42, dur: 0.3, wave: "triangle" },
        { f: C6, at: 0.78, dur: 0.7 },
        { f: E5 * 2, at: 0.78, dur: 0.7 },
        { f: G5, at: 0.78, dur: 0.7 },
        { f: C5 / 2, at: 0.78, dur: 0.7, wave: "triangle" },
    ],
    lesson: [
        { f: E5, at: 0, dur: 0.1 },
        { f: G5, at: 0.1, dur: 0.1 },
        { f: C6, at: 0.2, dur: 0.25 },
    ],
};

// Leise: höchstens ein Viertel der eingestellten Lautstärke
export const COACH_VOLUME_FACTOR = 0.25;

let ctx: AudioContext | null = null;

export function playCoachTone(tone: CoachTone) {
    const store = getDefaultStore();
    if (!store.get(coachSoundAtom)) return;
    const volume = store.get(soundVolumeAtom) * COACH_VOLUME_FACTOR;
    if (volume <= 0) return;
    const Ctx = typeof window !== "undefined" ? window.AudioContext : undefined;
    if (!Ctx) return;
    try {
        ctx ??= new Ctx();
        if (ctx.state === "suspended") void ctx.resume();
        const start = ctx.currentTime + 0.02;
        for (const n of COACH_TONES[tone]) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = n.wave ?? "sine";
            osc.frequency.setValueAtTime(n.f, start + n.at);
            if (n.to) osc.frequency.linearRampToValueAtTime(n.to, start + n.at + n.dur);
            // Weich ein- und ausblenden, sonst knackt es
            const peak = n.wave === "sawtooth" ? volume * 0.35 : volume;
            gain.gain.setValueAtTime(0, start + n.at);
            gain.gain.linearRampToValueAtTime(peak, start + n.at + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + n.at + n.dur);
            osc.connect(gain).connect(ctx.destination);
            osc.start(start + n.at);
            osc.stop(start + n.at + n.dur + 0.05);
        }
    } catch {
        // Kein Ton ist besser als ein Fehler
    }
}
