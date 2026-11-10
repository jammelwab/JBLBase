import { getVersion } from "@tauri-apps/api/app";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cloudErrorKey, signOutCloud } from "@/utils/cloud/auth";
import {
  forgetPendingConsent,
  hasCurrentConsent,
  pendingConsent,
  saveConsent,
} from "@/utils/cloud/consent";
import { cloudAccountAtom, holdSync } from "@/utils/cloud/sync";
import ConsentModal from "./ConsentModal";

async function appVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "unknown";
  }
}

/**
 * Keeps the sync of a signed-in account on hold until it has agreed to the
 * current terms of use and privacy policy. An agreement given just before
 * (registration, Lichess sign-in) is stored right away; otherwise, e.g. for
 * accounts from before the terms or after a new version, it asks.
 *
 * When the check itself fails (offline, rules not deployed yet), the sync
 * goes on as before rather than locking people out.
 */
export default function ConsentGate() {
  const { t } = useTranslation();
  const account = useAtomValue(cloudAccountAtom);
  const uid = account?.uid ?? null;
  // Confirming the e-mail address opens the cloud (allowlist): check again.
  const verified = account?.emailVerified ?? false;
  const [askUid, setAskUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      if (await hasCurrentConsent(uid)) return true;
      const pending = pendingConsent();
      if (!pending) return false;
      await saveConsent(uid, pending.method, await appVersion());
      forgetPendingConsent();
      return true;
    })()
      .then((ok) => {
        if (cancelled) return;
        if (ok) holdSync(false);
        else {
          setError(null);
          setAskUid(uid);
        }
      })
      .catch((e) => {
        console.error("Consent check failed", e);
        if (!cancelled) holdSync(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, verified]);

  const opened = askUid !== null && askUid === uid;

  return (
    <ConsentModal
      opened={opened}
      method="update"
      busy={busy}
      error={error}
      onCancel={() => {
        setAskUid(null);
        void signOutCloud();
      }}
      onAccept={() => {
        if (!uid) return;
        setBusy(true);
        setError(null);
        appVersion()
          .then((version) => saveConsent(uid, "update", version))
          .then(() => {
            setAskUid(null);
            holdSync(false);
          })
          .catch((e) => setError(t(cloudErrorKey(e))))
          .finally(() => setBusy(false));
      }}
    />
  );
}
