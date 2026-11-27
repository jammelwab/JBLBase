// Erzeugt src/components/coach/coachLessonLines.ts: die Folgezüge, die der
// Coach nach dem Beispiel und nach jeder gelösten Aufgabe vorspielt.
// Braucht Stockfish im PATH (oder STOCKFISH=/pfad/zu/stockfish).
//   node scripts/coach-lesson-lines.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import { parseUci } from "chessops";
import { Chess, normalizeMove } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";

const DATA = "src/components/coach/coachLessonsData.ts";
const OUT = "src/components/coach/coachLessonLines.ts";
const DEPTH = 20;
const EXAMPLE_PLIES = 6;
const TASK_PLIES = 4;

// Lektionen grob aus dem Quelltext lesen
function readLessons() {
  const src = fs.readFileSync(DATA, "utf8");
  const lessons = [];
  for (const block of src.split(/\n {4}\{\n {8}id: /).slice(1)) {
    const id = block.match(/^"(\w+)"/)[1];
    const ex = block.slice(block.indexOf("example:"), block.indexOf("tasks:"));
    const exFen = ex.match(/fen: "([^"]+)"/)[1];
    const arrow = ex.match(/\["([a-h][1-8])", "([a-h][1-8])"\]/);
    const tasks = [
      ...block
        .slice(block.indexOf("tasks:"))
        .matchAll(/fen: "([^"]+)",\s*solutions: \[([^\]]*)\]/g),
    ].map((m) => ({ fen: m[1], solutions: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]) }));
    lessons.push({ id, example: { fen: exFen, arrow: arrow ? arrow[1] + arrow[2] : null }, tasks });
  }
  return lessons;
}

function engine() {
  const p = spawn(process.env.STOCKFISH || "stockfish");
  let buf = "";
  let waiter = null;
  p.stdout.on("data", (d) => {
    buf += d;
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const l of lines) waiter?.(l);
  });
  const send = (s) => p.stdin.write(s + "\n");
  send("uci");
  send("setoption name Threads value 4");
  return {
    quit: () => p.kill(),
    pv(fen, searchmoves) {
      return new Promise((res) => {
        let pv = [];
        waiter = (l) => {
          const m = l.match(/ depth (\d+) .* pv (.+)$/);
          if (m && +m[1] === DEPTH) pv = m[2].trim().split(" ");
          if (l.startsWith("bestmove")) {
            waiter = null;
            res(pv);
          }
        };
        send("ucinewgame");
        send(`position fen ${fen}`);
        send(`go depth ${DEPTH}${searchmoves ? ` searchmoves ${searchmoves}` : ""}`);
      });
    },
  };
}

const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

// UCI-Züge in SAN, höchstens n, Schluss nach Matt
function toSans(fen, ucis, n) {
  const pos = position(fen);
  const out = [];
  for (const uci of ucis.slice(0, n)) {
    const move = parseUci(uci);
    if (!move) break;
    const m = normalizeMove(pos, move);
    if (!pos.isLegal(m)) break;
    out.push(makeSan(pos, m));
    pos.play(m);
    if (pos.isEnd()) break;
  }
  return out;
}

function sanToUci(fen, san) {
  const pos = position(fen);
  const m = parseSan(pos, san);
  if (!m || !("from" in m)) return null;
  const sq = (s) => "abcdefgh"[s % 8] + (Math.floor(s / 8) + 1);
  // Rochade schreibt Stockfish als König zwei Felder
  if (pos.board.get(m.from)?.role === "king" && Math.abs((m.from % 8) - (m.to % 8)) > 1) {
    const toFile = m.to % 8 > m.from % 8 ? "g" : "c";
    return sq(m.from) + toFile + sq(m.from)[1];
  }
  return (
    sq(m.from) +
    sq(m.to) +
    (m.promotion ? { queen: "q", rook: "r", bishop: "b", knight: "n" }[m.promotion] : "")
  );
}

function legalUci(fen, uci) {
  const pos = position(fen);
  const move = parseUci(uci);
  return !!move && pos.isLegal(normalizeMove(pos, move));
}

// Stellungsspiel und Rochade: keine Folge, da zeigt ein Abspiel wenig
const NO_LINE = new Set(["castle", "outpost", "openFile", "seventhRank", "blockade"]);
// Bauern- und Königsendspiele: die ruhigen Züge sind der Inhalt
const KEEP_QUIET = new Set(["opposition", "breakthrough", "square", "passedPawn", "umbrella"]);

// Taktik: hinten ruhige Züge abschneiden, die Folge endet mit dem Gewinn
function trim(sans, id) {
  if (KEEP_QUIET.has(id)) return sans;
  let end = 0;
  // Nur eigene Züge (gerade Indizes) zählen als Gewinn
  sans.forEach((san, i) => {
    if (i % 2 === 0 && /[x+#=]/.test(san)) end = i + 1;
  });
  return sans.slice(0, end);
}

const e = engine();
const examples = {};
const tasks = {};
for (const lesson of readLessons()) {
  if (NO_LINE.has(lesson.id)) continue;
  const first =
    lesson.example.arrow && legalUci(lesson.example.fen, lesson.example.arrow)
      ? lesson.example.arrow
      : "";
  const exPv = await e.pv(lesson.example.fen, first);
  const exLine = trim(toSans(lesson.example.fen, exPv, EXAMPLE_PLIES), lesson.id);
  if (exLine.length) examples[lesson.id] = exLine;
  tasks[lesson.id] = [];
  for (const task of lesson.tasks) {
    const uci = sanToUci(task.fen, task.solutions[0]);
    const pv = uci ? await e.pv(task.fen, uci) : [];
    // Ohne den ersten Zug (das ist die Lösung)
    // Ohne den ersten Zug (das ist die Lösung); getrimmt wird mit ihm
    const sans = trim(toSans(task.fen, pv, TASK_PLIES + 1), lesson.id).slice(1);
    tasks[lesson.id].push(sans);
  }
  console.error(
    lesson.id,
    exLine.join(" "),
    "|",
    tasks[lesson.id].map((x) => x.join(" ")).join(" | "),
  );
}
e.quit();

const fmt = (o) => JSON.stringify(o, null, 4).replace(/"(\w+)":/g, "$1:");
fs.writeFileSync(
  OUT,
  `// Erzeugt mit scripts/coach-lesson-lines.mjs (Stockfish), nicht von Hand ändern.
// Beispiel: Züge ab der Beispielstellung. Aufgaben: Züge nach der Lösung.

export const EXAMPLE_LINES: Record<string, string[]> = ${fmt(examples)};

export const TASK_LINES: Record<string, string[][]> = ${fmt(tasks)};
`,
);
