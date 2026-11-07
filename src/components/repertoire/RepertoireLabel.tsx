import { Badge, Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { Repertoire } from "@/utils/repertoires";

export function ColorDot({ color }: { color: "white" | "black" }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: color === "white" ? "#f0f0f0" : "#262421",
        border: "1px solid var(--mantine-color-gray-6)",
        flexShrink: 0,
      }}
    />
  );
}

export function RepertoireLabel({ repertoire }: { repertoire: Repertoire }) {
  const { t } = useTranslation();
  return (
    <Group gap={6} wrap="nowrap">
      <ColorDot color={repertoire.color} />
      <Text size="sm" fw={500}>
        {repertoire.name}
      </Text>
      <Badge size="xs" variant="light" color="gray">
        {repertoire.owner}
      </Badge>
      <Text size="xs" c="dimmed">
        {t("Repertoire.MoveCount", { count: repertoire.stats.moves })}
      </Text>
    </Group>
  );
}
