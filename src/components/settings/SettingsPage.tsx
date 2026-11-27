import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import {
  IconBook,
  IconBrush,
  IconChess,
  IconChevronRight,
  IconDownload,
  IconFolder,
  IconKeyboard,
  IconMouse,
  IconReload,
  IconSearch,
  IconSchool,
  IconShield,
  IconVolume,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue } from "jotai";
import { RESET } from "jotai/utils";
import { TRASH_RETENTION_CHOICES, trashRetentionDaysAtom } from "@/utils/trash";
import BackupSetting from "./BackupSetting";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  autoPromoteAtom,
  autoSaveAtom,
  defaultPanelTabAtom,
  enableBoardScrollAtom,
  eraseDrawablesOnClickAtom,
  rightClickClearsDrawingsAtom,
  forcedEnPassantAtom,
  materialDisplayAtom,
  moveHighlightAtom,
  moveInputAtom,
  moveMethodAtom,
  moveNotationTypeAtom,
  nativeBarAtom,
  pieceAnimationAtom,
  practiceAdvanceDelayAtom,
  practiceAutoDifficultyAtom,
  previewBoardOnHoverAtom,
  flipBoardAfterMoveAtom,
  showArrowsAtom,
  showConsecutiveArrowsAtom,
  coachCoordinatesAtom,
  showCoordinatesAtom,
  showDestsAtom,
  showVariationArrowsAtom,
  snapArrowsAtom,
  spellCheckAtom,
  usageStatsAtom,
  storedDatabasesDirAtom,
  storedDocumentDirAtom,
  storedEnginesDirAtom,
  storedPuzzlesDirAtom,
} from "@/state/atoms";
import ProfileSettings from "@/components/cloud/ProfileSettings";
import { settingsTabAtom } from "@/components/cloud/cloudUi";
import { normalizeSettingsTab, SETTINGS_NAV } from "./settingsNav";
import { keyMapAtom } from "@/state/keybinds";
import { checkForAppUpdate } from "@/utils/updater";
import FileInput from "../common/FileInput";
import BoardSelect from "./BoardSelect";
import ColorControl from "./ColorControl";
import DimensionToggle from "./DimensionToggle";
import EvalCacheSettings from "./EvalCacheSettings";
import FontSizeSlider from "./FontSizeSlider";
import KeybindInput from "./KeybindInput";
import PiecesSelect from "./PiecesSelect";
import RepertoireMainOwnerSetting from "./RepertoireMainOwnerSetting";
import RepertoireMinGamesSetting from "./RepertoireMinGamesSetting";
import TutorialSettings from "./TutorialSettings";
import AdminOverview from "./AdminOverview";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import classes from "./SettingsPage.module.css";
import { LegalLinks } from "@/components/cloud/LegalText";
import { usageStatsConfigured } from "@/utils/usageStats";
import { LANGUAGE_NAMES, LANGUAGES, markLanguageChosen } from "@/utils/language";
import SettingsSwitch from "./SettingsSwitch";
import { coachSoundAtom } from "@/components/coach/coachSound";
import SoundSelect from "./SoundSelect";
import ThemeButton from "./ThemeButton";
import VolumeSlider from "./VolumeSlider";
import type { PracticeAutoDifficulty } from "@/utils/practiceGrade";

type SettingCategory =
  | "board"
  | "inputs"
  | "appearance"
  | "sound"
  | "keybinds"
  | "directories"
  | "repertoire"
  | "tutorials"
  | "privacy";

type SettingSection =
  | "display"
  | "arrows"
  | "behavior"
  | "typing"
  | "fun"
  | "app"
  | "pieces"
  | "training"
  | "backup";

interface SettingItem {
  id: string;
  category: SettingCategory;
  /** Heading the setting is listed under inside its tab. */
  section?: SettingSection;
  /** Rarely changed: tucked away under "More settings" until opened. */
  advanced?: boolean;
  title: string;
  description: string;
  keywords?: string[];
  render: () => React.ReactNode;
}

function SettingRow({
  title,
  description,
  children,
  highlight,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      gap="xl"
      className={classes.item}
      style={highlight ? { backgroundColor: "var(--mantine-color-yellow-light)" } : undefined}
    >
      <div>
        <Text>{title}</Text>
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      </div>
      {children}
    </Group>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className={classes.section} size="xs" fw={700} tt="uppercase">
      {children}
    </Text>
  );
}

function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={classes.header}>
      <Group gap="xs">
        <Text size="lg" fw={600} className={classes.title}>
          {title}
        </Text>
        {action}
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        {description}
      </Text>
    </div>
  );
}

export default function Page() {
  const { t, i18n } = useTranslation();
  // The admin overview (#116) exists only for admin accounts
  const isAdmin = useAtomValue(cloudAccountAtom)?.role === "admin";
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [rawSettingsTab, setSettingsTab] = useAtom(settingsTabAtom);
  const settingsTab = normalizeSettingsTab(rawSettingsTab);
  const [openAdvanced, setOpenAdvanced] = useState<SettingCategory[]>([]);
  const [keyMap, setKeyMap] = useAtom(keyMapAtom);
  const [isNative, setIsNative] = useAtom(nativeBarAtom);
  const {
    dirs: {
      documentDir,
      databasesDir: defaultDatabasesDir,
      enginesDir: defaultEnginesDir,
      puzzlesDir: defaultPuzzlesDir,
    },
    version,
  } = useLoaderData({ from: "/settings" });
  let [filesDirectory, setFilesDirectory] = useAtom(storedDocumentDirAtom);
  filesDirectory = filesDirectory || documentDir;
  let [databasesDirectory, setDatabasesDirectory] = useAtom(storedDatabasesDirAtom);
  databasesDirectory = databasesDirectory || defaultDatabasesDir;
  let [enginesDirectory, setEnginesDirectory] = useAtom(storedEnginesDirAtom);
  enginesDirectory = enginesDirectory || defaultEnginesDir;
  let [puzzlesDirectory, setPuzzlesDirectory] = useAtom(storedPuzzlesDirAtom);
  puzzlesDirectory = puzzlesDirectory || defaultPuzzlesDir;

  const [moveMethod, setMoveMethod] = useAtom(moveMethodAtom);
  const [pieceAnimation, setPieceAnimation] = useAtom(pieceAnimationAtom);
  const [moveNotationType, setMoveNotationType] = useAtom(moveNotationTypeAtom);
  const [showCoordinates, setShowCoordinates] = useAtom(showCoordinatesAtom);
  const [coachCoordinates, setCoachCoordinates] = useAtom(coachCoordinatesAtom);
  const [materialDisplay, setMaterialDisplay] = useAtom(materialDisplayAtom);
  const [defaultPanelTab, setDefaultPanelTab] = useAtom(defaultPanelTabAtom);
  const [practiceAutoDifficulty, setPracticeAutoDifficulty] = useAtom(practiceAutoDifficultyAtom);
  const [practiceAdvanceDelay, setPracticeAdvanceDelay] = useAtom(practiceAdvanceDelayAtom);
  const [trashRetentionDays, setTrashRetentionDays] = useAtom(trashRetentionDaysAtom);

  const settings: SettingItem[] = useMemo(
    () => [
      // Board settings
      {
        id: "piece-dest",
        category: "board",
        section: "display" as SettingSection,
        title: t("Settings.PieceDest"),
        description: t("Settings.PieceDest.Desc"),
        keywords: ["destination", "moves", "highlight"],
        render: () => <SettingsSwitch atom={showDestsAtom} />,
      },
      {
        id: "move-highlight",
        category: "board",
        section: "display" as SettingSection,
        title: t("Settings.MoveHighlight"),
        description: t("Settings.MoveHighlight.Desc"),
        keywords: ["highlight", "last move"],
        render: () => <SettingsSwitch atom={moveHighlightAtom} />,
      },
      {
        id: "arrows",
        category: "board",
        section: "arrows" as SettingSection,
        title: t("Settings.Arrows"),
        description: t("Settings.Arrows.Desc"),
        keywords: ["arrows", "analysis"],
        render: () => <SettingsSwitch atom={showArrowsAtom} />,
      },
      {
        id: "variation-arrows",
        category: "board",
        section: "arrows" as SettingSection,
        title: t("Settings.VariationArrows"),
        description: t("Settings.VariationArrows.Desc"),
        keywords: ["arrows", "variations", "alternative"],
        render: () => <SettingsSwitch atom={showVariationArrowsAtom} />,
      },
      {
        id: "move-notation",
        category: "board",
        section: "display" as SettingSection,
        title: t("Settings.MoveNotation"),
        description: t("Settings.MoveNotation.Desc"),
        keywords: ["notation", "letters", "symbols", "pieces"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.MoveNotation.Letters"), value: "letters" },
              { label: t("Settings.MoveNotation.Symbols"), value: "symbols" },
              { label: "LAN (Large Algebraic Notation)", value: "lan" },
            ]}
            allowDeselect={false}
            value={moveNotationType}
            onChange={(val) => setMoveNotationType(val as "letters" | "symbols" | "lan")}
          />
        ),
      },
      {
        id: "move-method",
        category: "board",
        section: "behavior" as SettingSection,
        title: t("Settings.MoveMethod"),
        description: t("Settings.MoveMethod.Desc"),
        keywords: ["drag", "click", "move", "pieces"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.MoveMethod.Drag"), value: "drag" },
              { label: t("Settings.MoveMethod.Click"), value: "select" },
              { label: t("Settings.MoveMethod.Both"), value: "both" },
            ]}
            allowDeselect={false}
            value={moveMethod}
            onChange={(val) => setMoveMethod(val as "drag" | "select" | "both")}
          />
        ),
      },
      {
        id: "piece-animation",
        category: "board",
        section: "display" as SettingSection,
        advanced: true,
        title: t("Settings.PieceAnimation"),
        description: t("Settings.PieceAnimation.Desc"),
        keywords: ["animation", "speed", "pieces", "move", "fast", "slow"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.PieceAnimation.None"), value: "none" },
              { label: t("Settings.PieceAnimation.Fast"), value: "fast" },
              { label: t("Settings.PieceAnimation.Normal"), value: "normal" },
              { label: t("Settings.PieceAnimation.Slow"), value: "slow" },
            ]}
            allowDeselect={false}
            value={pieceAnimation}
            onChange={(val) => setPieceAnimation(val as "none" | "fast" | "normal" | "slow")}
          />
        ),
      },
      {
        id: "snap-arrows",
        category: "board",
        section: "arrows" as SettingSection,
        advanced: true,
        title: t("Settings.SnapArrows"),
        description: t("Settings.SnapArrows.Desc"),
        keywords: ["arrows", "snap"],
        render: () => <SettingsSwitch atom={snapArrowsAtom} />,
      },
      {
        id: "consecutive-arrows",
        category: "board",
        section: "arrows" as SettingSection,
        advanced: true,
        title: t("Settings.ConsecutiveArrows"),
        description: t("Settings.ConsecutiveArrows.Desc"),
        keywords: ["arrows", "consecutive"],
        render: () => <SettingsSwitch atom={showConsecutiveArrowsAtom} />,
      },
      {
        id: "erase-drawables",
        category: "board",
        section: "arrows" as SettingSection,
        advanced: true,
        title: t("Settings.EraseDrawablesOnClick"),
        description: t("Settings.EraseDrawablesOnClick.Desc"),
        keywords: ["erase", "drawables", "click", "arrows"],
        render: () => <SettingsSwitch atom={eraseDrawablesOnClickAtom} />,
      },
      {
        id: "right-click-clears-drawings",
        category: "board",
        section: "arrows" as SettingSection,
        title: t("Settings.RightClickClearsDrawings"),
        description: t("Settings.RightClickClearsDrawings.Desc"),
        keywords: [
          "erase",
          "drawables",
          "right click",
          "arrows",
          "circles",
          "rechtsklick",
          "pfeile",
        ],
        render: () => <SettingsSwitch atom={rightClickClearsDrawingsAtom} />,
      },
      {
        id: "auto-promote",
        category: "board",
        section: "behavior" as SettingSection,
        title: t("Settings.AutoPromotion"),
        description: t("Settings.AutoPromotion.Desc"),
        keywords: ["promote", "queen", "pawn"],
        render: () => <SettingsSwitch atom={autoPromoteAtom} />,
      },
      {
        id: "coordinates",
        category: "board",
        section: "display" as SettingSection,
        title: t("Settings.Coordinates"),
        description: t("Settings.Coordinates.Desc"),
        keywords: ["coordinates", "a-h", "1-8"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.Coordinates.None"), value: "no" },
              { label: t("Settings.Coordinates.Edge"), value: "edge" },
              { label: t("Settings.Coordinates.All"), value: "all" },
            ]}
            allowDeselect={false}
            value={showCoordinates}
            onChange={(val) => setShowCoordinates(val as "no" | "edge" | "all")}
          />
        ),
      },
      {
        id: "coach-coordinates",
        category: "board",
        section: "display" as SettingSection,
        title: t("Settings.CoachCoordinates"),
        description: t("Settings.CoachCoordinates.Desc"),
        keywords: ["coordinates", "a-h", "1-8", "coach"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.Coordinates.None"), value: "no" },
              { label: t("Settings.Coordinates.Edge"), value: "edge" },
              { label: t("Settings.Coordinates.All"), value: "all" },
            ]}
            allowDeselect={false}
            value={coachCoordinates}
            onChange={(val) => setCoachCoordinates(val as "no" | "edge" | "all")}
          />
        ),
      },
      {
        id: "auto-save",
        category: "board",
        section: "behavior" as SettingSection,
        title: t("Settings.AutoSave"),
        description: t("Settings.AutoSave.Desc"),
        keywords: ["save", "auto"],
        render: () => <SettingsSwitch atom={autoSaveAtom} />,
      },
      {
        id: "preview-board",
        category: "board",
        section: "behavior" as SettingSection,
        title: t("Settings.PreviewBoard"),
        description: t("Settings.PreviewBoard.Desc"),
        keywords: ["preview", "hover"],
        render: () => <SettingsSwitch atom={previewBoardOnHoverAtom} />,
      },
      {
        id: "flip-board-after-move",
        category: "board",
        section: "behavior" as SettingSection,
        title: t("Settings.FlipBoardAfterMove"),
        description: t("Settings.FlipBoardAfterMove.Desc"),
        keywords: ["flip", "board", "move"],
        render: () => <SettingsSwitch atom={flipBoardAfterMoveAtom} />,
      },
      {
        id: "scroll-moves",
        category: "board",
        section: "behavior" as SettingSection,
        advanced: true,
        title: t("Settings.ScrollThroughMoves"),
        description: t("Settings.ScrollThroughMoves.Desc"),
        keywords: ["scroll", "moves", "wheel"],
        render: () => <SettingsSwitch atom={enableBoardScrollAtom} />,
      },
      {
        id: "material-display",
        category: "board",
        section: "display" as SettingSection,
        title: t("Settings.MaterialDisplay"),
        description: t("Settings.MaterialDisplay.Desc"),
        keywords: ["material", "captured", "pieces", "difference"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.MaterialDisplay.Diff"), value: "diff" },
              { label: t("Settings.MaterialDisplay.All"), value: "all" },
              { label: t("Settings.MaterialDisplay.None"), value: "none" },
            ]}
            allowDeselect={false}
            value={materialDisplay}
            onChange={(val) => setMaterialDisplay(val as "diff" | "all" | "none")}
          />
        ),
      },
      {
        id: "default-panel-tab",
        category: "board",
        section: "behavior" as SettingSection,
        advanced: true,
        title: t("Settings.DefaultPanelTab"),
        description: t("Settings.DefaultPanelTab.Desc"),
        keywords: ["default", "panel", "tab", "open", "analysis", "database", "annotate", "info"],
        render: () => (
          <Select
            data={[
              { label: t("Board.Tabs.Analysis"), value: "analysis" },
              { label: t("Board.Tabs.Database"), value: "database" },
              { label: t("Board.Tabs.Annotate"), value: "annotate" },
              { label: t("Board.Tabs.Info"), value: "info" },
            ]}
            allowDeselect={false}
            value={defaultPanelTab}
            onChange={(val) =>
              setDefaultPanelTab(val as "analysis" | "database" | "annotate" | "info")
            }
          />
        ),
      },
      // Input settings
      {
        id: "text-input",
        category: "inputs",
        section: "typing" as SettingSection,
        title: t("Settings.Inputs.TextInput"),
        description: t("Settings.Inputs.TextInput.Desc"),
        keywords: ["text", "input", "type"],
        render: () => <SettingsSwitch atom={moveInputAtom} />,
      },
      {
        id: "spell-check",
        category: "inputs",
        section: "typing" as SettingSection,
        title: t("Settings.Inputs.SpellCheck"),
        description: t("Settings.Inputs.SpellCheck.Desc"),
        keywords: ["spell", "check", "grammar"],
        render: () => <SettingsSwitch atom={spellCheckAtom} />,
      },
      // Anarchy settings
      {
        id: "forced-en-passant",
        category: "inputs",
        section: "fun" as SettingSection,
        advanced: true,
        title: t("Settings.Anarchy.ForcedEnCroissant"),
        description: t("Settings.Anarchy.ForcedEnCroissant.Desc"),
        keywords: ["en passant", "forced", "croissant"],
        render: () => <SettingsSwitch atom={forcedEnPassantAtom} />,
      },
      // Appearance settings
      {
        id: "theme",
        category: "appearance",
        section: "app" as SettingSection,
        title: t("Settings.Appearance.Theme"),
        description: t("Settings.Appearance.Theme.Desc"),
        keywords: ["theme", "dark", "light", "color"],
        render: () => <ThemeButton />,
      },
      {
        id: "language",
        category: "appearance",
        section: "app" as SettingSection,
        title: t("Settings.Appearance.Language"),
        description: t("Settings.Appearance.Language.Desc"),
        keywords: ["language", "locale", "translation"],
        render: () => (
          <Select
            allowDeselect={false}
            data={LANGUAGES.map((lng) => ({ value: lng, label: LANGUAGE_NAMES[lng] })).sort(
              (a, b) => a.label.localeCompare(b.label),
            )}
            value={i18n.resolvedLanguage ?? i18n.language}
            onChange={(val) => {
              void i18n.changeLanguage(val || "en-US");
              markLanguageChosen();
            }}
          />
        ),
      },
      ...(import.meta.env.VITE_PLATFORM === "win32" || import.meta.env.VITE_PLATFORM === "linux"
        ? [
            {
              id: "title-bar",
              category: "appearance" as SettingCategory,
              section: "app" as SettingSection,
              advanced: true,
              title: t("Settings.Appearance.TitleBar"),
              description: t("Settings.Appearance.TitleBar.Desc"),
              keywords: ["title", "bar", "native", "custom"],
              render: () => (
                <Select
                  allowDeselect={false}
                  data={[
                    {
                      value: "Native",
                      label: t("Settings.Appearance.TitleBar.Native"),
                    },
                    {
                      value: "Custom",
                      label: t("Settings.Appearance.TitleBar.Custom"),
                    },
                  ]}
                  value={isNative ? "Native" : "Custom"}
                  onChange={(val) => setIsNative(val === "Native")}
                />
              ),
            },
          ]
        : []),
      {
        id: "font-size",
        category: "appearance",
        section: "app" as SettingSection,
        title: t("Settings.Appearance.FontSize"),
        description: t("Settings.Appearance.FontSize.Desc"),
        keywords: ["font", "size", "text"],
        render: () => <FontSizeSlider />,
      },
      {
        id: "piece-set",
        category: "appearance",
        section: "pieces" as SettingSection,
        title: t("Settings.Appearance.PieceSet"),
        description: t("Settings.Appearance.PieceSet.Desc"),
        keywords: ["piece", "set", "style"],
        render: () => <PiecesSelect />,
      },
      {
        id: "board-image",
        category: "appearance",
        section: "pieces" as SettingSection,
        title: t("Settings.Appearance.BoardImage"),
        description: t("Settings.Appearance.BoardImage.Desc"),
        keywords: ["board", "image", "texture"],
        render: () => <BoardSelect />,
      },
      {
        id: "3d-mode",
        category: "appearance",
        section: "pieces" as SettingSection,
        advanced: true,
        title: t("Settings.Appearance.3DMode"),
        description: t("Settings.Appearance.3DMode.Desc"),
        keywords: ["3d", "3d mode", "dimension"],
        render: () => <DimensionToggle />,
      },
      {
        id: "accent-color",
        category: "appearance",
        section: "app" as SettingSection,
        title: t("Settings.Appearance.AccentColor"),
        description: t("Settings.Appearance.AccentColor.Desc"),
        keywords: ["accent", "color", "primary"],
        render: () => (
          <div style={{ width: 200 }}>
            <ColorControl />
          </div>
        ),
      },
      // Repertoire settings
      {
        id: "repertoire-main-owner",
        category: "repertoire",
        section: "training" as SettingSection,
        title: t("Settings.Repertoire.MainOwner"),
        description: t("Settings.Repertoire.MainOwner.Desc"),
        keywords: ["repertoire", "name", "owner", "player"],
        render: () => <RepertoireMainOwnerSetting />,
      },
      {
        id: "repertoire-depth",
        category: "repertoire",
        section: "training" as SettingSection,
        title: t("Settings.Repertoire.Depth"),
        description: t("Settings.Repertoire.Depth.Desc"),
        keywords: ["repertoire", "depth", "games", "min"],
        render: () => <RepertoireMinGamesSetting />,
      },
      {
        id: "repertoire-auto-difficulty",
        category: "repertoire",
        section: "training" as SettingSection,
        title: t("Settings.Repertoire.AutoDifficulty"),
        description: t("Settings.Repertoire.AutoDifficulty.Desc"),
        keywords: ["repertoire", "auto", "difficulty", "select", "anki"],
        render: () => (
          <Select
            allowDeselect={false}
            data={[
              { label: t("Settings.Repertoire.AutoDifficulty.Time"), value: "time" },
              { label: t("Settings.Repertoire.AutoDifficulty.None"), value: "none" },
              { label: t("Board.Practice.Again"), value: "1" },
              { label: t("Board.Practice.Hard"), value: "2" },
              { label: t("Board.Practice.Good"), value: "3" },
              { label: t("Board.Practice.Easy"), value: "4" },
            ]}
            value={practiceAutoDifficulty}
            onChange={(val) => setPracticeAutoDifficulty(val as PracticeAutoDifficulty)}
          />
        ),
      },
      {
        id: "repertoire-advance-delay",
        category: "repertoire",
        section: "training" as SettingSection,
        title: t("Settings.Repertoire.AdvanceDelay"),
        description: t("Settings.Repertoire.AdvanceDelay.Desc"),
        keywords: ["repertoire", "pause", "delay", "weiter", "zeit", "anki"],
        render: () => (
          <Select
            allowDeselect={false}
            data={[1000, 1500, 2000, 3000, 4000, 5000].map((ms) => ({
              label: t("Settings.Repertoire.AdvanceDelay.Seconds", {
                seconds: (ms / 1000).toLocaleString(),
              }),
              value: String(ms),
            }))}
            value={String(practiceAdvanceDelay)}
            onChange={(val) => setPracticeAdvanceDelay(Number(val))}
          />
        ),
      },
      {
        id: "repertoire-backup",
        category: "repertoire",
        section: "backup" as SettingSection,
        title: t("Settings.Backup"),
        description: t("Settings.Backup.Desc"),
        keywords: ["backup", "sicherung", "restore", "zip", "repertoire"],
        render: () => <BackupSetting />,
      },
      {
        id: "repertoire-trash",
        category: "repertoire",
        section: "backup" as SettingSection,
        advanced: true,
        title: t("Settings.Repertoire.Trash"),
        description: t("Settings.Repertoire.Trash.Desc"),
        keywords: ["repertoire", "trash", "delete", "restore", "papierkorb"],
        render: () => (
          <Select
            allowDeselect={false}
            data={TRASH_RETENTION_CHOICES.map((days) => ({
              value: String(days),
              label:
                days === 0
                  ? t("Settings.Repertoire.Trash.Forever")
                  : t("Settings.Repertoire.Trash.Days", { count: days }),
            }))}
            value={String(trashRetentionDays)}
            onChange={(val) => setTrashRetentionDays(Number(val))}
          />
        ),
      },
      {
        id: "tutorials",
        category: "tutorials",
        title: t("Settings.Tutorials"),
        description: t("Settings.Tutorials.Desc"),
        keywords: ["tutorial", "hilfe", "help", "anleitung", "einführung"],
        render: () => <TutorialSettings />,
      },
      // Sound settings
      {
        id: "volume",
        category: "sound",
        title: t("Settings.Sound.Volume"),
        description: t("Settings.Sound.Volume.Desc"),
        keywords: ["volume", "audio", "loud"],
        render: () => <VolumeSlider />,
      },
      {
        id: "sound-collection",
        category: "sound",
        title: t("Settings.Sound.Collection"),
        description: t("Settings.Sound.Collection.Desc"),
        keywords: ["sound", "collection", "audio", "effects"],
        render: () => <SoundSelect />,
      },
      {
        id: "coach-sound",
        category: "sound",
        title: t("Settings.Sound.Coach"),
        description: t("Settings.Sound.Coach.Desc"),
        keywords: ["coach", "jbl", "ton", "sound", "musik"],
        render: () => <SettingsSwitch atom={coachSoundAtom} />,
      },
      // Directories settings
      {
        id: "files-directory",
        category: "directories",
        title: t("Settings.Directories.Files"),
        description: t("Settings.Directories.Files.Desc"),
        keywords: ["files", "directory", "folder", "path"],
        render: () => (
          <FileInput
            onClick={async () => {
              const selected = await open({
                multiple: false,
                directory: true,
              });
              if (!selected || typeof selected !== "string") return;
              setFilesDirectory(selected);
            }}
            filename={filesDirectory || null}
          />
        ),
      },
      {
        id: "databases-directory",
        category: "directories",
        title: t("Settings.Directories.Databases"),
        description: t("Settings.Directories.Databases.Desc"),
        keywords: ["databases", "directory", "folder", "path"],
        render: () => (
          <FileInput
            onClick={async () => {
              const selected = await open({
                multiple: false,
                directory: true,
              });
              if (!selected || typeof selected !== "string") return;
              setDatabasesDirectory(selected);
            }}
            filename={databasesDirectory || null}
          />
        ),
      },
      {
        id: "engines-directory",
        category: "directories",
        title: t("Settings.Directories.Engines"),
        description: t("Settings.Directories.Engines.Desc"),
        keywords: ["engines", "directory", "folder", "path"],
        render: () => (
          <FileInput
            onClick={async () => {
              const selected = await open({
                multiple: false,
                directory: true,
              });
              if (!selected || typeof selected !== "string") return;
              setEnginesDirectory(selected);
            }}
            filename={enginesDirectory || null}
          />
        ),
      },
      {
        id: "puzzles-directory",
        category: "directories",
        title: t("Settings.Directories.Puzzles"),
        description: t("Settings.Directories.Puzzles.Desc"),
        keywords: ["puzzles", "directory", "folder", "path"],
        render: () => (
          <FileInput
            onClick={async () => {
              const selected = await open({
                multiple: false,
                directory: true,
              });
              if (!selected || typeof selected !== "string") return;
              setPuzzlesDirectory(selected);
            }}
            filename={puzzlesDirectory || null}
          />
        ),
      },
      // Privacy settings
      {
        id: "legal",
        category: "privacy",
        title: t("Settings.Privacy.Legal"),
        description: t("Settings.Privacy.Legal.Desc"),
        keywords: ["privacy", "datenschutz", "terms", "nutzungsbedingungen", "gdpr", "dsgvo"],
        render: () => <LegalLinks />,
      },
      ...(usageStatsConfigured()
        ? [
            {
              id: "usage-stats",
              category: "privacy" as SettingCategory,
              title: t("Settings.Privacy.UsageStats"),
              description: t("Settings.Privacy.UsageStats.Desc"),
              keywords: ["statistics", "statistik", "analytics", "usage", "nutzung", "tracking"],
              render: () => <SettingsSwitch atom={usageStatsAtom} />,
            },
          ]
        : []),
    ],
    [
      t,
      i18n,
      moveNotationType,
      moveMethod,
      pieceAnimation,
      setPieceAnimation,
      isNative,
      showCoordinates,
      coachCoordinates,
      materialDisplay,
      filesDirectory,
      databasesDirectory,
      enginesDirectory,
      puzzlesDirectory,
      setMoveNotationType,
      setMoveMethod,
      setIsNative,
      setFilesDirectory,
      setDatabasesDirectory,
      setEnginesDirectory,
      setPuzzlesDirectory,
      setShowCoordinates,
      setCoachCoordinates,
      setMaterialDisplay,
      defaultPanelTab,
      setDefaultPanelTab,
      practiceAutoDifficulty,
      setPracticeAutoDifficulty,
      practiceAdvanceDelay,
      setPracticeAdvanceDelay,
      trashRetentionDays,
      setTrashRetentionDays,
    ],
  );

  useHotkeys([["mod+f", () => searchInputRef.current?.focus()]]);

  const categoryInfo: Record<
    SettingCategory,
    { title: string; description: string; icon: React.ReactNode }
  > = useMemo(
    () => ({
      board: {
        title: t("Settings.Board"),
        description: t("Settings.Board.Desc"),
        icon: <IconChess size="1rem" />,
      },
      inputs: {
        title: t("Settings.Inputs"),
        description: t("Settings.Inputs.Desc"),
        icon: <IconMouse size="1rem" />,
      },
      appearance: {
        title: t("Settings.Appearance"),
        description: t("Settings.Appearance.Desc"),
        icon: <IconBrush size="1rem" />,
      },
      sound: {
        title: t("Settings.Sound"),
        description: t("Settings.Sound.Desc"),
        icon: <IconVolume size="1rem" />,
      },
      keybinds: {
        title: t("Settings.Keybinds"),
        description: t("Settings.Keybinds.Desc"),
        icon: <IconKeyboard size="1rem" />,
      },
      directories: {
        title: t("Settings.Directories"),
        description: t("Settings.Directories.Desc"),
        icon: <IconFolder size="1rem" />,
      },
      repertoire: {
        title: t("Settings.Repertoire"),
        description: t("Settings.Repertoire.Desc"),
        icon: <IconBook size="1rem" />,
      },
      tutorials: {
        title: t("Settings.Tutorials"),
        description: t("Settings.Tutorials.Desc"),
        icon: <IconSchool size="1rem" />,
      },
      privacy: {
        title: t("Settings.Privacy"),
        description: t("Settings.Privacy.Desc"),
        icon: <IconShield size="1rem" />,
      },
    }),
    [t],
  );

  const sectionTitles: Record<SettingSection, string> = {
    display: t("Settings.Section.Display"),
    arrows: t("Settings.Section.Arrows"),
    behavior: t("Settings.Section.Behavior"),
    typing: t("Settings.Section.Typing"),
    fun: t("Settings.Anarchy"),
    app: t("Settings.Section.App"),
    pieces: t("Settings.Section.Pieces"),
    training: t("Settings.Section.Training"),
    backup: t("Settings.Section.Backup"),
  };

  const filteredSettings = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase();
    return settings.filter(
      (setting) =>
        setting.title.toLowerCase().includes(query) ||
        setting.description.toLowerCase().includes(query) ||
        categoryInfo[setting.category].title.toLowerCase().includes(query) ||
        setting.id.toLowerCase().includes(query) ||
        setting.keywords?.some((kw) => kw.toLowerCase().includes(query)),
    );
  }, [searchQuery, settings, categoryInfo]);

  const renderSearchResults = () => {
    if (!filteredSettings) return null;

    if (filteredSettings.length === 0) {
      return (
        <Card withBorder p="lg" className={classes.card} w="100%">
          <Text c="dimmed" ta="center">
            No settings found for "{searchQuery}"
          </Text>
        </Card>
      );
    }

    // Group filtered settings by category
    const groupedSettings = filteredSettings.reduce(
      (acc, setting) => {
        if (!acc[setting.category]) {
          acc[setting.category] = [];
        }
        acc[setting.category].push(setting);
        return acc;
      },
      {} as Record<SettingCategory, SettingItem[]>,
    );

    return (
      <Card withBorder p="lg" className={classes.card} w="100%" maw={900}>
        {Object.entries(groupedSettings).map(([category, categorySettings]) => (
          <div key={category}>
            <Group gap="xs" mt="md" mb="xs">
              {categoryInfo[category as SettingCategory].icon}
              <Text fw={500} size="sm" c="dimmed">
                {categoryInfo[category as SettingCategory].title}
              </Text>
            </Group>
            {categorySettings.map((setting) => (
              <SettingRow key={setting.id} title={setting.title} description={setting.description}>
                {setting.render()}
              </SettingRow>
            ))}
          </div>
        ))}
      </Card>
    );
  };

  const renderRows = (items: SettingItem[]) =>
    items.map((setting) => (
      <SettingRow key={setting.id} title={setting.title} description={setting.description}>
        {setting.render()}
      </SettingRow>
    ));

  const renderSections = (items: SettingItem[]) => {
    const order: (SettingSection | undefined)[] = [];
    for (const item of items) if (!order.includes(item.section)) order.push(item.section);
    return order.map((section) => (
      <div key={section ?? "none"} className={classes.group}>
        {section && order.length > 1 && <SectionTitle>{sectionTitles[section]}</SectionTitle>}
        {renderRows(items.filter((item) => item.section === section))}
      </div>
    ));
  };

  const renderCategorySettings = (category: SettingCategory) => {
    const categorySettings = settings.filter((s) => s.category === category);
    const basic = categorySettings.filter((s) => !s.advanced);
    const advanced = categorySettings.filter((s) => s.advanced);
    const isOpen = openAdvanced.includes(category);
    return (
      <>
        {renderSections(basic)}
        {advanced.length > 0 && (
          <div className={classes.more}>
            <UnstyledButton
              className={classes.moreButton}
              onClick={() =>
                setOpenAdvanced((prev) =>
                  isOpen ? prev.filter((c) => c !== category) : [...prev, category],
                )
              }
            >
              <Group gap={6}>
                <IconChevronRight
                  size="0.9rem"
                  className={classes.chevron}
                  data-open={isOpen || undefined}
                />
                <Text size="sm" fw={500}>
                  {isOpen ? t("Settings.LessSettings") : t("Settings.MoreSettings")}
                </Text>
                <Badge size="xs" variant="light" color="gray">
                  {advanced.length}
                </Badge>
              </Group>
            </UnstyledButton>
            <Collapse expanded={isOpen}>{renderSections(advanced)}</Collapse>
          </div>
        )}
      </>
    );
  };

  return (
    <Stack h="100%" gap={0}>
      <Group px="md" pt="md" pb="sm">
        <TextInput
          ref={searchInputRef}
          placeholder={t("Common.Search")}
          leftSection={<IconSearch size="1rem" />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
            }
            if (e.key === "Escape") {
              setSearchQuery("");
              searchInputRef.current?.blur();
            }
          }}
          style={{ flex: 1, maxWidth: 400 }}
        />
      </Group>
      {filteredSettings ? (
        <ScrollArea flex={1} px="md">
          {renderSearchResults()}
          <Text size="xs" c="dimmed" ta="right" py="md">
            JBLBase v{version}
          </Text>
        </ScrollArea>
      ) : (
        <Tabs
          value={settingsTab}
          onChange={(v) => v && setSettingsTab(v)}
          orientation="vertical"
          flex={1}
          style={{ overflow: "hidden" }}
          styles={{
            tabLabel: {
              textAlign: "left",
            },
          }}
        >
          <Tabs.List h="100%" data-tour="set-tabs" className={classes.nav}>
            {SETTINGS_NAV.map((group) => {
              const tabs = group.tabs.filter((tab) => !tab.adminOnly || isAdmin);
              if (tabs.length === 0) return null;
              return (
                <div key={group.label} className={classes.navGroup}>
                  <Text className={classes.navLabel} size="xs" fw={700} tt="uppercase">
                    {t(group.label)}
                  </Text>
                  {tabs.map(({ value, label, icon: Icon }) => (
                    <Tabs.Tab
                      key={value}
                      value={value}
                      leftSection={<Icon size="1rem" />}
                      data-tour={value === "evalcache" ? "set-tab-evalcache" : undefined}
                    >
                      {t(label)}
                    </Tabs.Tab>
                  ))}
                </div>
              );
            })}
          </Tabs.List>
          <Stack flex={1} px="md">
            <ScrollArea>
              <Card withBorder p="lg" className={classes.card} w="100%" maw={900}>
                <Tabs.Panel value="profile">
                  <PanelHeader title={t("Settings.Cloud")} description={t("Settings.Cloud.Desc")} />
                  <ProfileSettings />
                </Tabs.Panel>

                <Tabs.Panel value="board">
                  <PanelHeader title={t("Settings.Board")} description={t("Settings.Board.Desc")} />
                  {renderCategorySettings("board")}
                </Tabs.Panel>

                <Tabs.Panel value="inputs">
                  <PanelHeader
                    title={t("Settings.Inputs")}
                    description={t("Settings.Inputs.Desc")}
                  />
                  {renderCategorySettings("inputs")}
                </Tabs.Panel>

                <Tabs.Panel value="appearance">
                  <PanelHeader
                    title={t("Settings.Appearance")}
                    description={t("Settings.Appearance.Desc")}
                  />
                  {renderCategorySettings("appearance")}
                </Tabs.Panel>

                <Tabs.Panel value="sound">
                  <PanelHeader title={t("Settings.Sound")} description={t("Settings.Sound.Desc")} />
                  {renderCategorySettings("sound")}
                </Tabs.Panel>

                <Tabs.Panel value="keybinds">
                  <PanelHeader
                    title={t("Settings.Keybinds")}
                    description={t("Settings.Keybinds.Desc")}
                    action={
                      <Tooltip label={t("Common.Reset")}>
                        <ActionIcon onClick={() => setKeyMap(RESET)}>
                          <IconReload size="1rem" />
                        </ActionIcon>
                      </Tooltip>
                    }
                  />
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t("Common.Description")}</Table.Th>
                        <Table.Th>{t("Settings.Key")}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {Object.entries(keyMap).map(([action, keybind]) => {
                        return (
                          <Table.Tr key={action}>
                            <Table.Td>
                              {t(`Settings.Keybinds.Actions.${action}`, {
                                defaultValue: keybind.name,
                              })}
                            </Table.Td>
                            <Table.Td>
                              <KeybindInput action={action} keybind={keybind} />
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Tabs.Panel>

                <Tabs.Panel value="directories">
                  <PanelHeader
                    title={t("Settings.Directories")}
                    description={t("Settings.Directories.Desc")}
                  />
                  {renderCategorySettings("directories")}
                </Tabs.Panel>

                <Tabs.Panel value="repertoire">
                  <PanelHeader
                    title={t("Settings.Repertoire")}
                    description={t("Settings.Repertoire.Desc")}
                  />
                  {renderCategorySettings("repertoire")}
                </Tabs.Panel>

                <Tabs.Panel value="tutorials">
                  <PanelHeader
                    title={t("Settings.Tutorials")}
                    description={t("Settings.Tutorials.Desc")}
                  />
                  <TutorialSettings />
                </Tabs.Panel>

                <Tabs.Panel value="evalcache" data-tour="set-evalcache">
                  <PanelHeader
                    title={t("Settings.EvalCache")}
                    description={t("Settings.EvalCache.Desc")}
                  />
                  <EvalCacheSettings />
                </Tabs.Panel>

                <Tabs.Panel value="privacy">
                  <PanelHeader
                    title={t("Settings.Privacy")}
                    description={t("Settings.Privacy.Desc")}
                  />
                  {renderCategorySettings("privacy")}
                </Tabs.Panel>

                {isAdmin && (
                  <Tabs.Panel value="admin" data-tour="set-admin">
                    <PanelHeader
                      title={t("Settings.Admin")}
                      description={t("Settings.Admin.Desc")}
                    />
                    <AdminOverview />
                  </Tabs.Panel>
                )}
              </Card>
            </ScrollArea>
            <Group justify="flex-end" gap="xs" pb="xs">
              <Text size="xs" c="dimmed">
                JBLBase v{version}
              </Text>
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<IconDownload size="0.9rem" />}
                onClick={() => checkForAppUpdate(t)}
              >
                {t("Menu.Help.CheckUpdate")}
              </Button>
            </Group>
          </Stack>
        </Tabs>
      )}
    </Stack>
  );
}
