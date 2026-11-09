import { ActionIcon, Box, Button, Group, Paper, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { Key } from "@lichess-org/chessground/types";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Chessground } from "@/chessground/Chessground";
import { playLine } from "@/utils/gamesTree";

// A small board in the corner of the tree that shows the move you clicked, with the line
// that leads there. White moves are light chips, black moves dark ones.
export default function BoardPreview({
  rootFen,
  rootHalfMoves,
  line,
  orientation,
  onOpen,
  onClose,
}: {
  rootFen: string;
  rootHalfMoves: number;
  line: string[];
  orientation: "white" | "black";
  onOpen?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { fen, lastMove } = useMemo(() => playLine(rootFen, line), [rootFen, line]);

  return (
    <Paper
      withBorder
      shadow="md"
      p="xs"
      pos="absolute"
      right={12}
      bottom={12}
      w={272}
      style={{ zIndex: 2 }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Text size="xs" fw={600}>
          {t("Repertoire.Preview.Title")}
        </Text>
        <ActionIcon size="sm" variant="subtle" color="gray" onClick={onClose}>
          <IconX size="0.9rem" />
        </ActionIcon>
      </Group>
      <Box w={252} h={252}>
        <Chessground
          coordinates={false}
          viewOnly
          fen={fen}
          orientation={orientation}
          lastMove={lastMove ? (lastMove as Key[]) : undefined}
        />
      </Box>
      <Box mt={6} mah={88} style={{ overflowY: "auto", lineHeight: 1.9 }}>
        {line.map((san, i) => {
          const half = rootHalfMoves + i + 1;
          const white = half % 2 === 1;
          const number = Math.ceil(half / 2);
          return (
            <span key={i} style={{ whiteSpace: "nowrap", marginRight: 4 }}>
              {(white || i === 0) && (
                <Text span size="xs" c="dimmed" mr={2}>
                  {white ? `${number}.` : `${number}…`}
                </Text>
              )}
              <Text
                span
                size="xs"
                fw={600}
                px={5}
                py={1}
                style={{
                  borderRadius: 4,
                  background: white ? "#f8f9fa" : "#1f2023",
                  color: white ? "#1a1b1e" : "#f1f3f5",
                  border: "1px solid var(--mantine-color-default-border)",
                }}
              >
                {san}
              </Text>
            </span>
          );
        })}
        {line.length === 0 && (
          <Text size="xs" c="dimmed">
            {t("Repertoire.Preview.Start")}
          </Text>
        )}
      </Box>
      {onOpen && (
        <Button size="xs" variant="light" fullWidth mt={6} onClick={onOpen}>
          {t("Repertoire.Preview.Open")}
        </Button>
      )}
    </Paper>
  );
}
