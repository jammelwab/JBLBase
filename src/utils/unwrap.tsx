import { notifications } from "@mantine/notifications";
import { IconX } from "@tabler/icons-react";
import { error } from "@tauri-apps/plugin-log";
import i18n from "i18next";

type Result<T, E> = { status: "ok"; data: T } | { status: "error"; error: E };

export function unwrap<T>(result: Result<T, string>): T {
  if (result.status === "ok") {
    return result.data;
  }
  error(result.error);
  notifications.show({
    title: i18n.t("Common.Error"),
    message: result.error,
    color: "red",
    icon: <IconX />,
  });
  throw new Error(result.error);
}
