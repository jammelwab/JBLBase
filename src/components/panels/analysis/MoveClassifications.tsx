import { Box, Group, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  CLASSIFICATION_INFO,
  CLASSIFICATION_ORDER,
  countClassifications,
  type MoveClassification,
} from "@/utils/moveClassification";
import { getNodeAtPath, treeIteratorMainLine } from "@/utils/treeReducer";

export function ClassificationBadge({
  classification,
  size = 18,
}: {
  classification: MoveClassification;
  size?: number;
}) {
  const { color, symbol } = CLASSIFICATION_INFO[classification];
  return (
    <Box
      component="span"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        color: "white",
        fontWeight: 700,
        fontSize: size * (symbol.length > 1 ? 0.5 : 0.62),
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {symbol}
    </Box>
  );
}

// Chess.com-style summary: how many moves of each rating, per side. Clicking a count jumps
// to the next such move.
export function ClassificationTable() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);
  const goToMove = useStore(store, (s) => s.goToMove);

  const mainLine = useMemo(() => Array.from(treeIteratorMainLine(root)).slice(1), [root]);
  const counts = useMemo(() => countClassifications(mainLine.map((item) => item.node)), [mainLine]);

  function jumpTo(classification: MoveClassification, color: "white" | "black") {
    const parity = color === "white" ? 1 : 0;
    const matches = mainLine.filter(
      (item) => item.node.classification === classification && item.node.halfMoves % 2 === parity,
    );
    if (matches.length === 0) return;
    const next = matches.find((item) => item.position.length > position.length) ?? matches[0];
    goToMove(next.position);
  }

  return (
    <Paper withBorder p="md">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600} w={40} ta="center">
            {t("Common.WHITE")}
          </Text>
          <Box flex={1} />
          <Text fw={600} w={40} ta="center">
            {t("Common.BLACK")}
          </Text>
        </Group>
        {CLASSIFICATION_ORDER.map((c) => {
          const w = counts.white[c];
          const b = counts.black[c];
          const { color, translationKey } = CLASSIFICATION_INFO[c];
          return (
            <Group key={c} justify="space-between" wrap="nowrap" gap="xs">
              <UnstyledButton
                w={40}
                ta="center"
                disabled={w === 0}
                onClick={() => jumpTo(c, "white")}
                style={{ color: w > 0 ? color : undefined, fontWeight: 600 }}
              >
                {w}
              </UnstyledButton>
              <Group flex={1} gap="xs" justify="center" wrap="nowrap">
                <ClassificationBadge classification={c} />
                <Text size="sm" w={130} c={w + b > 0 ? undefined : "dimmed"}>
                  {t(`Classification.${translationKey}`)}
                </Text>
              </Group>
              <UnstyledButton
                w={40}
                ta="center"
                disabled={b === 0}
                onClick={() => jumpTo(c, "black")}
                style={{ color: b > 0 ? color : undefined, fontWeight: 600 }}
              >
                {b}
              </UnstyledButton>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

// One line about the move on the board: "Sf3 ist ein Fehler. Besser war e4."
export function CurrentMoveRating() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const node = useStore(store, (s) => getNodeAtPath(s.root, s.position));

  if (!node.classification || !node.san) return null;
  const { color, translationKey } = CLASSIFICATION_INFO[node.classification];
  const moveNumber = Math.ceil(node.halfMoves / 2);
  const moveText = `${moveNumber}${node.halfMoves % 2 === 1 ? "." : "..."} ${node.san}`;

  return (
    <Paper withBorder p="xs">
      <Group gap="xs" wrap="nowrap">
        <ClassificationBadge classification={node.classification} size={24} />
        <Stack gap={0}>
          <Text size="sm">
            <b>{moveText}</b>{" "}
            <Text span c={color} fw={600}>
              {t(`Classification.${translationKey}`)}
            </Text>
          </Text>
          {node.bestMove && node.classification !== "best" && node.classification !== "book" && (
            <Text size="xs" c="dimmed">
              {t("Classification.BestWas", { move: node.bestMove })}
            </Text>
          )}
        </Stack>
      </Group>
    </Paper>
  );
}

export function hasClassifications(root: Parameters<typeof treeIteratorMainLine>[0]) {
  for (const item of treeIteratorMainLine(root)) {
    if (item.node.classification) return true;
  }
  return false;
}
