import type { LocalEngine } from "@/utils/engines";

/** Prefers Patricia, the engine that likes to attack. */
export function pickBrillianceEngine(engines: LocalEngine[], saved: string): string {
    if (saved && engines.some((e) => e.id === saved)) return saved;
    const patricia = engines.find((e) => /patricia/i.test(e.name) || /patricia/i.test(e.path));
    return (patricia ?? engines[0])?.id ?? "";
}

/** "14...Nxf2" from the position before the move. */
export function numberedMove(fen: string, san: string): string {
    const parts = fen.split(" ");
    const turn = parts[1] ?? "w";
    const fullmove = Number.parseInt(parts[5] ?? "1", 10) || 1;
    return turn === "w" ? `${fullmove}.${san}` : `${fullmove}...${san}`;
}

/** Path from the start position in short notation: "1.e4 e5 2.Nf3". */
export function numberedLine(startFen: string, sans: string[]): string {
    const parts = startFen.split(" ");
    let white = (parts[1] ?? "w") === "w";
    let fullmove = Number.parseInt(parts[5] ?? "1", 10) || 1;
    const out: string[] = [];
    sans.forEach((san, i) => {
        if (white) out.push(`${fullmove}.${san}`);
        else out.push(i === 0 ? `${fullmove}...${san}` : san);
        if (!white) fullmove++;
        white = !white;
    });
    return out.join(" ");
}
