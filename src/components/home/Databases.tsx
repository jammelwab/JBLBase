import {
  Center,
  Loader,
  Paper,
  Progress,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconDatabaseOff } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWRImmutable from "swr/immutable";
import type { DatabaseInfo as PlainDatabaseInfo, PlayerGameInfo } from "@/bindings";
import { commands, events } from "@/bindings";
import { playerDatabasesAtom, sessionsAtom } from "@/state/atoms";
import { activeDatabaseViewStore } from "@/state/store/database";
import { accountDatabaseFilename, sameName } from "@/utils/accountDatabase";
import { getDatabases, query_players } from "@/utils/db";
import { allPlayerNames, linksOfPlayer } from "@/utils/playerDatabases";
import { type Session, sessionsOfPlayer } from "@/utils/session";
import { unwrap } from "@/utils/unwrap";
import { DatabaseViewStateContext } from "../databases/DatabaseViewStateContext";
import PersonalPlayerCard from "./PersonalCard";

type DatabaseInfo = PlainDatabaseInfo & {
  username?: string;
};

function getSessionUsername(session: Session): string {
  const username = session.lichess?.account.username || session.chessCom?.username;
  if (username === undefined) {
    throw new Error("Session does not have a username");
  }
  return username;
}

function isDatabaseFromSession(db: DatabaseInfo, sessions: Session[]) {
  const session = sessions.find((session) =>
    sameName(
      db.filename,
      accountDatabaseFilename(
        getSessionUsername(session),
        session.lichess ? "lichess" : "chesscom",
      ),
    ),
  );

  if (session !== undefined) {
    db.username = getSessionUsername(session);
  }
  return session !== undefined;
}

interface PersonalInfo {
  file: string;
  player: string;
  info: PlayerGameInfo;
}

function Databases() {
  const { t } = useTranslation();
  const sessions = useAtomValue(sessionsAtom);

  const links = useAtomValue(playerDatabasesAtom);
  const players = allPlayerNames(sessions, links);
  const playerDbNames = players.map((name) => ({
    name,
    databases: sessionsOfPlayer(sessions, name).map((s) =>
      s.chessCom
        ? accountDatabaseFilename(s.chessCom.username, "chesscom")
        : accountDatabaseFilename(
            s.lichess?.account.username ?? s.lichess?.username ?? "",
            "lichess",
          ),
    ),
    links: linksOfPlayer(links, name),
  }));

  const [name, setName] = useState("");
  useEffect(() => {
    // Keep the selected player unless it disappeared (e.g. merged into another).
    setName((current) => (players.length > 0 && !players.includes(current) ? players[0] : current));
  }, [sessions, links]);

  const { data: databases } = useSWRImmutable<DatabaseInfo[]>(
    players.length === 0 ? null : ["personalDatabases", sessions],
    async () => {
      const dbs = (await getDatabases()).filter((db) => db.type === "success");
      return dbs.filter((db) => isDatabaseFromSession(db, sessions));
    },
  );

  // The player's accounts and the databases added to them, read together
  const {
    data: personalInfo,
    isLoading,
    error,
  } = useSWRImmutable<PersonalInfo[]>(
    databases && name ? ["personalInfo", name, databases, links] : null,
    async () => {
      const player = playerDbNames.find((p) => p.name === name);
      if (!databases || !player) return [];
      const sources = [
        ...databases
          .filter(
            (db) =>
              db.type === "success" &&
              player.databases.some((filename) => sameName(filename, db.filename)),
          )
          .map((db) => ({ file: db.file, player: db.username! })),
        ...player.links.map((l) => ({ file: l.file, player: l.name })),
      ];
      const results = await Promise.allSettled(
        sources.map(async (source) => {
          const info = unwrap(await commands.getPlayersGameInfo(source.file, source.player));
          return { ...source, info };
        }),
      );
      return results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<PersonalInfo>).value);
    },
  );

  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const unlisten = events.databaseProgress.listen((e) => {
      setProgress(e.payload.progress);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <>
      {isLoading && databases && (
        <Paper
          h="100%"
          shadow="sm"
          p="md"
          withBorder
          style={{
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Center h="100%">
            <Stack w="100%" maw={400} align="center" gap="md">
              <ThemeIcon size={80} radius="100%" variant="light" color="blue">
                <Loader color="blue" type="bars" />
              </ThemeIcon>
              <Title order={3}>{t("Home.Databases.ProcessingGames")}</Title>
              <Progress w="100%" value={progress} animated striped size="md" radius="xl" />
              <Text fw="bold" fz="sm" c="dimmed">
                {Math.round(progress)}%
              </Text>
            </Stack>
          </Center>
        </Paper>
      )}
      {error && <Text ta="center">{t("Home.Databases.ErrorLoading", { error })}</Text>}
      {personalInfo &&
        (personalInfo.length === 0 ? (
          <Paper
            h="100%"
            shadow="sm"
            p="md"
            withBorder
            style={{
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Center h="100%">
              <Stack align="center" gap="md">
                <ThemeIcon size={80} radius="100%" variant="light" color="blue">
                  <IconDatabaseOff size={40} />
                </ThemeIcon>
                <Title order={3}>{t("Home.Databases.Empty.Title")}</Title>
                <Text c="dimmed" ta="center" maw={400}>
                  {t("Home.Databases.Empty.Description")}
                </Text>

                <Select
                  value={name}
                  data={players}
                  onChange={(e) => setName(e || "")}
                  clearable={false}
                  allowDeselect={false}
                  fw="bold"
                  styles={{
                    input: {
                      textAlign: "center",
                      fontSize: "1.25rem",
                    },
                  }}
                  mt="md"
                />
              </Stack>
            </Center>
          </Paper>
        ) : (
          <DatabaseViewStateContext.Provider value={activeDatabaseViewStore}>
            <PersonalPlayerCard
              name={name}
              setName={setName}
              info={{
                site_stats_data: personalInfo.flatMap((i) => i.info.site_stats_data),
              }}
              openingSources={personalInfo.map((i) => ({
                file: i.file,
                player: i.player || name,
              }))}
            />
          </DatabaseViewStateContext.Provider>
        ))}
    </>
  );
}

export default Databases;
