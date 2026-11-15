import { NumberInput, SegmentedControl, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { Strictness } from "@/bindings";

export type TacticCriteria = { strictness: Strictness; minSolverMoves: number };

export const DEFAULT_TACTIC_CRITERIA: TacticCriteria = { strictness: "normal", minSolverMoves: 1 };

const LEVELS: Strictness[] = ["loose", "normal", "strict"];

/**
 * How fussy a tactic search is: the strictness level and the shortest solution. Shared by the
 * search in a repertoire and the one in the own games.
 */
export default function TacticCriteriaControl({
  value,
  onChange,
  disabled,
}: {
  value: TacticCriteria;
  onChange: (value: TacticCriteria) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <Stack gap={2}>
        <Text size="sm" fw={500}>
          {t("Tactics.Strictness.Label")}
        </Text>
        <SegmentedControl
          data={LEVELS.map((level) => ({ value: level, label: t(`Tactics.Strictness.${level}`) }))}
          value={value.strictness}
          onChange={(strictness) => onChange({ ...value, strictness: strictness as Strictness })}
          disabled={disabled}
        />
        <Text size="xs" c="dimmed">
          {t(`Tactics.Strictness.${value.strictness}Hint`)}
        </Text>
      </Stack>
      <NumberInput
        label={t("Tactics.MinMoves")}
        description={t("Tactics.MinMovesHint")}
        min={1}
        max={5}
        value={value.minSolverMoves}
        onChange={(n) => typeof n === "number" && onChange({ ...value, minSolverMoves: n })}
        disabled={disabled}
      />
    </Stack>
  );
}
