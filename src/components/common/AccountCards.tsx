import {
  ActionIcon,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { IconCheck, IconEdit, IconX } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DatabaseInfo } from "@/bindings";
import { sessionsAtom } from "@/state/atoms";
import { getChessComAccount, getStats } from "@/utils/chess.com/api";
import { getLichessAccount } from "@/utils/lichess/api";
import {
  detachSession,
  moveSessionToPlayer,
  playerNames,
  type Session,
  sessionKey,
  sessionPlayerName,
  sessionsOfPlayer,
} from "@/utils/session";
import { findAccountDatabase } from "@/utils/accountDatabase";
import { AccountCard } from "../home/AccountCard";
import { EmptyAccounts } from "../home/EmptyAccounts";

function AccountCards({
  databases,
  setDatabases,
  onAddAccount,
}: {
  databases: DatabaseInfo[];
  setDatabases: React.Dispatch<React.SetStateAction<DatabaseInfo[]>>;
  onAddAccount: () => void;
}) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useAtom(sessionsAtom);
  const [dragging, setDragging] = useState<string | null>(null);

  const playerSessions = playerNames(sessions).map((name) => ({
    name,
    sessions: sessionsOfPlayer(sessions, name),
  }));

  if (sessions.length === 0) {
    return <EmptyAccounts onAddAccount={onAddAccount} />;
  }

  const draggedSession = dragging ? sessions.find((s) => sessionKey(s) === dragging) : undefined;
  // Dropping on the empty area only makes sense for an account that shares
  // its player with other accounts.
  const canDetach =
    !!draggedSession && sessionsOfPlayer(sessions, sessionPlayerName(draggedSession)).length > 1;

  return (
    <ScrollArea offsetScrollbars>
      <DragDropContext
        onDragStart={(start) => setDragging(start.draggableId)}
        onDragEnd={({ draggableId, destination }) => {
          setDragging(null);
          const target = destination?.droppableId;
          if (!target) return;
          if (target === NEW_PLAYER) {
            setSessions((prev) => detachSession(prev, draggableId));
          } else if (target.startsWith(PLAYER_PREFIX)) {
            const player = target.slice(PLAYER_PREFIX.length);
            setSessions((prev) => moveSessionToPlayer(prev, draggableId, player));
          }
        }}
      >
        <Stack>
          {playerSessions.map(({ name, sessions }) => (
            <PlayerSession
              key={name}
              name={name}
              sessions={sessions}
              databases={databases}
              setDatabases={setDatabases}
              dragging={dragging}
            />
          ))}
          <Droppable droppableId={NEW_PLAYER} isDropDisabled={!canDetach}>
            {(provided, snapshot) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {canDetach && (
                  <Paper
                    withBorder
                    p="md"
                    style={{
                      borderStyle: "dashed",
                      borderColor: snapshot.isDraggingOver
                        ? "var(--mantine-primary-color-filled)"
                        : undefined,
                    }}
                  >
                    <Text c="dimmed" ta="center" size="sm">
                      {t("Home.Accounts.DropToSeparate")}
                    </Text>
                  </Paper>
                )}
                <div style={{ display: "none" }}>{provided.placeholder}</div>
              </div>
            )}
          </Droppable>
          {sessions.length > 1 && !dragging && (
            <Text c="dimmed" size="xs">
              {t("Home.Accounts.DragToMerge")}
            </Text>
          )}
        </Stack>
      </DragDropContext>
    </ScrollArea>
  );
}

const PLAYER_PREFIX = "player:";
const NEW_PLAYER = "new-player";

function PlayerSession({
  name,
  sessions,
  databases,
  setDatabases,
  dragging,
}: {
  name: string;
  sessions: Session[];
  databases: DatabaseInfo[];
  setDatabases: React.Dispatch<React.SetStateAction<DatabaseInfo[]>>;
  dragging: string | null;
}) {
  const [, setSessions] = useAtom(sessionsAtom);
  const ownsDragged = !!dragging && sessions.some((s) => sessionKey(s) === dragging);
  const isTarget = !!dragging && !ownsDragged;
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(name);
  useEffect(() => {
    setText(name);
  }, [name]);
  const ref = useRef(null);

  return (
    <Stack mt="sm">
      <Group justify="space-between" align="center">
        {edit ? (
          <TextInput
            ref={ref}
            variant="unstyled"
            fw="bold"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            styles={{
              input: {
                fontSize: "1.1rem",
                textDecoration: "underline",
              },
            }}
            autoFocus
          />
        ) : (
          <Text fz="lg" fw="bold">
            {name}
          </Text>
        )}
        <Group>
          {edit ? (
            <ActionIcon
              size="sm"
              variant="subtle"
              color="green"
              onClick={() => {
                setEdit(false);
                const keys = sessions.map(sessionKey);
                setSessions((prev) =>
                  prev.map((s) => (keys.includes(sessionKey(s)) ? { ...s, player: text } : s)),
                );
              }}
            >
              <IconCheck />
            </ActionIcon>
          ) : (
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={() => {
                setEdit(true);
              }}
            >
              <IconEdit />
            </ActionIcon>
          )}
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            onClick={() =>
              setSessions((sessions) => sessions.filter((s) => sessionPlayerName(s) !== name))
            }
          >
            <IconX />
          </ActionIcon>
        </Group>
      </Group>
      <Divider />
      <Droppable
        droppableId={`${PLAYER_PREFIX}${name}`}
        direction="horizontal"
        isDropDisabled={!isTarget}
      >
        {(provided, snapshot) => (
          <Group
            ref={provided.innerRef}
            {...provided.droppableProps}
            align="flex-start"
            p={isTarget ? "xs" : undefined}
            style={{
              borderRadius: "var(--mantine-radius-md)",
              outline: isTarget
                ? `2px dashed ${
                    snapshot.isDraggingOver
                      ? "var(--mantine-primary-color-filled)"
                      : "var(--mantine-color-default-border)"
                  }`
                : undefined,
              background: snapshot.isDraggingOver
                ? "var(--mantine-primary-color-light)"
                : undefined,
              minHeight: isTarget ? 80 : undefined,
            }}
          >
            {sessions.map((session, i) => (
              <Draggable key={sessionKey(session)} draggableId={sessionKey(session)} index={i}>
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                  >
                    <LichessOrChessCom
                      session={session}
                      databases={databases}
                      setDatabases={setDatabases}
                      setSessions={setSessions}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            <div style={{ display: "none" }}>{provided.placeholder}</div>
          </Group>
        )}
      </Droppable>
    </Stack>
  );
}

function LichessOrChessCom({
  session,
  databases,
  setDatabases,
  setSessions,
}: {
  session: Session;
  databases: DatabaseInfo[];
  setDatabases: React.Dispatch<React.SetStateAction<DatabaseInfo[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
}) {
  if (session.lichess?.account) {
    const account = session.lichess.account;
    const lichessSession = session.lichess;
    const totalGames =
      (account.perfs?.ultraBullet?.games ?? 0) +
      (account.perfs?.bullet?.games ?? 0) +
      (account.perfs?.blitz?.games ?? 0) +
      (account.perfs?.rapid?.games ?? 0) +
      (account.perfs?.classical?.games ?? 0) +
      (account.perfs?.correspondence?.games ?? 0);

    const stats = [];
    const speeds = ["bullet", "blitz", "rapid", "classical"] as const;

    if (account.perfs) {
      for (const speed of speeds) {
        const perf = account.perfs[speed];
        if (perf) {
          stats.push({
            value: perf.rating,
            label: speed,
            diff: perf.prog,
          });
        }
      }
    }

    return (
      <AccountCard
        key={account.id}
        token={lichessSession.accessToken}
        type="lichess"
        database={findAccountDatabase(databases, account.username, "lichess")}
        title={account.username}
        updatedAt={session.updatedAt}
        total={totalGames}
        logout={() => {
          setSessions((sessions) => sessions.filter((s) => s.lichess?.account.id !== account.id));
        }}
        setDatabases={setDatabases}
        reload={async () => {
          const account = await getLichessAccount({
            token: lichessSession.accessToken,
            username: lichessSession.username,
          });
          if (!account) return;
          setSessions((sessions) =>
            sessions.map((s) =>
              s.lichess?.account.id === account.id
                ? {
                    ...s,
                    lichess: {
                      account: account,
                      username: lichessSession.username,
                      accessToken: lichessSession.accessToken,
                    },
                    updatedAt: Date.now(),
                  }
                : s,
            ),
          );
        }}
        stats={stats}
      />
    );
  }
  if (session.chessCom?.stats) {
    let totalGames = 0;
    for (const stat of Object.values(session.chessCom.stats)) {
      if (stat.record) {
        totalGames += stat.record.win + stat.record.loss + stat.record.draw;
      }
    }
    return (
      <AccountCard
        key={session.chessCom.username}
        type="chesscom"
        title={session.chessCom.username}
        database={findAccountDatabase(databases, session.chessCom.username, "chesscom")}
        updatedAt={session.updatedAt}
        total={totalGames}
        stats={getStats(session.chessCom.stats)}
        logout={() => {
          setSessions((sessions) =>
            sessions.filter((s) => s.chessCom?.username !== session.chessCom?.username),
          );
        }}
        reload={async () => {
          if (!session.chessCom) return;
          const stats = await getChessComAccount(session.chessCom?.username);
          if (!stats) return;
          setSessions((sessions) =>
            sessions.map((s) =>
              session.chessCom && s.chessCom?.username === session.chessCom?.username
                ? {
                    ...s,
                    chessCom: {
                      username: session.chessCom?.username,
                      stats,
                    },
                    updatedAt: Date.now(),
                  }
                : s,
            ),
          );
        }}
        setDatabases={setDatabases}
      />
    );
  }
}

export default AccountCards;
