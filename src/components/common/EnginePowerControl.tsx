import { SegmentedControl, Stack, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { cpuCores, enginePowerAtom, POWER_LEVELS, powerSettings } from "@/utils/enginePower";

/**
 * How much of the computer a long analysis may use. Shared by the tactic search, Insight and
 * the check of reported puzzles.
 */
export default function EnginePowerControl({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const [power, setPower] = useAtom(enginePowerAtom);
  const { threads, hash } = powerSettings(power);
  return (
    <Stack gap={2}>
      <Text size="sm" fw={500}>
        {t("EnginePower.Label")}
      </Text>
      <SegmentedControl
        data={POWER_LEVELS.map((level) => ({
          value: level,
          label: t(`EnginePower.${level}`),
        }))}
        value={power}
        onChange={(value) => setPower(value as typeof power)}
        disabled={disabled}
      />
      <Text size="xs" c="dimmed">
        {t("EnginePower.Detail", { threads, cores: cpuCores(), hash })}
      </Text>
    </Stack>
  );
}
