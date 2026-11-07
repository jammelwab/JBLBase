import {
  Anchor,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconBookmarkPlus } from "@tabler/icons-react";
import { Link, useLoaderData } from "@tanstack/react-router";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { positionKey } from "@/utils/repertoireTree";
import { useRepertoires } from "@/utils/repertoires";
import { getNodeAtPath } from "@/utils/treeReducer";
import AddToRepertoireModal from "./AddToRepertoireModal";
import { RepertoireLabel } from "./RepertoireLabel";

// Board tab: is this position in my repertoires, and what do I play here?
export default function RepertoirePanel() {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/" });
  const store = useContext(TreeStateContext)!;
  const node = useStore(store, (s) => getNodeAtPath(s.root, s.position));
  const makeMove = useStore(store, (s) => s.makeMove);
  const { data: repertoires, isLoading } = useRepertoires(documentDir);
  const [adding, setAdding] = useState(false);

  const key = positionKey(node.fen);
  const sideToMove = node.halfMoves % 2 === 0 ? "white" : "black";

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

        {(repertoires ?? []).map((r) => {
          const moves = r.index.get(key);
          const myTurn = r.color === sideToMove;
          return (
            <Paper key={r.file.path} withBorder p="sm" opacity={moves ? 1 : 0.6}>
              <Stack gap={6}>
                <RepertoireLabel repertoire={r} />
                {!moves ? (
                  <Text size="sm" c="dimmed">
                    {t("Repertoire.Panel.NotIn")}
                  </Text>
                ) : moves.length === 0 ? (
                  <Text size="sm" c="yellow">
                    {t(myTurn ? "Repertoire.Panel.NoMoveYet" : "Repertoire.Panel.LineEnds")}
                  </Text>
                ) : (
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">
                      {t(myTurn ? "Repertoire.Panel.YouPlay" : "Repertoire.Panel.OpponentMoves")}
                    </Text>
                    {moves.map((san) => (
                      <UnstyledButton
                        key={san}
                        onClick={() => makeMove({ payload: san })}
                        px={8}
                        py={2}
                        style={{
                          borderRadius: 4,
                          fontWeight: 600,
                          fontSize: "0.875rem",
                          background: myTurn
                            ? "var(--mantine-color-green-light)"
                            : "var(--mantine-color-blue-light)",
                        }}
                      >
                        {san}
                      </UnstyledButton>
                    ))}
                  </Group>
                )}
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    </ScrollArea>
  );
}
