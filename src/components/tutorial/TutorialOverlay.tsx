import { Button, CloseButton, Group, Paper, Portal, Progress, Text } from "@mantine/core";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Box, placeCard, visibleBox } from "./placement";
import {
  activeTutorialAtom,
  modalOpen,
  tutorialsSeenAtom,
  useStartTutorial,
} from "./tutorialState";
import { findTutorial, type TutorialStep } from "./tutorials";

const Z = 2000;

function findTarget(target: TutorialStep["target"]): HTMLElement | null {
  if (!target) return null;
  for (const name of Array.isArray(target) ? target : [target]) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

function toBox(el: HTMLElement | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1);

// Shows the running tutorial: the current step's element stays bright while the rest of the
// window is dimmed, with the step's text next to it. Clicks still reach the app, so the user
// can try out what a step explains.
export default function TutorialOverlay() {
  const { t } = useTranslation();
  const [active, setActive] = useAtom(activeTutorialAtom);
  const setSeen = useSetAtom(tutorialsSeenAtom);
  const startTutorial = useStartTutorial();
  const tutorial = active ? findTutorial(active.id) : undefined;
  const step = tutorial && active ? tutorial.steps[active.step] : undefined;
  const [box, setBox] = useState<Box | null>(null);
  // Hidden while a window of the app is open over the page (e.g. "New repertoire")
  const [paused, setPaused] = useState(false);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ width: 360, height: 200 });

  const finish = useCallback(() => {
    if (active) setSeen((prev) => (prev.includes(active.id) ? prev : [...prev, active.id]));
    setActive(null);
  }, [active, setActive, setSeen]);

  const goTo = useCallback(
    (index: number) => {
      if (!tutorial || !active) return;
      if (index >= tutorial.steps.length) finish();
      else setActive({ id: active.id, step: Math.max(0, index) });
    },
    [tutorial, active, finish, setActive],
  );

  // Follow the element (it may move, appear or go away). A step that asks for a click moves on
  // once the click did its work: its element is gone or the next step's element is there.
  useEffect(() => {
    if (!step || !tutorial || !active) return;
    const next = tutorial.steps[active.step + 1];
    let seen = false;
    let scrolled = false;
    const tick = () => {
      const blocked = modalOpen();
      setPaused(blocked);
      if (blocked) return;
      const el = findTarget(step.target);
      if (el && !scrolled) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        scrolled = true;
      }
      setBox((prev) => {
        const b = toBox(el);
        return sameBox(prev, b) ? prev : b;
      });
      setViewport((prev) =>
        prev.width === window.innerWidth && prev.height === window.innerHeight
          ? prev
          : { width: window.innerWidth, height: window.innerHeight },
      );
      if (el) seen = true;
      if (step.action && seen) {
        const nextEl = next ? findTarget(next.target) : null;
        if (!el || (nextEl && nextEl !== el)) goTo(active.step + 1);
      }
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [step, tutorial, active, goTo]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setCardSize((prev) =>
      Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
        ? prev
        : { width, height },
    );
  }, [active, box, paused]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape in a window of the app closes that window, not the tutorial
      if (e.key === "Escape" && !modalOpen()) finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, finish]);

  if (!tutorial || !step || !active || paused) return null;

  const last = active.step === tutorial.steps.length - 1;
  const highlight = box ? visibleBox(box, viewport) : null;
  const pos = placeCard(highlight, cardSize, viewport);
  const key = `Tutorial.${tutorial.id}.${step.id}`;
  const next = last && tutorial.next ? findTutorial(tutorial.next) : undefined;

  function onNext() {
    if (step?.action) {
      const el = findTarget(step.target);
      if (el) {
        el.click();
        return;
      }
    }
    goTo((active?.step ?? 0) + 1);
  }

  return (
    <Portal>
      {highlight ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: highlight.left,
            top: highlight.top,
            width: highlight.width,
            height: highlight.height,
            borderRadius: 8,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
            outline: "2px solid var(--mantine-primary-color-filled)",
            pointerEvents: "none",
            zIndex: Z,
            transition: "all 150ms ease",
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            pointerEvents: "none",
            zIndex: Z,
          }}
        />
      )}
      <Paper
        ref={cardRef}
        role="dialog"
        aria-label={t(`Tutorial.${tutorial.id}.Title`)}
        shadow="xl"
        withBorder
        radius="md"
        p="md"
        w={360}
        style={{
          position: "fixed",
          left: pos.left,
          top: pos.top,
          zIndex: Z + 1,
          maxWidth: "calc(100vw - 16px)",
        }}
      >
        <Group justify="space-between" wrap="nowrap" mb={6}>
          <Text size="xs" c="dimmed">
            {t(`Tutorial.${tutorial.id}.Title`)} ·{" "}
            {t("Tutorial.StepOf", { step: active.step + 1, count: tutorial.steps.length })}
          </Text>
          <CloseButton size="sm" aria-label={t("Tutorial.Skip")} onClick={finish} />
        </Group>
        <Progress value={((active.step + 1) / tutorial.steps.length) * 100} size="xs" mb="sm" />
        <Text fw={600} mb={4}>
          {t(`${key}.Title`)}
        </Text>
        <Text size="sm" style={{ whiteSpace: "pre-line" }}>
          {t(`${key}.Body`)}
        </Text>
        {step.action && box && (
          <Text size="xs" c="dimmed" mt={6}>
            {t("Tutorial.ClickHint")}
          </Text>
        )}
        <Group justify="space-between" mt="md" wrap="nowrap">
          <Button variant="subtle" color="gray" size="xs" onClick={finish}>
            {last ? t("Tutorial.Close") : t("Tutorial.Skip")}
          </Button>
          <Group gap="xs" wrap="nowrap">
            {active.step > 0 && (
              <Button variant="default" size="xs" onClick={() => goTo(active.step - 1)}>
                {t("Tutorial.Back")}
              </Button>
            )}
            {!next && (
              <Button size="xs" onClick={last ? finish : onNext} data-autofocus>
                {last ? t("Tutorial.Finish") : t("Tutorial.Next")}
              </Button>
            )}
          </Group>
        </Group>
        {next && (
          <Button
            fullWidth
            size="xs"
            mt="xs"
            onClick={() => {
              finish();
              startTutorial(next.id);
            }}
          >
            {t("Tutorial.ContinueWith", { name: t(`Tutorial.${next.id}.Title`) })}
          </Button>
        )}
      </Paper>
    </Portal>
  );
}
