#!/usr/bin/env node
// Puts the engines that ship with JBLBase (Stockfish and Patricia) into
// src-tauri/resources/engines/, from where Tauri bundles them into the
// installer. On first start the app copies them into the engines folder and
// adds them (see install_bundled_engines in src-tauri/src/fs.rs).
//
// Downloads only with JBLBASE_BUNDLE_ENGINES=1 (the build and release
// workflows set it). Without it, local builds simply ship no engines.
//
// Target: ENGINES_TARGET, else AIX_EXTENSION_TARGET, else the host
// (windows_amd64 or osx_arm64; other targets get no engines).

import { execFileSync } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const STOCKFISH_TAG = "sf_19";
const STOCKFISH_VERSION = "19";
const PATRICIA_VERSION = "5.1";

const STOCKFISH_ASSETS = {
  windows_amd64: "stockfish-windows-x86-64-universal.zip",
  osx_arm64: "stockfish-macos-universal.tar.gz",
};
const PATRICIA_ASSETS = {
  windows_amd64: "patricia-windows-x64.exe",
  osx_arm64: "patricia-macos-arm64",
};

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, "src-tauri", "resources", "engines");

const HOST_TARGETS = { "win32:x64": "windows_amd64", "darwin:arm64": "osx_arm64" };

function target() {
  const explicit = process.env.ENGINES_TARGET || process.env.AIX_EXTENSION_TARGET;
  return explicit?.trim() || HOST_TARGETS[`${process.platform}:${process.arch}`] || null;
}

async function download(url, file) {
  const res = await fetch(url, { headers: { "User-Agent": "jblbase-build" } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

function extract(archive, dir) {
  if (!archive.endsWith(".zip")) {
    execFileSync("tar", ["-xzf", archive, "-C", dir]);
  } else if (process.platform === "win32") {
    // Not tar: on the runners it may be GNU tar from Git, which cannot read zip.
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dir}' -Force`,
    ]);
  } else if (process.platform === "darwin") {
    execFileSync("ditto", ["-x", "-k", archive, dir]);
  } else {
    execFileSync("unzip", ["-q", archive, "-d", dir]);
  }
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/** Executable; on macOS also keep only the Apple Silicon part and sign it (ad hoc), as the system requires. */
async function prepareMacBinary(file) {
  // A downloaded file is not executable yet (no effect on Windows).
  await fs.chmod(file, 0o755);
  if (process.platform !== "darwin") return;
  const archs = execFileSync("lipo", ["-archs", file]).toString().trim().split(/\s+/);
  if (archs.length > 1 && archs.includes("arm64")) {
    execFileSync("lipo", ["-thin", "arm64", file, "-output", `${file}.thin`]);
    execFileSync("mv", [`${file}.thin`, file]);
  }
  execFileSync("codesign", ["--force", "--sign", "-", file]);
}

async function stockfish(t, work) {
  const asset = STOCKFISH_ASSETS[t];
  const archive = join(work, asset);
  await download(
    `https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_TAG}/${asset}`,
    archive,
  );
  const unpacked = join(work, "stockfish");
  await fs.mkdir(unpacked, { recursive: true });
  extract(archive, unpacked);
  const files = await walk(unpacked);
  // The engine is the biggest file whose name starts with "stockfish".
  const sized = await Promise.all(
    files
      .filter((f) => /^stockfish/i.test(basename(f)) && !/\.(txt|md|html?)$/i.test(f))
      .map(async (f) => ({ f, size: (await fs.stat(f)).size })),
  );
  sized.sort((a, b) => b.size - a.size);
  if (sized.length === 0) throw new Error(`No Stockfish binary in ${asset}`);
  const id = `stockfish-${STOCKFISH_VERSION}`;
  const dir = join(outDir, id);
  await fs.mkdir(dir, { recursive: true });
  const exe = t.startsWith("windows") ? "stockfish.exe" : "stockfish";
  await fs.copyFile(sized[0].f, join(dir, exe));
  await prepareMacBinary(join(dir, exe));
  // License texts that come with the release (GPL-3.0).
  for (const f of files) {
    if (/^(copying|license|authors)/i.test(basename(f))) {
      await fs.copyFile(f, join(dir, basename(f)));
    }
  }
  await fs.writeFile(
    join(dir, "SOURCE.txt"),
    `Stockfish ${STOCKFISH_VERSION}, unmodified, GNU General Public License v3.\n` +
      `Source code: https://github.com/official-stockfish/Stockfish/tree/${STOCKFISH_TAG}\n`,
  );
  return { id, name: "Stockfish", version: STOCKFISH_VERSION, file: `${id}/${exe}` };
}

/** The license text of a GitHub repository at a tag (MIT asks to ship it). */
async function licenseOf(repo, ref, file) {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]) {
    try {
      await download(`https://raw.githubusercontent.com/${repo}/${ref}/${name}`, file);
      return;
    } catch {}
  }
  throw new Error(`No license file found in ${repo} at ${ref}`);
}

async function patricia(t) {
  const asset = PATRICIA_ASSETS[t];
  const id = `patricia-${PATRICIA_VERSION}`;
  const dir = join(outDir, id);
  await fs.mkdir(dir, { recursive: true });
  await download(
    `https://github.com/jammelwab/JBLBase/releases/download/${id}/${asset}`,
    join(dir, asset),
  );
  await prepareMacBinary(join(dir, asset));
  await licenseOf("Adam-Kulju/Patricia", PATRICIA_VERSION, join(dir, "LICENSE"));
  await fs.writeFile(
    join(dir, "SOURCE.txt"),
    `Patricia ${PATRICIA_VERSION} by Adam Kulju, built unmodified, MIT license.\n` +
      `Source code: https://github.com/Adam-Kulju/Patricia/tree/${PATRICIA_VERSION}\n`,
  );
  return { id, name: "Patricia", version: PATRICIA_VERSION, file: `${id}/${asset}` };
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const manifest = join(outDir, "engines.json");
  if (process.env.JBLBASE_BUNDLE_ENGINES !== "1") {
    console.log("[engines] JBLBASE_BUNDLE_ENGINES is not 1, no engines bundled.");
    return;
  }
  const t = target();
  if (!t || !STOCKFISH_ASSETS[t]) {
    console.log(`[engines] No bundled engines for target ${t ?? "unknown"}.`);
    await fs.writeFile(manifest, "[]\n");
    return;
  }
  // Start clean, so engines of another target or version do not stay behind.
  for (const entry of await fs.readdir(outDir, { withFileTypes: true })) {
    if (entry.isDirectory()) await fs.rm(join(outDir, entry.name), { recursive: true });
  }
  const work = await fs.mkdtemp(join(tmpdir(), "jblbase-engines-"));
  try {
    const engines = [await stockfish(t, work), await patricia(t)];
    await fs.writeFile(manifest, `${JSON.stringify(engines, null, 2)}\n`);
    for (const e of engines) {
      const { size } = await fs.stat(join(outDir, e.file));
      console.log(`[engines] ${e.name} ${e.version}: ${e.file} (${(size / 1e6).toFixed(1)} MB)`);
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`[engines] ${e.message}`);
  process.exit(1);
});
