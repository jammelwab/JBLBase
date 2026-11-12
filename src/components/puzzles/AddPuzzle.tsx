import {
  importLichessPuzzles,
  LICHESS_PUZZLE_FILE,
  LICHESS_PUZZLE_PROGRESS,
} from "@/utils/lichessPuzzles";
import {
  Alert,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { resolve } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { type Dispatch, type SetStateAction, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWRImmutable from "swr/immutable";
import { commands, type PuzzleDatabaseInfo } from "@/bindings";
import { getDefaultPuzzleDatabases } from "@/utils/db";
import { getPuzzlesDir } from "@/utils/directories";
import { formatBytes, formatNumber } from "@/utils/format";
import { getPuzzleDatabases } from "@/utils/puzzles";
import ProgressButton from "../common/ProgressButton";

function AddPuzzle({
  puzzleDbs,
  opened,
  setOpened,
  setPuzzleDbs,
}: {
  puzzleDbs: PuzzleDatabaseInfo[];
  opened: boolean;
  setOpened: (opened: boolean) => void;
  setPuzzleDbs: Dispatch<SetStateAction<PuzzleDatabaseInfo[]>>;
}) {
  const { t } = useTranslation();
  const { data: dbs, error } = useSWRImmutable(
    "default_puzzle_databases",
    getDefaultPuzzleDatabases,
  );

  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title={t("Databases.Add.Title")}>
      <ScrollArea.Autosize mah={500} offsetScrollbars>
        <Stack>
          <LichessPuzzleCard
            setPuzzleDbs={setPuzzleDbs}
            initInstalled={puzzleDbs.some((e) => e.title === LICHESS_PUZZLE_FILE)}
          />
          {dbs?.map((db, i) => (
            <PuzzleDbCard
              puzzleDb={db}
              databaseId={i}
              key={i}
              setPuzzleDbs={setPuzzleDbs}
              initInstalled={puzzleDbs.some(
                (e) => e.title.replace(/\.(duckdb|db3)$/i, "") === db.title,
              )}
            />
          ))}
          {error && (
            <Alert icon={<IconAlertCircle size="1rem" />} title={t("Common.Error")} color="red">
              {t("Databases.Add.ErrorFetch")}
            </Alert>
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Modal>
  );
}

/**
 * The official Lichess puzzle database, built locally from
 * `lichess_db_puzzle.csv.zst`: downloaded here, or picked from disk.
 */
function LichessPuzzleCard({
  setPuzzleDbs,
  initInstalled,
}: {
  setPuzzleDbs: Dispatch<SetStateAction<PuzzleDatabaseInfo[]>>;
  initInstalled: boolean;
}) {
  const { t } = useTranslation();
  const [inProgress, setInProgress] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function importPuzzles(source: string | null) {
    setError(null);
    setInProgress(true);
    try {
      const result = await importLichessPuzzles(source);
      if (result.status === "error") setError(result.error);
      setPuzzleDbs(await getPuzzleDatabases());
    } catch (e) {
      setError(String(e));
    } finally {
      setInProgress(false);
    }
  }

  async function importFromFile() {
    const file = await open({
      multiple: false,
      filters: [{ name: "Lichess Puzzles", extensions: ["zst", "csv"] }],
    });
    if (typeof file === "string") await importPuzzles(file);
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Text tt="uppercase" c="dimmed" fw={700} size="xs">
        {t("Puzzle.Database")}
      </Text>
      <Text fw="bold" mb="xs">
        {t("Puzzle.Lichess.Title")}
      </Text>
      <Text size="xs" c="dimmed" mb="md">
        {t("Puzzle.Lichess.Desc")}
      </Text>
      <Stack gap="xs">
        <ProgressButton
          id={LICHESS_PUZZLE_PROGRESS}
          initInstalled={initInstalled && !inProgress}
          redoable
          labels={{
            completed: t("Puzzle.Lichess.Update"),
            action: t("Puzzle.Lichess.Download"),
            inProgress: t("Puzzle.Lichess.Importing"),
            finalizing: t("Puzzle.Lichess.Finalizing"),
          }}
          onClick={() => importPuzzles(null)}
          inProgress={inProgress}
          setInProgress={setInProgress}
        />
        <Button variant="default" onClick={importFromFile} disabled={inProgress}>
          {t("Puzzle.Lichess.FromFile")}
        </Button>
        {error && (
          <Alert icon={<IconAlertCircle size="1rem" />} title={t("Common.Error")} color="red">
            {error}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}

function PuzzleDbCard({
  setPuzzleDbs,
  puzzleDb,
  databaseId,
  initInstalled,
}: {
  setPuzzleDbs: Dispatch<SetStateAction<PuzzleDatabaseInfo[]>>;
  puzzleDb: PuzzleDatabaseInfo & { downloadLink: string };
  databaseId: number;
  initInstalled: boolean;
}) {
  const { t } = useTranslation();
  const [inProgress, setInProgress] = useState<boolean>(false);

  async function downloadDatabase(id: number, url: string, name: string) {
    setInProgress(true);
    const puzzlesDir = await getPuzzlesDir();
    const path = await resolve(puzzlesDir, `${name}.duckdb`);
    await commands.downloadFile(`puzzle_db_${id}`, url, path, null, null, null);
    setPuzzleDbs(await getPuzzleDatabases());
  }

  return (
    <Paper withBorder radius="md" p={0} key={puzzleDb.title}>
      <Group wrap="nowrap" gap={0} grow>
        <Box p="md" flex={1}>
          <Text tt="uppercase" c="dimmed" fw={700} size="xs">
            {t("Puzzle.Database")}
          </Text>
          <Text fw="bold" mb="xs">
            {puzzleDb.title}
          </Text>

          <Text size="xs" c="dimmed">
            {puzzleDb.description}
          </Text>
          <Divider />
          <Group wrap="nowrap" grow my="md">
            <Stack gap={0} align="center">
              <Text tt="uppercase" c="dimmed" fw={700} size="xs">
                {t("Common.Size")}
              </Text>
              <Text size="xs">{formatBytes(puzzleDb.storageSize)}</Text>
            </Stack>
            <Stack gap={0} align="center">
              <Text tt="uppercase" c="dimmed" fw={700} size="xs">
                {t("Puzzle.Puzzles")}
              </Text>
              <Text size="xs">{formatNumber(puzzleDb.puzzleCount)}</Text>
            </Stack>
          </Group>
          <ProgressButton
            id={`puzzle_db_${databaseId}`}
            initInstalled={initInstalled}
            labels={{
              completed: t("Common.Installed"),
              action: t("Common.Install"),
              inProgress: t("Common.Downloading"),
              finalizing: t("Common.Extracting"),
            }}
            onClick={() => {
              if (!puzzleDb.downloadLink) return;
              downloadDatabase(databaseId, puzzleDb.downloadLink, puzzleDb.title);
            }}
            inProgress={inProgress}
            setInProgress={setInProgress}
          />
        </Box>
      </Group>
    </Paper>
  );
}

export default AddPuzzle;
