import {
  Box,
  Button,
  Group,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconArrowRight, IconBook, IconDownload, IconSwords } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStartTutorial } from "@/components/tutorial/tutorialState";
import { selectedPuzzleDbAtom, sessionsAtom } from "@/state/atoms";
import { getChessComAccount } from "@/utils/chess.com/api";
import { cloudAccountAtom, cloudSyncStatusAtom } from "@/utils/cloud/sync";
import { getLichessAccount } from "@/utils/lichess/api";
import { downloadPuzzlesOnce } from "@/utils/lichessPuzzles";
import { addSession } from "@/utils/session";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import {
  coachIntroAtom,
  coachIntroOpenAtom,
  INTRO_LATER_FROM,
  INTRO_STEPS,
  introDue,
} from "./coachIntroState";
import { COACH_ENTRIES, type CoachEntry, ENTRY_STRENGTH } from "./coachLessonsData";
import { coachStrengthAtom } from "./coachState";

// Die Einführung beim ersten Start: fünf Schritte mit je einem Satz. Sie
// liegt über allem, bis man fertig ist oder ab Schritt 2 „Später“ drückt.
export default function CoachIntro() {
  const { t } = useTranslation();
  const [state, setState] = useAtom(coachIntroAtom);
  const [forced, setForced] = useAtom(coachIntroOpenAtom);
  const account = useAtomValue(cloudAccountAtom);
  const synced = useAtomValue(cloudSyncStatusAtom).lastSync !== undefined;
  const setStrength = useSetAtom(coachStrengthAtom);
  const setSessions = useSetAtom(sessionsAtom);
  const startTutorial = useStartTutorial();
  const navigate = useNavigate();
  const figure = useRef<CoachFigureHandle>(null);
  const [step, setStep] = useState(0);
  const [site, setSite] = useState<"lichess" | "chesscom">("lichess");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const opened = forced || introDue(state, !!account, synced);
  const setPuzzleDb = useSetAtom(selectedPuzzleDbAtom);

  // Bei der ersten Einführung lädt die kleine Puzzle-Auswahl im Hintergrund
  // und ist danach ausgewählt (1.2.29)
  useEffect(() => {
    if (!opened || state.done) return;
    void downloadPuzzlesOnce((path) => setPuzzleDb(path));
  }, [opened, state.done, setPuzzleDb]);

  useEffect(() => {
    if (!opened || step !== 0) return;
    const timer = setTimeout(() => figure.current?.play("hello"), 400);
    return () => clearTimeout(timer);
  }, [opened, step]);

  const close = () => {
    setForced(false);
    setStep(0);
  };

  const later = () => {
    setState((s) => ({ ...s, later: true }));
    close();
  };

  const finish = () => {
    setState((s) => ({ ...s, done: true }));
    close();
    // Zum Schluss zeigt der Coach auf seine Karte und das Fragezeichen
    void navigate({ to: "/" });
    startTutorial("CoachIntro");
  };

  const choose = (entry: CoachEntry) => {
    setState((s) => ({ ...s, entry }));
    setStrength(ENTRY_STRENGTH[entry]);
    setStep(2);
  };

  const addAccount = async () => {
    const username = name.trim();
    if (!username) return setStep(3);
    setBusy(true);
    setNotFound(false);
    try {
      if (site === "chesscom") {
        const stats = await getChessComAccount(username);
        if (!stats) return setNotFound(true);
        setSessions((s) =>
          addSession(s, { chessCom: { username, stats }, player: username, updatedAt: Date.now() }),
        );
      } else {
        const lichess = await getLichessAccount({ username });
        if (!lichess) return setNotFound(true);
        setSessions((s) =>
          addSession(s, {
            lichess: { username, account: lichess },
            player: username,
            updatedAt: Date.now(),
          }),
        );
      }
      setStep(3);
    } catch {
      setNotFound(true);
    } finally {
      setBusy(false);
    }
  };

  const say = (key: string) => (
    <Group wrap="nowrap" align="center" gap="md">
      <CoachFigure ref={figure} size={step === 0 ? 120 : 80} title={t("Coach.Card.Title")} />
      <Text size="lg" fw={500}>
        {t(`Coach.Intro.${key}`)}
      </Text>
    </Group>
  );

  return (
    <Modal
      opened={opened}
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      centered
      size="lg"
      radius="lg"
      zIndex={2100}
    >
      <Stack gap="lg" p="xs">
        {step === 0 && (
          <>
            {say("Hello")}
            <Button color="orange" radius="md" onClick={() => setStep(1)}>
              {t("Coach.Intro.Next")}
            </Button>
          </>
        )}
        {step === 1 && (
          <>
            {say("Strength")}
            <SimpleGrid cols={{ base: 1, xs: 2 }}>
              {COACH_ENTRIES.map((e) => (
                <Button
                  key={e}
                  size="lg"
                  h={64}
                  radius="md"
                  variant={state.entry === e ? "filled" : "light"}
                  color="orange"
                  onClick={() => choose(e)}
                  styles={{ label: { whiteSpace: "normal", textAlign: "center" } }}
                >
                  {t(`Coach.Intro.Entry.${e}`)}
                </Button>
              ))}
            </SimpleGrid>
          </>
        )}
        {step === 2 && (
          <>
            {say("Games")}
            <SegmentedControl
              value={site}
              onChange={(v) => setSite(v as typeof site)}
              data={[
                { value: "lichess", label: "Lichess" },
                { value: "chesscom", label: "Chess.com" },
              ]}
            />
            <TextInput
              label={t("Coach.Intro.Username")}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              error={notFound ? t("Coach.Intro.NotFound") : undefined}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addAccount();
              }}
            />
            <Group grow>
              <Button variant="light" radius="md" onClick={() => setStep(3)}>
                {t("Coach.Intro.Skip")}
              </Button>
              <Button
                color="orange"
                radius="md"
                loading={busy}
                disabled={!name.trim()}
                onClick={() => void addAccount()}
              >
                {t("Coach.Intro.Add")}
              </Button>
            </Group>
          </>
        )}
        {step === 3 && (
          <>
            {say("Way")}
            <Group justify="center" gap="xs" wrap="nowrap" align="flex-start">
              {[
                { key: "Load", icon: <IconDownload size={32} /> },
                { key: "Build", icon: <IconBook size={32} /> },
                { key: "Train", icon: <IconSwords size={32} /> },
              ].map((s, i) => (
                <Group key={s.key} gap="xs" wrap="nowrap" align="flex-start">
                  {i > 0 && (
                    <Box pt={6}>
                      <IconArrowRight size={20} />
                    </Box>
                  )}
                  <Stack gap={4} align="center" maw={150}>
                    <Box c="orange">{s.icon}</Box>
                    <Text size="sm" ta="center">
                      {t(`Coach.Intro.Way.${s.key}`)}
                    </Text>
                  </Stack>
                </Group>
              ))}
            </Group>
            <Button color="orange" radius="md" onClick={() => setStep(4)}>
              {t("Coach.Intro.Next")}
            </Button>
          </>
        )}
        {step === 4 && (
          <>
            {say("GoText")}
            <Button color="orange" radius="md" onClick={finish}>
              {t("Coach.Intro.Go")}
            </Button>
          </>
        )}
        <Group justify="space-between" align="center">
          <Group gap={6} aria-label={t("Coach.Intro.StepOf", { n: step + 1, total: INTRO_STEPS })}>
            {Array.from({ length: INTRO_STEPS }, (_, i) => (
              <Box
                key={i}
                w={8}
                h={8}
                style={{
                  borderRadius: 4,
                  background:
                    i === step ? "var(--mantine-color-orange-6)" : "var(--mantine-color-gray-4)",
                }}
              />
            ))}
          </Group>
          {step >= INTRO_LATER_FROM && step < INTRO_STEPS - 1 && (
            <Button size="compact-xs" variant="subtle" color="gray" onClick={later}>
              {t("Coach.Intro.Later")}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
