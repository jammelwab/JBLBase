import { Box, Group, Paper, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { ReceiptLine } from "./coachProgress";

// Kassenzettel nach der Partie: woher die XP kommen. Boni stehen nur hier.
export default function CoachReceipt({ lines, lock }: { lines: ReceiptLine[]; lock: number }) {
  const { t } = useTranslation();
  const mono = "ui-monospace, 'Cascadia Mono', Consolas, monospace";
  return (
    <Paper
      mt="xs"
      p="sm"
      radius={0}
      bg="#fffdf8"
      c="#1c1d21"
      shadow="sm"
      style={{ fontFamily: mono, maxWidth: 300 }}
      aria-label={t("Coach.Receipt.Title")}
    >
      <Text ta="center" fw={700} size="xs" style={{ fontFamily: mono, letterSpacing: "0.06em" }}>
        {t("Coach.Receipt.Title")}
      </Text>
      <Box my={4} style={{ borderTop: "1px dashed #9a9ca6" }} />
      {lines.map((l) => (
        <Box key={l.key}>
          {l.kind === "total" && <Box my={4} style={{ borderTop: "1px dashed #9a9ca6" }} />}
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" fw={l.kind === "total" ? 700 : 400} style={{ fontFamily: mono }}>
              {t(`Coach.Receipt.${l.key}`, { count: l.count ?? 0, percent: l.percent ?? 0 })}
            </Text>
            <Text
              size="xs"
              fw={l.kind === "total" ? 700 : 400}
              style={{ fontFamily: mono, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
            >
              {l.kind === "total" ? `${l.xp} XP` : `${l.xp >= 0 ? "+" : ""}${l.xp}`}
            </Text>
          </Group>
        </Box>
      ))}
      {lock > 0 && (
        <Text size="xs" mt={6} c="#6a6c75" style={{ fontFamily: mono }}>
          {t("Coach.Receipt.Lock", { count: lock })}
        </Text>
      )}
    </Paper>
  );
}
