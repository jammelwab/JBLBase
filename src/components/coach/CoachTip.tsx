import { ActionIcon, Button, Group, Paper, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { createTab } from "@/utils/tabs";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { today } from "./coachState";
import classes from "./CoachTip.module.css";

// JBL an mehr Orten der App (1.2.24): ein kleiner Auftritt mit einem kurzen
// Tipp zur Seite und dem Weg zum Coach. Wegklicken blendet ihn auf dieser
// Seite für eine Woche aus.

export const COACH_TIP_PLACES = {
  repertoire: 3,
  insight: 2,
  databases: 2,
  engines: 2,
  accounts: 2,
  puzzles: 3,
  files: 2,
} as const;
export type CoachTipPlace = keyof typeof COACH_TIP_PLACES;

export const COACH_TIP_PAUSE_DAYS = 7;
export const coachTipsHiddenAtom = atomWithStorage<Partial<Record<CoachTipPlace, string>>>(
  "jbl-coach-tips-hidden",
  {},
);

// Weggeklickt vor weniger als einer Woche?
export function tipHidden(hiddenOn: string | undefined, day: string): boolean {
  if (!hiddenOn) return false;
  const days = (Date.parse(day) - Date.parse(hiddenOn)) / 86_400_000;
  return Number.isFinite(days) && days < COACH_TIP_PAUSE_DAYS;
}

// Jeden Tag ein anderer Tipp, aber am selben Tag immer derselbe
export function tipIndex(place: CoachTipPlace, day: string): number {
  const n = COACH_TIP_PLACES[place];
  let h = 0;
  for (const c of `${place}${day}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % n) + 1;
}

// Zum Coach: vorhandenen Coach-Tab zeigen oder einen neuen öffnen
export function useOpenCoach() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tabs, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  return () => {
    void navigate({ to: "/" });
    const coachTab = tabs.find((tab) => tab.type === "coach");
    if (coachTab) setActiveTab(coachTab.value);
    else
      void createTab({
        tab: { name: t("Coach.Card.Title"), type: "coach" },
        setTabs,
        setActiveTab,
      });
  };
}

export default function CoachTip({
  place,
  action,
}: {
  place: CoachTipPlace;
  // Eigene Aktion statt „Zum Coach“
  action?: { label: string; onClick: () => void };
}) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useAtom(coachTipsHiddenAtom);
  const openCoach = useOpenCoach();
  const figure = useRef<CoachFigureHandle>(null);
  const day = today();
  const n = useMemo(() => tipIndex(place, day), [place, day]);
  const show = !tipHidden(hidden[place], day);

  // JBL winkt kurz, wenn er auftaucht
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => figure.current?.play("hello"), 400);
    return () => clearTimeout(timer);
  }, [show]);

  if (!show) return null;
  return (
    <Paper radius="md" p="xs" pr="sm" className={classes.tip} data-coach-tip={place}>
      <Group wrap="nowrap" gap="sm" align="center">
        <div className={classes.figure}>
          <CoachFigure ref={figure} size={96} title={t("Coach.Card.Title")} />
        </div>
        <Text size="sm" style={{ flex: 1, minWidth: 0 }}>
          {t(`Coach.Tip.${place}.${n}`)}
        </Text>
        <Button
          size="xs"
          color="orange"
          variant="light"
          onClick={action?.onClick ?? openCoach}
          style={{ flexShrink: 0 }}
        >
          {action?.label ?? t("Coach.Tip.ToCoach")}
        </Button>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={t("Coach.Tip.Hide")}
          onClick={() => setHidden((h) => ({ ...h, [place]: day }))}
        >
          <IconX size={14} />
        </ActionIcon>
      </Group>
    </Paper>
  );
}
