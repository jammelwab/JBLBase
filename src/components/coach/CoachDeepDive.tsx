import {
  ActionIcon,
  Badge,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { Key } from "@lichess-org/chessground/types";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chessground } from "@/chessground/Chessground";
import { askCoachExplain } from "@/utils/cloud/auth";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import { sanToSquares } from "@/utils/gamesTree";
import type { CoachFigureHandle } from "./CoachFigure";
import CoachStage from "./CoachStage";
import {
  type DeepView as View,
  firstView,
  linePoint,
  lineSteps,
  moveNumber,
  motifsFor,
} from "./coachDeep";
import { explainError } from "./coachExplain";
import { REACTION_SIGN } from "./coachGame";
import { coachIntroAtom } from "./coachIntroState";
import type { CoachComment } from "./useCoachCommentary";

// Schon geholte Tiefenerklärungen dieser Sitzung
const asked = new Map<string, string>();

const MOTIF_COLOR: Record<string, string> = {
  mate: "red",
  fork: "orange",
  pin: "grape",
  skewer: "violet",
  hanging: "yellow",
};

// Eigenes Fenster nach einem Fehler: JBL erklärt, warum der Zug ein ?? war,
// und das Taktikmotiv dahinter. Die Motive erkennt die App selbst.
export default function CoachDeepDive({
  comment,
  onClose,
}: {
  comment: CoachComment | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      opened={comment !== null}
      onClose={onClose}
      title={
        comment
          ? t("Coach.Deep.Title", { move: comment.san, sign: REACTION_SIGN[comment.reaction] })
          : ""
      }
      centered
      size="auto"
      padding="xl"
      styles={{ title: { fontWeight: 700, fontSize: "var(--mantine-font-size-xl)" } }}
    >
      {comment && <DeepView key={comment.id} comment={comment} />}
    </Modal>
  );
}

function DeepView({ comment }: { comment: CoachComment }) {
  const { t, i18n } = useTranslation();
  const account = useAtomValue(cloudAccountAtom);
  const stage = useAtomValue(coachIntroAtom).entry ?? "knows";
  const lang = i18n.language.startsWith("en") ? "en" : "de";
  const figure = useRef<CoachFigureHandle>(null);
  const motifs = useMemo(() => motifsFor(comment), [comment]);
  // 1.2.34: so viele Halbzüge, wie der Punkt der Folge braucht (statt immer 4)
  const answerPoint = useMemo(() => linePoint(comment.fenAfter, comment.line), [comment]);
  const betterPoint = useMemo(() => linePoint(comment.fen, comment.bestLine ?? []), [comment]);
  const answerSteps = useMemo(
    () => lineSteps(comment.fenAfter, comment.line, Math.max(1, answerPoint.plies)),
    [comment, answerPoint],
  );
  const betterSteps = useMemo(
    () => lineSteps(comment.fen, comment.bestLine ?? [], Math.max(1, betterPoint.plies)),
    [comment, betterPoint],
  );
  const [view, setView] = useState<View>(() => firstView(answerPoint, betterPoint));
  // Schritt 0 der besseren Folge: die Stellung vor deinem Zug mit beiden Pfeilen
  const [answerStep, setAnswerStep] = useState(1);
  const [betterStep, setBetterStep] = useState(0);
  const key = `${comment.fen}|${comment.san}|${stage}|${lang}`;
  const [text, setText] = useState<string | null>(asked.get(key) ?? null);
  const [busy, setBusy] = useState(!text && !!account);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    figure.current?.play("think");
    if (text || !account) return;
    let alive = true;
    const facts = [...motifs.map((m) => m.text), ...comment.motifs].slice(0, 4);
    askCoachExplain({
      mode: "deep",
      fen: comment.fen,
      move: comment.san,
      best: comment.best,
      // Genau die Züge, die das Brett zeigt (1.2.34)
      line: answerSteps.map((s) => s.san),
      bestLine: comment.best ? betterSteps.map((s) => s.san) : [],
      before: comment.before,
      after: comment.after,
      mark: REACTION_SIGN[comment.reaction],
      motifs: facts,
      stage,
      lang,
    })
      .then((answer) => {
        asked.set(key, answer);
        if (alive) setText(answer);
      })
      .catch((e) => alive && setFailed(t(`Coach.Why.Error.${explainError(e)}`)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ohne Claude: die Erklärung aus den erkannten Motiven und den Folgen
  const local = [
    ...motifs.map((m) => t(`Coach.Deep.Motif.${m.id}.Explain`)),
    answerPoint.kind === "material" ? t("Coach.Deep.Loses", { count: answerPoint.gain }) : "",
    comment.best
      ? betterPoint.kind === "mate"
        ? t("Coach.Deep.BetterMate", { move: comment.best })
        : betterPoint.kind === "material"
          ? t("Coach.Deep.BetterWins", { move: comment.best, count: betterPoint.gain })
          : t("Coach.Line.Better", { move: comment.best })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  // Weder Motiv noch Material: die Stellung wird nur schlechter
  const quiet = motifs.length === 0 && answerPoint.kind === "quiet" && betterPoint.kind === "quiet";
  const say = busy ? (
    <Group gap="xs" wrap="nowrap">
      <Loader size="xs" color="orange" />
      <Text span>{t("Coach.Deep.Thinking")}</Text>
    </Group>
  ) : (
    <>
      {text ??
        (quiet
          ? `${t("Coach.Deep.NoMotif", { before: comment.before, after: comment.after })}${comment.best ? ` ${t("Coach.Line.Better", { move: comment.best })}` : ""}`
          : local)}
      {failed && !text && (
        <Text size="xs" c="dimmed" mt={6}>
          {failed}
        </Text>
      )}
    </>
  );

  const played = sanToSquares(comment.fen, comment.san);
  const best = comment.best ? sanToSquares(comment.fen, comment.best) : null;
  // Ply der Stellung vor deinem Zug, für die Zugnummern der Folgen
  const basePly =
    (Number(comment.fen.split(" ")[5]) || 1) * 2 - (comment.fen.split(" ")[1] === "w" ? 1 : 0);
  const orientation = comment.fen.split(" ")[1] === "b" ? "black" : "white";

  const steps = view === "answer" ? answerSteps : betterSteps;
  const step = view === "answer" ? answerStep : betterStep;
  const setStep = view === "answer" ? setAnswerStep : setBetterStep;
  const minStep = view === "answer" ? 1 : 0;
  const current = step > 0 ? (steps[step - 1] ?? null) : null;
  // Wer zieht in diesem Schritt? Antwort: Schritt 1 ist der Gegner.
  // Bessere Folge: Schritt 1 bist du.
  const yours = view === "answer" ? step % 2 === 0 : step % 2 === 1;
  // Ply des gezeigten Zugs: die Antwort beginnt nach deinem Zug
  const ply = view === "answer" ? basePly + step : basePly + step - 1;
  const shapes =
    view === "better" && step === 0
      ? [
          ...(played ? [{ orig: played[0] as Key, dest: played[1] as Key, brush: "red" }] : []),
          ...(best ? [{ orig: best[0] as Key, dest: best[1] as Key, brush: "green" }] : []),
        ]
      : [
          ...(current
            ? [
                {
                  orig: current.from as Key,
                  dest: current.to as Key,
                  // Rot: der Gegner, grün: du in der besseren Folge, blau: du in der Antwort
                  brush: yours ? (view === "better" ? "green" : "blue") : "red",
                },
              ]
            : []),
          // Was die Antwort trifft: die Ziele des Motivs
          ...(view === "answer" && step === 1
            ? motifs
                .filter((m) => m.from)
                .flatMap((m) =>
                  m.targets
                    .filter((sq) => sq !== m.from)
                    .map((sq) => ({ orig: m.from as Key, dest: sq as Key, brush: "yellow" })),
                )
            : []),
        ];
  const fen =
    view === "better" ? (current?.fen ?? comment.fen) : (current?.fen ?? comment.fenAfter);
  const moveText = current ? `${moveNumber(ply)}${current.san}` : "";
  const legend =
    view === "better" && step === 0
      ? comment.best
        ? t("Coach.Deep.LegendMove", { move: comment.san, best: comment.best })
        : t("Coach.Deep.LegendMoveOnly", { move: comment.san })
      : !current
        ? ""
        : view === "answer" && step === 1
          ? t(
              motifs.some((m) => m.from)
                ? "Coach.Deep.LegendAnswer"
                : "Coach.Deep.LegendAnswerPlain",
              {
                move: moveText,
              },
            )
          : yours
            ? t(view === "better" ? "Coach.Deep.LegendYouBetter" : "Coach.Deep.LegendYou", {
                move: moveText,
              })
            : t("Coach.Deep.LegendStep", { move: moveText });
  // Am Ende der Folge: was sie gebracht hat
  const atEnd = current !== null && step === steps.length;
  const point = view === "answer" ? answerPoint : betterPoint;
  const outcome =
    !atEnd || point.kind === "quiet"
      ? ""
      : point.kind === "mate"
        ? t("Coach.Deep.EndMate")
        : t(view === "answer" ? "Coach.Deep.EndLoss" : "Coach.Deep.EndGain", {
            count: point.gain,
          });
  const hasBetter = !!comment.best;

  return (
    <CoachStage
      figure={figure}
      say={say}
      tone="wrong"
      top={
        motifs.length > 0 && (
          <Group gap={6}>
            {motifs.map((m) => (
              <Badge key={m.id} color={MOTIF_COLOR[m.id]} variant="light" size="lg">
                {t(`Coach.Deep.Motif.${m.id}.Name`)}
              </Badge>
            ))}
          </Group>
        )
      }
      actions={
        <Stack gap={6}>
          {hasBetter && (
            <SegmentedControl
              fullWidth
              radius="md"
              value={view}
              onChange={(v) => setView(v as View)}
              data={[
                { value: "answer", label: t("Coach.Deep.ViewAnswer") },
                { value: "better", label: t("Coach.Deep.ViewBetter") },
              ]}
            />
          )}
          <Text size="xs" c="dimmed">
            {legend}
            {outcome && (
              <Text span fw={600} c="var(--mantine-color-text)">
                {" "}
                {outcome}
              </Text>
            )}
          </Text>
          {steps.length > minStep && steps.length > 0 && (
            <Group gap={6} justify="center">
              <ActionIcon
                variant="light"
                color="gray"
                disabled={step <= minStep}
                onClick={() => setStep(step - 1)}
                aria-label={t("Coach.Deep.Prev")}
              >
                <IconChevronLeft size={18} />
              </ActionIcon>
              <Text size="sm" fw={600}>
                {step === 0
                  ? t("Coach.Deep.StepStart")
                  : t("Coach.Deep.StepOf", { n: step, total: steps.length })}
              </Text>
              <ActionIcon
                variant="light"
                color="gray"
                disabled={step >= steps.length}
                onClick={() => setStep(step + 1)}
                aria-label={t("Coach.Deep.Next")}
              >
                <IconChevronRight size={18} />
              </ActionIcon>
            </Group>
          )}
        </Stack>
      }
    >
      <Chessground
        coordinates={false}
        viewOnly
        fen={fen}
        orientation={orientation}
        drawable={{ enabled: false, visible: true, autoShapes: shapes }}
      />
    </CoachStage>
  );
}
