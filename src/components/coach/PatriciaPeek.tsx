import { Box, Text, UnstyledButton } from "@mantine/core";
import { useSetAtom } from "jotai";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BunnyEarsPeek, PatriciaBunny } from "./CoachEggArt";
import { catchBunnyAtom, EARS_CHANCE, EARS_WINDOW_MS } from "./coachEggs";
import classes from "./CoachEggs.module.css";
import type { CoachFigureHandle } from "./CoachFigure";

type Stage = "none" | "peek" | "sweet" | "fangs" | "caught" | "again";

// Selten schauen hinter JBL zwei Hasenohren hervor. Wer sie in 3 Sekunden
// anklickt, sieht Patricia: erst zuckersüß, dann die Reißzähne.
export function usePatriciaPeek(random: () => number = Math.random) {
  const [stage, setStage] = useState<Stage>(() => (random() < EARS_CHANCE ? "peek" : "none"));
  useEffect(() => {
    if (stage !== "peek") return;
    const timer = setTimeout(() => setStage("none"), EARS_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [stage]);
  return [stage, setStage] as const;
}

export function PatriciaEars({
  stage,
  setStage,
  figure,
}: {
  stage: Stage;
  setStage: (s: Stage) => void;
  figure: RefObject<CoachFigureHandle | null>;
}) {
  const { t } = useTranslation();
  const catchBunny = useSetAtom(catchBunnyAtom);
  if (stage !== "peek") return null;
  return (
    <UnstyledButton
      className={classes.ears}
      style={{ zIndex: 0 }}
      aria-label={t("Coach.Egg.EarsLabel")}
      onClick={() => {
        setStage("sweet");
        setTimeout(() => {
          setStage("fangs");
          figure.current?.play("scared");
        }, 900);
        setTimeout(() => setStage(catchBunny() ? "caught" : "again"), 2600);
      }}
    >
      <BunnyEarsPeek size={64} />
    </UnstyledButton>
  );
}

export function PatriciaPopup({ stage }: { stage: Stage }) {
  const { t } = useTranslation();
  if (stage === "sweet" || stage === "fangs")
    return (
      <Box
        className={`${classes.pop} ${stage === "fangs" ? classes.shake : ""}`}
        style={{ lineHeight: 0 }}
      >
        <PatriciaBunny size={90} fangs={stage === "fangs"} />
      </Box>
    );
  if (stage === "caught" || stage === "again")
    return (
      <Text size="sm" c="dimmed" maw={180} ta="center">
        {stage === "caught" ? t("Coach.Egg.Caught") : t("Coach.Egg.Again")}
      </Text>
    );
  return null;
}
