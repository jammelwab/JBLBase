import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconRefresh, IconSearch, IconUsers } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminListUsers, adminSetPermissions } from "@/utils/cloud/auth";
import {
  type AdminUser,
  accountLevel,
  filterUsers,
  PERMISSIONS,
  type Permission,
  type Perms,
} from "@/utils/cloud/permissions";
import { cloudAccountAtom } from "@/utils/cloud/sync";

const LEVEL_COLOR = { admin: "orange", extended: "grape", user: "blue" } as const;
const LEVEL_LABEL = {
  admin: "Settings.Cloud.RoleAdmin",
  extended: "Settings.Cloud.RoleExtended",
  user: "Settings.Cloud.RoleUser",
} as const;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Admin-Fenster (1.2.31): alle Konten der Cloud, ihre Stufe und einzelne
// Rechte zum Umschalten. Die Liste und das Setzen laufen über die Functions
// adminListUsers und adminSetPermissions, die nur Admins aufrufen dürfen;
// die Sicherheitsregeln prüfen die Rechte im Token jedes Kontos.
export default function AdminUsers() {
  const { t, i18n } = useTranslation();
  const me = useAtomValue(cloudAccountAtom);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirmAdmin, setConfirmAdmin] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await adminListUsers());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (user: AdminUser, admin: boolean, perms: Perms) => {
    const before = users;
    setSaving(user.uid);
    setError(null);
    setUsers((list) => list?.map((u) => (u.uid === user.uid ? { ...u, admin, perms } : u)) ?? null);
    try {
      await adminSetPermissions(user.uid, admin, perms);
    } catch (e) {
      setUsers(before);
      setError(errorText(e));
    } finally {
      setSaving(null);
    }
  };

  const togglePerm = (user: AdminUser, perm: Permission, on: boolean) => {
    const perms: Perms = { ...user.perms };
    if (on) perms[perm] = true;
    else delete perms[perm];
    void save(user, user.admin, perms);
  };

  const shown = useMemo(() => filterUsers(users ?? [], query), [users, query]);
  const date = (s: string | null) =>
    s ? new Date(s).toLocaleDateString(i18n.language, { dateStyle: "medium" }) : "–";

  return (
    <Card withBorder radius="md" p="md" data-admin-users>
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <IconUsers size={24} />
            <Stack gap={0}>
              <Text fw={600}>{t("Settings.Admin.Users")}</Text>
              <Text size="xs" c="dimmed">
                {t("Settings.Admin.UsersDesc")}
              </Text>
            </Stack>
          </Group>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size="0.9rem" />}
            loading={loading}
            onClick={() => void load()}
          >
            {t("Settings.Admin.Reload")}
          </Button>
        </Group>

        <TextInput
          size="xs"
          leftSection={<IconSearch size="0.9rem" />}
          placeholder={t("Settings.Admin.UsersSearch")}
          aria-label={t("Settings.Admin.UsersSearch")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />

        {error && (
          <Alert color="red" title={t("Settings.Admin.UsersError")}>
            {t("Settings.Admin.UsersErrorHint")}
            <Text size="xs" c="dimmed" mt={4}>
              {error}
            </Text>
          </Alert>
        )}

        {users && (
          <Table.ScrollContainer minWidth={820}>
            <Table striped withTableBorder verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("Settings.Admin.UsersAccount")}</Table.Th>
                  <Table.Th>{t("Settings.Admin.UsersLevel")}</Table.Th>
                  <Table.Th>{t("Settings.Admin.UsersLastSeen")}</Table.Th>
                  {PERMISSIONS.map((p) => (
                    <Table.Th key={p} ta="center">
                      <Tooltip
                        label={t(`Settings.Cloud.Perm.${p}.Desc`)}
                        multiline
                        w={240}
                        withArrow
                      >
                        <Text size="xs" fw={600} style={{ cursor: "help" }}>
                          {t(`Settings.Cloud.Perm.${p}`)}
                        </Text>
                      </Tooltip>
                    </Table.Th>
                  ))}
                  <Table.Th ta="center">
                    <Tooltip label={t("Settings.Admin.UsersAdminDesc")} multiline w={240} withArrow>
                      <Text size="xs" fw={600} style={{ cursor: "help" }}>
                        {t("Settings.Cloud.RoleAdmin")}
                      </Text>
                    </Tooltip>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((u) => {
                  const level = accountLevel(u);
                  const self = u.uid === me?.uid;
                  const busy = saving === u.uid;
                  const label = u.name || u.email || u.uid;
                  return (
                    <Table.Tr key={u.uid} data-admin-user={u.uid}>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size="sm" fw={500}>
                            {label}
                            {self && (
                              <Text span size="xs" c="dimmed">
                                {" "}
                                {t("Settings.Admin.UsersYou")}
                              </Text>
                            )}
                          </Text>
                          <Group gap={4}>
                            <Text size="xs" c="dimmed">
                              {u.method === "lichess"
                                ? t("Settings.Admin.UsersViaLichess")
                                : u.name
                                  ? (u.email ?? "")
                                  : ""}
                            </Text>
                            {!u.allowed && !u.admin && (
                              <Badge size="xs" color="gray" variant="light">
                                {t("Settings.Admin.UsersNotListed")}
                              </Badge>
                            )}
                            {u.method === "email" && !u.emailVerified && (
                              <Badge size="xs" color="yellow" variant="light">
                                {t("Settings.Admin.UsersUnverified")}
                              </Badge>
                            )}
                            {u.disabled && (
                              <Badge size="xs" color="red" variant="light">
                                {t("Settings.Admin.UsersDisabled")}
                              </Badge>
                            )}
                          </Group>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color={LEVEL_COLOR[level]}
                          styles={{ root: { overflow: "visible" }, label: { overflow: "visible" } }}
                        >
                          {t(LEVEL_LABEL[level])}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {date(u.lastSignIn)}
                        </Text>
                      </Table.Td>
                      {PERMISSIONS.map((p) => (
                        <Table.Td key={p}>
                          <Group justify="center">
                            <Switch
                              size="sm"
                              color="grape"
                              aria-label={`${t(`Settings.Cloud.Perm.${p}`)}: ${label}`}
                              // Admins haben jedes Recht
                              checked={u.admin || u.perms[p] === true}
                              disabled={u.admin || busy}
                              onChange={(e) => togglePerm(u, p, e.currentTarget.checked)}
                            />
                          </Group>
                        </Table.Td>
                      ))}
                      <Table.Td>
                        <Group justify="center">
                          <Tooltip
                            label={t("Settings.Admin.UsersSelfAdmin")}
                            disabled={!self}
                            withArrow
                          >
                            <span>
                              <Switch
                                size="sm"
                                color="orange"
                                aria-label={`${t("Settings.Cloud.RoleAdmin")}: ${label}`}
                                checked={u.admin}
                                disabled={self || busy}
                                onChange={(e) => {
                                  if (e.currentTarget.checked) setConfirmAdmin(u);
                                  else void save(u, false, u.perms);
                                }}
                              />
                            </span>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {users && shown.length === 0 && (
          <Text size="sm" c="dimmed">
            {t("Settings.Admin.UsersNone")}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          {t("Settings.Admin.UsersHint")}
        </Text>
      </Stack>

      <Modal
        opened={!!confirmAdmin}
        onClose={() => setConfirmAdmin(null)}
        title={t("Settings.Admin.UsersMakeAdmin")}
        centered
      >
        <Stack>
          <Text size="sm">
            {t("Settings.Admin.UsersMakeAdminText", {
              name: confirmAdmin?.name || confirmAdmin?.email || confirmAdmin?.uid,
            })}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmAdmin(null)}>
              {t("Common.Cancel")}
            </Button>
            <Button
              color="orange"
              onClick={() => {
                if (confirmAdmin) void save(confirmAdmin, true, confirmAdmin.perms);
                setConfirmAdmin(null);
              }}
            >
              {t("Settings.Admin.UsersMakeAdmin")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
