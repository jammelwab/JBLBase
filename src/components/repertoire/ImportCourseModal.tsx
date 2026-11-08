import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  Modal,
  Paper,
  Radio,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconChevronDown,
  IconChevronRight,
  IconClipboardText,
  IconFileImport,
  IconTrash,
} from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { lineText } from "@/utils/gamesTree";
import {
  type ConflictChoice,
  type CourseChapter,
  type CourseConflict,
  findCourseConflicts,
  mergeCourse,
} from "@/utils/repertoireTree";
import {
  type Course,
  importCourseIntoRepertoire,
  loadCourseFile,
  parseCourseText,
  type Repertoire,
} from "@/utils/repertoires";
import { RepertoireLabel } from "./RepertoireLabel";

type LoadedCourse = {
  id: number;
  course: Course;
  // Indexes of the chapters to import
  selected: Set<number>;
  expanded: boolean;
};

let nextId = 1;

function ConflictRow({
  conflict,
  choice,
  onChange,
}: {
  conflict: CourseConflict;
  choice: ConflictChoice;
  onChange: (choice: ConflictChoice) => void;
}) {
  const { t } = useTranslation();
  const start = conflict.halfMoves - conflict.line.length;
  const move = (san: string) => lineText([san], conflict.halfMoves);
  return (
    <Paper withBorder p="xs">
      <Stack gap={6}>
        <Text size="xs" c="dimmed">
          {conflict.chapter}
          {" · "}
          {conflict.line.length > 0
            ? lineText(conflict.line, start)
            : t("Repertoire.Add.StartPosition")}
        </Text>
        <Text size="sm">
          {t("Repertoire.Course.ConflictText", {
            course: move(conflict.courseMove),
            mine: conflict.repertoireMoves.map(move).join(", "),
          })}
        </Text>
        <SegmentedControl
          size="xs"
          value={choice}
          onChange={(v) => onChange(v as ConflictChoice)}
          data={[
            { value: "skip", label: t("Repertoire.Course.KeepMine") },
            { value: "alternative", label: t("Repertoire.Course.KeepBoth") },
            { value: "main", label: t("Repertoire.Course.CourseFirst") },
          ]}
        />
      </Stack>
    </Paper>
  );
}

export default function ImportCourseModal({
  opened,
  onClose,
  repertoires,
}: {
  opened: boolean;
  onClose: () => void;
  repertoires: Repertoire[];
}) {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<LoadedCourse[]>([]);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [withNote, setWithNote] = useState(true);
  const [choices, setChoices] = useState<Map<string, ConflictChoice>>(new Map());
  const [saving, setSaving] = useState(false);

  // The dialog is mounted fresh for every import, so its state starts empty each time
  const repertoire = repertoires.find((r) => r.file.path === target) ?? repertoires[0];

  function addCourse(course: Course) {
    if (course.chapters.length === 0) {
      notifications.show({
        color: "orange",
        title: course.name,
        message: t("Repertoire.Course.NoMoves"),
      });
      return;
    }
    setCourses((list) => [
      ...list,
      {
        id: nextId++,
        course,
        selected: new Set(course.chapters.map((_, i) => i)),
        expanded: course.chapters.length <= 12,
      },
    ]);
  }

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setLoading(true);
    try {
      for (const path of paths) {
        try {
          addCourse(await loadCourseFile(path));
        } catch (e) {
          notifications.show({
            color: "red",
            title: t("Repertoire.Course.ReadFailed"),
            message: `${path}: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function addPasted() {
    setLoading(true);
    try {
      addCourse(await parseCourseText(pasteText, t("Repertoire.Course.PastedName")));
      setPasteText("");
      setPasting(false);
    } catch (e) {
      notifications.show({
        color: "red",
        title: t("Repertoire.Course.ReadFailed"),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }

  function updateCourse(id: number, update: (c: LoadedCourse) => LoadedCourse) {
    setCourses((list) => list.map((c) => (c.id === id ? update(c) : c)));
  }

  const chapters = useMemo<CourseChapter[]>(
    () =>
      courses.flatMap(({ course, selected }) =>
        course.chapters
          .filter((_, i) => selected.has(i))
          .map((chapter) => ({
            ...chapter,
            note: withNote ? t("Repertoire.Course.SourceNote", { name: course.name }) : "",
          })),
      ),
    [courses, withNote, t],
  );

  const conflicts = useMemo(
    () =>
      repertoire ? findCourseConflicts(repertoire.root, chapters, repertoire.color, choices) : [],
    [repertoire, chapters, choices],
  );

  // Dry run on a copy, so the dialog can tell how many moves the import adds
  const preview = useMemo(() => {
    if (!repertoire || chapters.length === 0) return null;
    return mergeCourse(structuredClone(repertoire.root), chapters, repertoire.color, choices);
  }, [repertoire, chapters, choices]);

  function setAll(choice: ConflictChoice) {
    setChoices((old) => {
      const next = new Map(old);
      for (const c of conflicts) next.set(c.key, choice);
      return next;
    });
  }

  async function runImport() {
    if (!repertoire) return;
    setSaving(true);
    try {
      const result = await importCourseIntoRepertoire(repertoire.file, chapters, choices, "");
      notifications.show({
        color: result.added > 0 ? "green" : "gray",
        title: repertoire.name,
        message:
          result.added > 0
            ? t("Repertoire.Add.Added", { count: result.added })
            : t("Repertoire.Add.AlreadyThere"),
      });
      onClose();
    } catch (e) {
      notifications.show({
        color: "red",
        title: t("Repertoire.Add.Failed"),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("Repertoire.Course.Title")} size="xl">
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Repertoire.Course.Help")}
        </Text>

        <Group>
          <Button
            leftSection={<IconFileImport size="1rem" />}
            onClick={pickFiles}
            loading={loading && !pasting}
          >
            {t("Repertoire.Course.PickFiles")}
          </Button>
          <Button
            variant={pasting ? "light" : "default"}
            leftSection={<IconClipboardText size="1rem" />}
            onClick={() => setPasting((p) => !p)}
          >
            {t("Repertoire.Course.Paste")}
          </Button>
        </Group>

        <Collapse expanded={pasting}>
          <Stack gap="xs">
            <Textarea
              autosize
              minRows={4}
              maxRows={12}
              placeholder={t("Repertoire.Course.PastePlaceholder")}
              value={pasteText}
              onChange={(e) => setPasteText(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button
                size="xs"
                onClick={addPasted}
                loading={loading && pasting}
                disabled={!pasteText.trim()}
              >
                {t("Repertoire.Course.PasteAdd")}
              </Button>
            </Group>
          </Stack>
        </Collapse>

        {courses.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {t("Repertoire.Course.Selection")}
            </Text>
            <ScrollArea.Autosize mah={260}>
              <Stack gap={4}>
                {courses.map(({ id, course, selected, expanded }) => {
                  const all = selected.size === course.chapters.length;
                  return (
                    <Box key={id}>
                      <Group gap="xs" wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          onClick={() => updateCourse(id, (c) => ({ ...c, expanded: !expanded }))}
                        >
                          {expanded ? (
                            <IconChevronDown size="1rem" />
                          ) : (
                            <IconChevronRight size="1rem" />
                          )}
                        </ActionIcon>
                        <Checkbox
                          checked={all}
                          indeterminate={!all && selected.size > 0}
                          onChange={() =>
                            updateCourse(id, (c) => ({
                              ...c,
                              selected: all ? new Set() : new Set(course.chapters.map((_, i) => i)),
                            }))
                          }
                          label={
                            <Text size="sm" fw={500}>
                              {course.name}{" "}
                              <Text span size="xs" c="dimmed">
                                {t("Repertoire.Course.ChapterCount", {
                                  selected: selected.size,
                                  count: course.chapters.length,
                                })}
                              </Text>
                            </Text>
                          }
                          style={{ flex: 1 }}
                        />
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          aria-label={t("Repertoire.Course.Remove")}
                          onClick={() => setCourses((list) => list.filter((c) => c.id !== id))}
                        >
                          <IconTrash size="1rem" />
                        </ActionIcon>
                      </Group>
                      <Collapse expanded={expanded}>
                        <Stack gap={4} pl={56} py={4}>
                          {course.chapters.map((chapter, i) => (
                            <Checkbox
                              key={i}
                              size="xs"
                              checked={selected.has(i)}
                              onChange={() =>
                                updateCourse(id, (c) => {
                                  const next = new Set(c.selected);
                                  if (next.has(i)) next.delete(i);
                                  else next.add(i);
                                  return { ...c, selected: next };
                                })
                              }
                              label={chapter.name}
                            />
                          ))}
                        </Stack>
                      </Collapse>
                    </Box>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        )}

        {repertoires.length === 0 ? (
          <Alert color="blue">{t("Repertoire.Add.NoRepertoires")}</Alert>
        ) : (
          <Radio.Group
            label={t("Repertoire.Add.Target")}
            value={repertoire?.file.path ?? null}
            onChange={setTarget}
          >
            <Group gap="lg" mt="xs">
              {repertoires.map((r) => (
                <Radio
                  key={r.file.path}
                  value={r.file.path}
                  label={<RepertoireLabel repertoire={r} />}
                />
              ))}
            </Group>
          </Radio.Group>
        )}

        <Checkbox
          checked={withNote}
          onChange={(e) => setWithNote(e.currentTarget.checked)}
          label={t("Repertoire.Course.WithNote")}
        />

        {preview && (
          <>
            <Divider />
            <Text size="sm">
              {t("Repertoire.Course.Summary", {
                count: preview.added,
                conflicts: conflicts.length,
              })}
            </Text>
            {preview.unplaced.length > 0 && (
              <Alert color="orange">
                {t("Repertoire.Course.Unplaced", {
                  count: preview.unplaced.length,
                  names: preview.unplaced.join(", "),
                })}
              </Alert>
            )}
          </>
        )}

        {conflicts.length > 0 && (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                {t("Repertoire.Course.Conflicts")}
              </Text>
              <Group gap="xs">
                <Button size="compact-xs" variant="default" onClick={() => setAll("skip")}>
                  {t("Repertoire.Course.AllKeepMine")}
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => setAll("alternative")}>
                  {t("Repertoire.Course.AllKeepBoth")}
                </Button>
              </Group>
            </Group>
            <ScrollArea.Autosize mah={320}>
              <Stack gap="xs">
                {conflicts.map((conflict) => (
                  <ConflictRow
                    key={conflict.key}
                    conflict={conflict}
                    choice={choices.get(conflict.key) ?? "skip"}
                    onChange={(choice) =>
                      setChoices((old) => new Map(old).set(conflict.key, choice))
                    }
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button
            onClick={runImport}
            loading={saving}
            disabled={!repertoire || !preview || preview.added === 0}
          >
            {t("Repertoire.Course.Import")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
