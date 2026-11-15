import {
  Anchor,
  Button,
  Collapse,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconBookmarkPlus, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { Link, useLoaderData } from "@tanstack/react-router";
import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { findMainRepertoire, folderLabel } from "@/utils/repertoireFolders";
import { positionKey } from "@/utils/repertoireTree";
import {
  DEFAULT_MAIN_OWNER,
  type Repertoire,
  type RepertoireColor,
  useMainOwner,
  useRepertoires,
} from "@/utils/repertoires";
import { getNodeAtPath } from "@/utils/treeReducer";
import AddToRepertoireModal from "./AddToRepertoireModal";
import { ColorDot } from "./RepertoireLabel";

function MoveChips({
  moves,
  mine,
  onPlay,
}: {
  moves: string[];
  mine: boolean;
  onPlay: (san: string) => void;
}) {
  return (
    <Group gap={4} wrap="wrap">
      {moves.map((san) => (
        <UnstyledButton
          key={san}
          onClick={() => onPlay(san)}
          px={8}
          py={2}
          style={{
            borderRadius: 4,
            fontWeight: 600,
            fontSize: "0.875rem",
            background: mine
              ? "var(--mantine-color-green-light)"
              : "var(--mantine-color-blue-light)",
          }}
        >
          {san}
        </UnstyledButton>
      ))}
    </Group>
  );
}

// One repertoire in one line: its name and the moves it has here
function RepertoireRow({
  repertoire,
  moves,
  sideToMove,
  onPlay,
  main,
}: {
  repertoire: Repertoire;
  moves: string[] | undefined;
  sideToMove: RepertoireColor;
  onPlay: (san: string) => void;
  main?: boolean;
}) {
  const { t } = useTranslation();
  const mine = repertoire.color === sideToMove;
  const path = [folderLabel(repertoire.folder), repertoire.name].filter(Boolean);
  return (
    <Group gap="xs" wrap="nowrap" align="center" mih={28}>
      <ColorDot color={repertoire.color} />
      <Tooltip label={path.join(" › ")} openDelay={400} disabled={!repertoire.folder}>
        <Text
          size="sm"
          fw={main ? 600 : 500}
          truncate="end"
          w={main ? undefined : 160}
          style={{ flexShrink: 0, maxWidth: main ? undefined : 160 }}
        >
          {repertoire.name}
        </Text>
      </Tooltip>
      {!moves ? (
        <Text size="sm" c="dimmed">
          {t("Repertoire.Panel.NotIn")}
        </Text>
      ) : moves.length === 0 ? (
        <Text size="sm" c="yellow">
          {t(mine ? "Repertoire.Panel.NoMoveYet" : "Repertoire.Panel.LineEnds")}
        </Text>
      ) : (
        <MoveChips moves={moves} mine={mine} onPlay={onPlay} />
      )}
    </Group>
  );
}

// Board tab: is this position in my repertoire, and what do I play here? Shows your main
// repertoire of the board's color; the other repertoires only where they have the position,
// folded away.
export default function RepertoirePanel() {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/" });
  const store = useContext(TreeStateContext)!;
  const node = useStore(store, (s) => getNodeAtPath(s.root, s.position));
  const orientation = useStore(store, (s) => s.headers.orientation) ?? "white";
  const makeMove = useStore(store, (s) => s.makeMove);
  const { data: repertoires, isLoading } = useRepertoires(documentDir);
  const mainOwner = useMainOwner();
  const [adding, setAdding] = useState(false);
  const [showOthers, setShowOthers] = useState(false);

  const key = positionKey(node.fen);
  const sideToMove: RepertoireColor = node.halfMoves % 2 === 0 ? "white" : "black";
  const play = (san: string) => makeMove({ payload: san });

  const { mains, others } = useMemo(() => {
    const list = repertoires ?? [];
    const main = (color: RepertoireColor) =>
      findMainRepertoire(list, mainOwner, color, [DEFAULT_MAIN_OWNER]);
    const boardColor: RepertoireColor = orientation === "black" ? "black" : "white";
    const otherColor: RepertoireColor = boardColor === "white" ? "black" : "white";
    // The board's color always, the other color only where it has the position
    const mains = [main(boardColor), main(otherColor)].filter(
      (r, i): r is Repertoire => !!r && (i === 0 || r.index.has(key)),
    );
    // Sorted: the board's color first, then by folder and name ("02_…" after "01_…")
    const byName = (r: Repertoire) => [r.folder, r.name].filter(Boolean).join("/");
    const others = list
      .filter((r) => !mains.includes(r) && r.index.has(key))
      .sort(
        (a, b) =>
          Number(a.color !== boardColor) - Number(b.color !== boardColor) ||
          byName(a).localeCompare(byName(b), undefined, { numeric: true }),
      );
    return { mains, others };
  }, [repertoires, mainOwner, orientation, key]);

  return (
    <ScrollArea h="100%" offsetScrollbars>
      <AddToRepertoireModal opened={adding} onClose={() => setAdding(false)} />
      <Stack p="xs" gap="sm">
        <Group justify="space-between">
          <Button leftSection={<IconBookmarkPlus size="1rem" />} onClick={() => setAdding(true)}>
            {t("Repertoire.Add.Title")}
          </Button>
          <Anchor component={Link} to="/repertoires" size="sm">
            {t("Repertoire.Page.All")}
          </Anchor>
        </Group>

        {!isLoading && (repertoires ?? []).length === 0 && (
          <Text c="dimmed" size="sm">
            {t("Repertoire.Add.NoRepertoires")}
          </Text>
        )}

        {mains.length > 0 && (
          <Paper withBorder p="sm">
            <Stack gap={6}>
              {mains.map((r) => (
                <RepertoireRow
                  key={r.file.path}
                  repertoire={r}
                  moves={r.index.get(key)}
                  sideToMove={sideToMove}
                  onPlay={play}
                  main
                />
              ))}
            </Stack>
          </Paper>
        )}

        {others.length > 0 && (
          <Stack gap={4}>
            <UnstyledButton onClick={() => setShowOthers((o) => !o)}>
              <Group gap={4}>
                {showOthers ? <IconChevronDown size="1rem" /> : <IconChevronRight size="1rem" />}
                <Text size="sm" c="dimmed">
                  {t("Repertoire.Panel.Others", { count: others.length })}
                </Text>
              </Group>
            </UnstyledButton>
            <Collapse expanded={showOthers}>
              <Stack gap={4} pl="md">
                {others.map((r) => (
                  <RepertoireRow
                    key={r.file.path}
                    repertoire={r}
                    moves={r.index.get(key)}
                    sideToMove={sideToMove}
                    onPlay={play}
                  />
                ))}
              </Stack>
            </Collapse>
          </Stack>
        )}
      </Stack>
    </ScrollArea>
  );
}
