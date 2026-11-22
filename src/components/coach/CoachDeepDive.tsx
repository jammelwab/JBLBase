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
import { lineSteps, moveNumber, motifsFor } from "./coachDeep";
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

type View = "move" | "answer";

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
  const [view, setView] = useState<View>("answer");
  const motifs = useMemo(() => motifsFor(comment), [comment]);
  // Die Folge bis zu 2 Zügen (4 Halbzügen) tief, Schritt für Schritt
  const steps = useMemo(() => lineSteps(comment.fenAfter, comment.line, 4), [comment]);
  const [step, setStep] = useState(1);
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
      line: comment.line,
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

  // Ohne Claude: die Erklärung aus den erkannten Motiven
  const local = [
    ...motifs.map((m) => t(`Coach.Deep.Motif.${m.id}.Explain`)),
    comment.best ? t("Coach.Line.Better", { move: comment.best }) : "",
  ]
    .filter(Boolean)
    .join(" ");
  const say = busy ? (
    <Group gap="xs" wrap="nowrap">
      <Loader size="xs" color="orange" />
      <Text span>{t("Coach.Deep.Thinking")}</Text>
    </Group>
  ) : (
    <>
      {(text ?? local) || t("Coach.Deep.NoMotif")}
      {failed && !text && (
        <Text size="xs" c="dimmed" mt={6}>
          {failed}
        </Text>
      )}
    </>
  );

  const played = sanToSquares(comment.fen, comment.san);
  const best = comment.best ? sanToSquares(comment.fen, comment.best) : null;
  const current = steps[step - 1] ?? null;
  const shapes =
    view === "move"
      ? [
          ...(played ? [{ orig: played[0] as Key, dest: played[1] as Key, brush: "red" }] : []),
          ...(best ? [{ orig: best[0] as Key, dest: best[1] as Key, brush: "green" }] : []),
        ]
      : [
          ...(current
            ? [{ orig: current.from as Key, dest: current.to as Key, brush: "red" }]
            : []),
          // Was die Antwort trifft: die Ziele des Motivs
          ...motifs
            .filter((m) => m.from && step === 1)
            .flatMap((m) =>
              m.targets
                .filter((sq) => sq !== m.from)
                .map((sq) => ({ orig: m.from as Key, dest: sq as Key, brush: "yellow" })),
            ),
        ];
  const fen = view === "move" ? comment.fen : (current?.fen ?? comment.fenAfter);
  // Ply der Stellung vor deinem Zug, für die Zugnummern der Folge
  const basePly =
    (Number(comment.fen.split(" ")[5]) || 1) * 2 - (comment.fen.split(" ")[1] === "w" ? 1 : 0);
  const orientation = comment.fen.split(" ")[1] === "b" ? "black" : "white";

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
          <SegmentedControl
            fullWidth
            radius="md"
            value={view}
            onChange={(v) => setView(v as View)}
            data={[
              { value: "move", label: t("Coach.Deep.ViewMove") },
              { value: "answer", label: t("Coach.Deep.ViewAnswer") },
            ]}
          />
          <Text size="xs" c="dimmed">
            {view === "move"
              ? comment.best
                ? t("Coach.Deep.LegendMove", { move: comment.san, best: comment.best })
                : t("Coach.Deep.LegendMoveOnly", { move: comment.san })
              : current
                ? step === 1
                  ? t("Coach.Deep.LegendAnswer", { move: current.san })
                  : t("Coach.Deep.LegendStep", {
                      move: `${moveNumber(basePly + step)}${current.san}`,
                    })
                : ""}
          </Text>
          {view === "answer" && steps.length > 1 && (
            <Group gap={6} justify="center">
              <ActionIcon
                variant="light"
                color="gray"
                disabled={step <= 1}
                onClick={() => setStep(step - 1)}
                aria-label={t("Coach.Deep.Prev")}
              >
                <IconChevronLeft size={18} />
              </ActionIcon>
              <Text size="sm" fw={600}>
                {t("Coach.Deep.StepOf", { n: step, total: steps.length })}
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
