import { Anchor, Box, Center, Image, Modal, Paper, Stack, Text, Title } from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import CloudLoginForm from "./CloudLoginForm";
import { loginScreenOpenAtom, setLoginSkipped } from "./cloudUi";
import classes from "./LoginScreen.module.css";

/** Full-screen sign-in, shown at the first start and from the side bar. */
export default function LoginScreen() {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(loginScreenOpenAtom);
  const account = useAtomValue(cloudAccountAtom);

  // Signed in: done.
  useEffect(() => {
    if (account && open) setOpen(false);
  }, [account, open, setOpen]);

  const skip = () => {
    setLoginSkipped();
    setOpen(false);
  };

  return (
    <Modal
      opened={open}
      onClose={skip}
      fullScreen
      withCloseButton={false}
      transitionProps={{ transition: "fade", duration: 150 }}
      classNames={{ body: classes.body, content: classes.content }}
    >
      <Center className={classes.center}>
        <Stack align="center" gap="lg" w="100%" maw={420}>
          <Stack align="center" gap={6}>
            <Image src="/logo.png" w={72} h={72} alt="" />
            <Title order={2} ta="center">
              {t("Login.Title")}
            </Title>
            <Text c="dimmed" size="sm" ta="center">
              {t("Login.Subtitle")}
            </Text>
          </Stack>
          <Paper withBorder radius="md" p="xl" w="100%" className={classes.card}>
            <CloudLoginForm />
          </Paper>
          <Box ta="center">
            <Anchor component="button" type="button" size="sm" c="dimmed" onClick={skip}>
              {t("Login.Skip")}
            </Anchor>
            <Text size="xs" c="dimmed" mt={4}>
              {t("Login.SkipHint")}
            </Text>
          </Box>
        </Stack>
      </Center>
    </Modal>
  );
}
