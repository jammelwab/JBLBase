import type { Config } from "@lichess-org/chessground/config";
import { Box } from "@mantine/core";
import { makeSquare, parseSquare, type NormalMove, type Role } from "chessops";
import { parseFen } from "chessops/fen";
import { useState } from "react";
import { Chessground } from "@/chessground/Chessground";
import PromotionModal from "../boards/PromotionModal";

// Brett für Coach-Aufgaben (1.2.29): fragt beim Umwandeln nach der Figur,
// statt still eine Dame zu nehmen. Sonst wie Chessground; der Zug kommt über
// onMove mit der gewählten Figur.

// Zieht hier ein Bauer auf die letzte Reihe?
export function isPromotion(fen: string, orig: string, dest: string): boolean {
  const setup = parseFen(fen);
  const from = parseSquare(orig);
  if (setup.isErr || from === undefined) return false;
  const piece = setup.value.board.get(from);
  return (
    piece?.role === "pawn" &&
    ((piece.color === "white" && dest[1] === "8") || (piece.color === "black" && dest[1] === "1"))
  );
}

// Buchstabe für die UCI-Schreibweise (e7e8n)
export const PROMOTION_LETTER: Record<Role, string> = {
  queen: "q",
  rook: "r",
  bishop: "b",
  knight: "n",
  king: "k",
  pawn: "",
};

type Props = Omit<Config, "movable" | "fen"> & {
  fen: string;
  movable: Omit<NonNullable<Config["movable"]>, "events">;
  onMove: (orig: string, dest: string, promotion?: Role) => void;
};

export default function CoachBoard({ fen, movable, onMove, ...rest }: Props) {
  const [pending, setPending] = useState<NormalMove | null>(null);
  // Nach „Abbrechen“ den Bauern zurückstellen
  const [reset, setReset] = useState(0);
  const turn = (rest.turnColor ?? (fen.split(" ")[1] === "b" ? "black" : "white")) as
    | "white"
    | "black";
  return (
    <Box pos="relative" w="100%" h="100%">
      <PromotionModal
        pendingMove={pending}
        cancelMove={() => {
          setPending(null);
          setReset((r) => r + 1);
        }}
        confirmMove={(role) => {
          if (!pending) return;
          const orig = makeSquare(pending.from);
          const dest = makeSquare(pending.to);
          setPending(null);
          onMove(orig, dest, role);
        }}
        turn={turn}
        orientation={rest.orientation ?? "white"}
      />
      <Chessground
        key={reset}
        {...rest}
        fen={fen}
        movable={{
          ...movable,
          events: {
            after: (orig, dest) => {
              if (isPromotion(fen, orig, dest))
                setPending({ from: parseSquare(orig)!, to: parseSquare(dest)! });
              else onMove(orig, dest);
            },
          },
        }}
      />
    </Box>
  );
}
