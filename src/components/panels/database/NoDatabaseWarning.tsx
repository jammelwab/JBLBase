import { Anchor, Stack, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

function NoDatabaseWarning() {
  const { t } = useTranslation();

  return (
    <Stack gap={4} py="xs">
      <Text size="sm" fw={500}>
        {t("Board.Database.NoReference1")}
      </Text>
      <Text size="sm" c="dimmed">
        {t("Board.Database.NoReference2")}{" "}
        <Anchor component={Link} to="/databases" size="sm">
          {t("Board.Database.SelectReference")}
        </Anchor>{" "}
        {t("Board.Database.NoReference3")}
      </Text>
    </Stack>
  );
}

export default NoDatabaseWarning;
