import { Button, Paper, Text } from "@mantine/core";
import { IconBulb } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { askCoachExplain } from "@/utils/cloud/auth";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import { type ExplainError, type ExplainFacts, explainError } from "./coachExplain";
import { REACTION_SIGN } from "./coachGame";
import { coachIntroAtom } from "./coachIntroState";
import type { CoachComment } from "./useCoachCommentary";

// Schon gefragte Erklärungen dieser Sitzung (die Cloud merkt sie sich auch)
const asked = new Map<string, string>();

// „Warum?“ neben dem Zeichen des letzten Zugs: erst ein Klick fragt die KI.
export default function CoachWhy({ comment }: { comment: CoachComment | null }) {
  const { t, i18n } = useTranslation();
  const account = useAtomValue(cloudAccountAtom);
  const stage = useAtomValue(coachIntroAtom).entry ?? "knows";
  const [state, setState] = useState<{
    id: number;
    busy: boolean;
    text?: string;
    error?: ExplainError;
  } | null>(null);
  // Theorie und solide Züge haben kein Zeichen: da gibt es nichts zu erklären
  if (!comment || !account || !REACTION_SIGN[comment.reaction]) return null;

  const sign = REACTION_SIGN[comment.reaction];
  const lang = i18n.language.startsWith("en") ? "en" : "de";
  const key = `${comment.fen}|${comment.san}|${stage}|${lang}`;
  const mine = state?.id === comment.id ? state : null;
  const text = mine?.text ?? asked.get(key);

  const ask = async () => {
    const id = comment.id;
    setState({ id, busy: true });
    const facts: ExplainFacts = {
      fen: comment.fen,
      move: comment.san,
      best: comment.best,
      line: comment.line,
      before: comment.before,
      after: comment.after,
      mark: sign,
      motifs: comment.motifs,
      stage,
      lang,
    };
    try {
      const answer = await askCoachExplain(facts);
      asked.set(key, answer);
      setState({ id, busy: false, text: answer });
    } catch (e) {
      setState({ id, busy: false, error: explainError(e) });
    }
  };

  if (text)
    return (
      <Paper radius="md" p="xs" mt={6} withBorder>
        <Text size="sm">{text}</Text>
      </Paper>
    );

  return (
    <>
      <Button
        size="compact-xs"
        variant="subtle"
        color="gray"
        mt={4}
        leftSection={<IconBulb size={14} />}
        loading={mine?.busy}
        disabled={mine?.error === "limit"}
        onClick={() => void ask()}
      >
        {t("Coach.Why.Button", { sign, move: comment.san })}
      </Button>
      {mine?.error && (
        <Text size="xs" c="dimmed">
          {t(`Coach.Why.Error.${mine.error}`)}
        </Text>
      )}
    </>
  );
}
