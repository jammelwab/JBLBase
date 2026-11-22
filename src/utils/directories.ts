import { appDataDir, documentDir, homeDir, resolve } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { activeProfile } from "./profile";

// Ordner eines anderen Kontos (1.2.13): neben dem bisherigen JBLBase-Ordner,
// nie darin, damit kein Konto die Dateien des anderen sieht.
function profileFolder(): string | null {
    const key = activeProfile();
    if (key === "legacy") return null;
    return key === "guest" ? "Gast" : key.slice(2, 14);
}

function getStoredDirectory(key: string): string | null {
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    try {
        const parsed = JSON.parse(stored);
        return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
    } catch {
        return null;
    }
}

async function ensureDirectory(path: string): Promise<string> {
    if (!(await exists(path))) {
        await mkdir(path, { recursive: true });
    }
    return path;
}

export async function getDatabasesDir(): Promise<string> {
    const customDir = getStoredDirectory("databases-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    const folder = profileFolder();
    if (folder)
        return ensureDirectory(
            await resolve(await appDataDir(), "profiles", activeProfile(), "db"),
        );
    return ensureDirectory(await resolve(await appDataDir(), "db"));
}

export async function getDocumentDir(): Promise<string> {
    const customDir = getStoredDirectory("document-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    const folder = profileFolder();
    const parts = folder ? ["JBLBase Konten", folder] : ["JBLBase"];
    try {
        return ensureDirectory(await resolve(await documentDir(), ...parts));
    } catch {
        return ensureDirectory(await resolve(await homeDir(), ...parts));
    }
}

export async function getEnginesDir(): Promise<string> {
    const customDir = getStoredDirectory("engines-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await resolve(await appDataDir(), "engines"));
}

export async function getPuzzlesDir(): Promise<string> {
    const customDir = getStoredDirectory("puzzles-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await resolve(await appDataDir(), "puzzles"));
}
