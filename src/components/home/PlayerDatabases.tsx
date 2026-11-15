import {
  ActionIcon,
  Autocomplete,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconDatabase, IconX } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { myPlayerAtom, playerDatabasesAtom, sessionsAtom } from "@/state/atoms";
import { sameName } from "@/utils/accountDatabase";
import { getDatabases, query_players } from "@/utils/db";
import {
  addLink,
  allPlayerNames,
  databaseName,
  type PlayerDatabase,
  removeLink,
} from "@/utils/playerDatabases";

/** The databases added to a player by hand, as small cards under their accounts. */
export function PlayerDatabaseCards({ links }: { links: PlayerDatabase[] }) {
  const { t } = useTranslation();
  const [, setLinks] = useAtom(playerDatabasesAtom);
  if (links.length === 0) return null;
  return (
    <Group gap="xs">
      {links.map((link) => (
        <Paper key={`${link.file}\n${link.name}`} withBorder px="sm" py={6} radius="md">
          <Group gap="xs" wrap="nowrap">
            <IconDatabase size="1rem" />
            <Tooltip label={link.file}>
              <Stack gap={0}>
                <Text size="sm" fw={600} lineClamp={1}>
                  {databaseName(link.file)}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {t("Home.Accounts.LinkedAs", { name: link.name })}
                </Text>
              </Stack>
            </Tooltip>
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
          </Group>
        </Paper>
      ))}
    </Group>
  );
}

/**
 * Adds a player of a database (e.g. "Schwab, Jannick" in imported tournament games) to a
 * player of the accounts page, so their games count together. Given a `file` and `name`
 * (from the player list of a database) only the player is asked; given a `player` (from the
 * accounts page) the database and the name in it.
 */
export function LinkDatabaseModal({
  opened,
  onClose,
  player: fixedPlayer,
  file: fixedFile,
  name: fixedName,
}: {
  opened: boolean;
  onClose: () => void;
  player?: string;
  file?: string;
  name?: string;
}) {
  const { t } = useTranslation();
  const sessions = useAtomValue(sessionsAtom);
  const [links, setLinks] = useAtom(playerDatabasesAtom);
  const [myPlayer, setMyPlayer] = useAtom(myPlayerAtom);
  const players = allPlayerNames(sessions, links);

  const [player, setPlayer] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [isMe, setIsMe] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setPlayer(fixedPlayer ?? (myPlayer || players[0] || ""));
    setFile(fixedFile ?? null);
    setName(fixedName ?? "");
    setIsMe(false);
  }, [opened]);

  const { data: databases = [] } = useSWR(opened && !fixedFile ? "databases" : null, () =>
    getDatabases(),
  );
  const choices = databases
    .filter((db) => db.type === "success")
    .map((db) => ({ value: db.file, label: db.type === "success" ? db.title : db.filename }));

  const [query] = useDebouncedValue(name, 200);
  const { data: found } = useSWR(
    opened && file && !fixedName ? ["link-players", file, query] : null,
    () =>
      query_players(file!, {
        name: query.trim() || null,
        options: { skipCount: true, pageSize: 20, sort: "name", direction: "asc" },
      }),
  );
  const suggestions = Array.from(
    new Set((found?.data ?? []).map((p) => p.name).filter((n): n is string => !!n)),
  );

  const target = player.trim();
  const canSave = !!target && !!file && name.trim() !== "";
  const isNewPlayer = !players.some((p) => sameName(p, target));
  const alreadyMe = !!myPlayer && sameName(myPlayer, target);

  function save() {
    if (!canSave || !file) return;
    setLinks((prev) => addLink(prev, { player: target, file, name }, players));
    if (isMe) setMyPlayer(players.find((p) => sameName(p, target)) ?? target);
    onClose();
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("Home.Accounts.LinkDatabase")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {t("Home.Accounts.LinkDatabase.Desc")}
          </Text>
          {fixedFile && fixedName ? (
            <Text size="sm">
              {t("Home.Accounts.LinkDatabase.Source", {
                name: fixedName,
                database: databaseName(fixedFile),
              })}
            </Text>
          ) : (
            <>
              <Select
                label={t("Home.Accounts.LinkDatabase.Database")}
                placeholder={t("Home.Accounts.LinkDatabase.DatabasePlaceholder")}
                data={choices}
                value={file}
                onChange={(v) => {
                  setFile(v);
                  setName("");
                }}
                searchable
                allowDeselect={false}
                required
              />
              <Autocomplete
                label={t("Home.Accounts.LinkDatabase.NameInDatabase")}
                description={t("Home.Accounts.LinkDatabase.NameInDatabase.Desc")}
                data={suggestions}
                value={name}
                onChange={setName}
                disabled={!file}
                required
              />
            </>
          )}
          {fixedPlayer ? null : (
            <Autocomplete
              label={t("Home.Accounts.PlayerName")}
              description={t("Home.Accounts.LinkDatabase.Player.Desc")}
              data={players}
              value={player}
              onChange={setPlayer}
              required
            />
          )}
          {!alreadyMe && (
            <Checkbox
              label={t("Home.Accounts.ThisIsMe")}
              description={t("Home.Accounts.ThisIsMe.Desc")}
              checked={isMe}
              onChange={(e) => setIsMe(e.currentTarget.checked)}
            />
          )}
          {isNewPlayer && target && (
            <Text size="xs" c="dimmed">
              {t("Home.Accounts.LinkDatabase.NewPlayer", { player: target })}
            </Text>
          )}
          <Group justify="flex-end">
            <Button type="submit" disabled={!canSave}>
              {t("Home.Accounts.LinkDatabase.Save")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
