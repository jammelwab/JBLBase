import {
  Alert,
  Badge,
  Box,
  Button,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { gameInputColorAtom } from "@/state/atoms";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { StrengthSelect } from "./CoachPage";
import { coachSparringAtom } from "./coachPlan";
import { ATTACK_LEVEL, coachAttackAtom } from "./coachEggs";
import { coachXpAtom, levelProgress } from "./coachState";

// Vor der Partie gegen JBL: Farbe und Stärke wählen, dann los.
export default function CoachGameSetup({
  hasEngine,
  hasPatricia,
  canStart,
  onStart,
}: {
  hasEngine: boolean;
  hasPatricia: boolean;
  canStart: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const [color, setColor] = useAtom(gameInputColorAtom);
  const [sparring, setSparring] = useAtom(coachSparringAtom);
  const [attack, setAttack] = useAtom(coachAttackAtom);
  const level = levelProgress(useAtomValue(coachXpAtom)).level;
  const attackOpen = level >= ATTACK_LEVEL;

  useEffect(() => {
    const timer = setTimeout(() => figure.current?.play("hello"), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Stack h="100%" justify="space-between" gap="md">
      <Stack align="center" gap="sm">
        <Box style={{ lineHeight: 0 }}>
          <CoachFigure ref={figure} size={150} title={t("Coach.Card.Title")} />
        </Box>
        <Title order={3}>{t("Coach.Game.Title")}</Title>
        <Text size="sm" c="dimmed" ta="center">
          {t("Coach.Game.Intro")}
        </Text>
        <Box w="100%" maw={360}>
          <Text size="sm" fw={500} mb={4}>
            {t("Coach.Game.Color")}
          </Text>
          <SegmentedControl
            fullWidth
            value={color}
            onChange={(v) => setColor(v as typeof color)}
            data={[
              { value: "white", label: t("Coach.Game.White") },
              { value: "random", label: t("Coach.Game.Random") },
              { value: "black", label: t("Coach.Game.Black") },
            ]}
          />
          <Text size="sm" fw={500} mt="sm" mb={4}>
            {t("Coach.Strength.Label")}
          </Text>
          <StrengthSelect />
          <Switch
            mt="md"
            color="orange"
            checked={sparring}
            onChange={(e) => setSparring(e.currentTarget.checked)}
            label={t("Coach.Game.Sparring")}
            description={t("Coach.Game.SparringDesc")}
          />
          <Switch
            mt="sm"
            color="orange"
            checked={attackOpen && hasPatricia && attack}
            disabled={!attackOpen || !hasPatricia}
            onChange={(e) => setAttack(e.currentTarget.checked)}
            label={
              <>
                {t("Coach.Game.Attack")}
                {!attackOpen && (
                  <Badge ml={6} size="xs" variant="light" color="gray">
                    {t("Coach.Game.AttackLocked", { level: ATTACK_LEVEL })}
                  </Badge>
                )}
              </>
            }
            description={
              attackOpen && !hasPatricia
                ? t("Coach.Game.AttackNoEngine")
                : t("Coach.Game.AttackDesc")
            }
          />
        </Box>
        {!hasEngine && (
          <Alert color="orange" w="100%" maw={360}>
            {t("Coach.Game.NoEngine")}
          </Alert>
        )}
      </Stack>
      <Button color="orange" fullWidth onClick={onStart} disabled={!hasEngine || !canStart}>
        {t("Coach.Game.Start")}
      </Button>
    </Stack>
  );
}
