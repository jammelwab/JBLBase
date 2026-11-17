import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { tutorialsSeenAtom, useStartTutorial } from "@/components/tutorial/tutorialState";
import { TUTORIALS } from "@/components/tutorial/tutorials";

// All tutorials, each one can be started again at any time
export default function TutorialSettings() {
  const { t } = useTranslation();
  const seen = useAtomValue(tutorialsSeenAtom);
  const start = useStartTutorial();
  return (
    <Stack gap="md">
      {TUTORIALS.map((tutorial) => (
        <Group key={tutorial.id} justify="space-between" wrap="nowrap" align="flex-start">
          <div>
            <Group gap="xs">
              <Text fw={500}>{t(`Tutorial.${tutorial.id}.Title`)}</Text>
              {seen.includes(tutorial.id) && (
                <Badge size="xs" variant="light" color="green">
                  {t("Tutorial.Seen")}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {t(`Tutorial.${tutorial.id}.Desc`)}
            </Text>
          </div>
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlayerPlay size="0.9rem" />}
            onClick={() => start(tutorial.id)}
            style={{ flexShrink: 0 }}
          >
            {t("Tutorial.Start")}
          </Button>
        </Group>
      ))}
    </Stack>
  );
}
