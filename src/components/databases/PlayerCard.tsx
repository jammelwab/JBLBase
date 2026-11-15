import {
  ActionIcon,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconUserCheck, IconX } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWRImmutable from "swr/immutable";
import { commands, type Player } from "@/bindings";
import { unwrap } from "@/utils/unwrap";
import { myPlayerAtom, playerDatabasesAtom } from "@/state/atoms";
import { sameName } from "@/utils/accountDatabase";
import { linkOf, removeLink } from "@/utils/playerDatabases";
import PersonalPlayerCard from "../home/PersonalCard";
import { LinkDatabaseModal } from "../home/PlayerDatabases";

/**
 * Whether this database player is one of the players on the accounts page ("This is me"),
 * so their games here count with that player's accounts.
 */
function PlayerLink({ file, name }: { file: string; name: string }) {
  const { t } = useTranslation();
  const [links, setLinks] = useAtom(playerDatabasesAtom);
  const myPlayer = useAtomValue(myPlayerAtom);
  const [open, setOpen] = useState(false);
  const link = linkOf(links, file, name);
  return (
    <Group gap="xs" justify="flex-end">
      {link ? (
        <>
          <IconUserCheck size="1rem" />
          <Text size="sm">
            {sameName(link.player, myPlayer)
              ? t("Databases.Player.LinkedToMe", { player: link.player })
              : t("Databases.Player.LinkedTo", { player: link.player })}
          </Text>
          <Tooltip label={t("Home.Accounts.UnlinkDatabase")}>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={() => setLinks((prev) => removeLink(prev, link))}
            >
              <IconX size="0.9rem" />
            </ActionIcon>
          </Tooltip>
        </>
      ) : (
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconUserCheck size="1rem" />}
          onClick={() => setOpen(true)}
        >
          {t("Databases.Player.Link")}
        </Button>
      )}
      <LinkDatabaseModal opened={open} onClose={() => setOpen(false)} file={file} name={name} />
    </Group>
  );
}

function PlayerCard({ player, file }: { player: Player; file: string }) {
  const { t } = useTranslation();
  const {
    data: info,
    isLoading,
    error,
  } = useSWRImmutable(["player-game-info", file, player.name], async ([_key, file, player]) => {
    if (!player) return null;
    const games = await commands.getPlayersGameInfo(file, player);
    return unwrap(games);
  });

  return (
    <Stack h="100%" gap="xs">
      {player.name && <PlayerLink file={file} name={player.name} />}
      <Box flex={1} mih={0}>
        {isLoading && (
          <Paper withBorder h="100%">
            <Center h="100%">
              <Stack align="center">
                <Text fw="bold">{t("Databases.Player.ProcessingData")}</Text>
                <Loader />
              </Stack>
            </Center>
          </Paper>
        )}
        {info && (
          <PersonalPlayerCard
            key={player.name}
            name={player.name!}
            info={info}
            isDatabase
            openingSources={[{ file, player: player.name! }]}
          />
        )}
        {error && !info && (
          <Paper withBorder h="100%">
            <Center h="100%">
              <Text c="dimmed">
                {t("Common.Error")}: {error instanceof Error ? error.message : String(error)}
              </Text>
            </Center>
          </Paper>
        )}
      </Box>
    </Stack>
  );
}

export default PlayerCard;
