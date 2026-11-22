import { Box, Group, Stack, Text } from "@mantine/core";
import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";

// Links JBL mit Sprechblase, der alles erklärt, rechts das Brett.
// Für Lektionen und das Erklärfenster nach einem Fehler.
export default function CoachStage({
  figure,
  say,
  tone = "default",
  actions,
  top,
  children,
  board = 480,
}: {
  figure?: Ref<CoachFigureHandle>;
  say: ReactNode;
  tone?: "default" | "right" | "wrong";
  actions?: ReactNode;
  top?: ReactNode;
  children: ReactNode;
  board?: number;
}) {
  const { t } = useTranslation();
  const border =
    tone === "right"
      ? "var(--mantine-color-teal-6)"
      : tone === "wrong"
        ? "var(--mantine-color-orange-6)"
        : "var(--mantine-color-default-border)";
  return (
    <Group wrap="wrap" align="stretch" gap="xl" justify="center">
      <Stack w={300} gap="md" justify="space-between">
        <Stack gap={0}>
          {top}
          <Box
            pos="relative"
            p="md"
            mt={top ? "sm" : 0}
            style={{
              border: `2px solid ${border}`,
              borderRadius: "var(--mantine-radius-lg)",
              background: "var(--mantine-color-body)",
            }}
            aria-live="polite"
          >
            <Text size="md" lh={1.5}>
              {say}
            </Text>
            {/* Spitze der Sprechblase zu JBL hin */}
            <Box
              pos="absolute"
              left={60}
              bottom={-11}
              w={18}
              h={18}
              style={{
                background: "var(--mantine-color-body)",
                borderRight: `2px solid ${border}`,
                borderBottom: `2px solid ${border}`,
                transform: "rotate(45deg)",
              }}
            />
          </Box>
          <Box mt="lg" style={{ lineHeight: 0 }}>
            <CoachFigure ref={figure} size={170} title={t("Coach.Card.Title")} />
          </Box>
        </Stack>
        {actions && <Stack gap="xs">{actions}</Stack>}
      </Stack>
      <Box w={board} h={board} style={{ flexShrink: 0 }}>
        {children}
      </Box>
    </Group>
  );
}
