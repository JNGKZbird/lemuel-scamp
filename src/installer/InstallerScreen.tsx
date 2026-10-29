import { useState } from "react";
import { THEME_IDS } from "../console/glass/config";
import type { ThemeId } from "../console/glass/config";
import { translate } from "../i18n";
import type { Lang, MessageKey } from "../i18n";
import { ASSET_PACK, formatMiB } from "./meta";
import type {
  InstallerController,
  InstallerErrorCode,
  InstallerMode,
  InstallerPhase,
} from "./types";
import "./installer.css";

const PREVIEW_PHASES: InstallerPhase[] = [
  "welcome",
  "downloading",
  "verifying",
  "installing",
  "done",
  "error",
];

const PREVIEW_PHASE_KEYS: Record<InstallerPhase, MessageKey> = {
  welcome: "installer.preview.welcome",
  downloading: "installer.preview.downloading",
  verifying: "installer.preview.verifying",
  installing: "installer.preview.installing",
  done: "installer.preview.done",
  error: "installer.preview.error",
};

const ERROR_KEYS: Record<InstallerErrorCode, MessageKey> = {
  network: "installer.error.network",
  hash_mismatch: "installer.error.hash_mismatch",
  unsafe_archive: "installer.error.unsafe_archive",
  disk: "installer.error.disk",
  cancelled: "installer.error.cancelled",
  unknown: "installer.error.unknown",
};

const THEME_LABEL_KEYS: Record<ThemeId, MessageKey> = {
  white: "theme.white",
  black: "theme.black",
  red: "installer.themeRed",
};

type Props = {
  mode: InstallerMode;
  controller: InstallerController;
  /** 当前显示的主题；预览时由 ConsoleApp 的 previewTheme 覆盖。 */
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  /** 当前显示的语言；预览时由 ConsoleApp 的 previewLang 覆盖，不写设置。 */
  language: Lang;
  onLanguageChange: (lang: Lang) => void;
  /** 预览：返回总控台。 */
  onExit: () => void;
  /** live：应用内退出；预览不传。 */
  onQuit?: () => void;
};

function ProgressBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const indeterminate = value === null;
  return (
    <div
      className={`installer-progress${indeterminate ? " is-indeterminate" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
    >
      <span
        className="installer-progress__fill"
        style={indeterminate ? undefined : { width: `${value}%` }}
      />
    </div>
  );
}

export default function InstallerScreen({
  mode,
  controller,
  theme,
  onThemeChange,
  language,
  onLanguageChange,
  onExit,
  onQuit,
}: Props) {
  // 不用 useI18n 的 t：预览时语言可能是局部覆盖值，不能跟着全局走。
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(language, key, vars);
  const { state } = controller;
  const preview = mode === "preview";
  const [acknowledged, setAcknowledged] = useState(false);

  const headline =
    state.phase === "welcome"
      ? t("installer.headline")
      : state.phase === "downloading"
        ? t("installer.downloading")
        : state.phase === "verifying"
          ? t("installer.verifying")
          : state.phase === "installing"
            ? t("installer.installing", { count: ASSET_PACK.fileCount })
            : state.phase === "done"
              ? t("installer.doneTitle")
              : t("installer.errorTitle");

  const lead =
    state.phase === "welcome"
      ? t("installer.lead")
      : state.phase === "downloading"
        ? t("installer.downloadingHint")
        : state.phase === "verifying"
          ? t("installer.verifyingHint")
          : state.phase === "installing"
            ? t("installer.installingHint")
            : state.phase === "done"
              ? t("installer.doneHint", { count: ASSET_PACK.fileCount })
              : null;

  const showStats =
    state.phase === "welcome" || state.phase === "downloading";
  const showProgress =
    state.phase === "downloading" ||
    state.phase === "verifying" ||
    state.phase === "installing";

  const downloadPercent =
    state.phase === "downloading" && state.total > 0
      ? (state.received / state.total) * 100
      : 0;

  const handleDoneStart = () => {
    if (preview) {
      onExit();
      return;
    }
    controller.finish();
  };

  return (
    <div className="installer-stage">
      <div className="installer-viewport">
        <section
          className={`installer-card${preview ? " is-preview" : ""}`}
          aria-label={t("installer.windowTitle")}
        >
          <div className="installer-eyebrow">
            <span className="installer-eyebrow__dot" aria-hidden="true" />
            <span className="installer-eyebrow__label">
              {t("installer.eyebrow")}
            </span>
            <div
              className="installer-lang"
              role="group"
              aria-label={t("installer.langAria")}
            >
              <button
                type="button"
                className={`installer-lang__btn${
                  language === "zh-CN" ? " is-active" : ""
                }`}
                aria-pressed={language === "zh-CN"}
                onClick={() => onLanguageChange("zh-CN")}
              >
                中文
              </button>
              <button
                type="button"
                className={`installer-lang__btn${
                  language === "en" ? " is-active" : ""
                }`}
                aria-pressed={language === "en"}
                onClick={() => onLanguageChange("en")}
              >
                EN
              </button>
            </div>
          </div>

          <div className="installer-head">
            <h2 className="installer-headline" aria-live="polite">
              {headline}
            </h2>
            {lead ? <p className="installer-lead">{lead}</p> : null}
          </div>

          {state.phase === "done" ? (
            <div className="installer-check" aria-hidden="true">
              <svg viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="19" />
                <path d="M12 20.6l5.4 5.4L28 15.8" />
              </svg>
            </div>
          ) : null}

          {showStats ? (
            <dl className="installer-stats">
              <div className="installer-stat">
                <dt>{t("installer.statDownload")}</dt>
                <dd>{formatMiB(ASSET_PACK.downloadBytes)}</dd>
              </div>
              <div className="installer-stat">
                <dt>{t("installer.statInstalled")}</dt>
                <dd>{formatMiB(ASSET_PACK.installBytes)}</dd>
              </div>
              <div className="installer-stat">
                <dt>{t("installer.statFiles")}</dt>
                <dd>
                  {t("installer.statFilesValue", {
                    count: ASSET_PACK.fileCount,
                  })}
                </dd>
              </div>
            </dl>
          ) : null}

          {showStats ? (
            <div className="installer-source">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 1.5l5 2v4.2c0 3-2.1 5.4-5 6.8-2.9-1.4-5-3.8-5-6.8V3.5l5-2z" />
                <path d="M5.7 8.1l1.6 1.6 3-3.2" />
              </svg>
              <span className="installer-source__url">
                {t("installer.source")}
              </span>
              <span className="installer-source__hash">
                {t("installer.hashNote")}
              </span>
            </div>
          ) : null}

          {showProgress ? (
            <div className="installer-status">
              <ProgressBar
                label={t("installer.progressAria")}
                value={
                  state.phase === "downloading" ? downloadPercent : null
                }
              />
              {state.phase === "downloading" ? (
                <div className="installer-status__meta">
                  <span>
                    {formatMiB(state.received, 2)} /{" "}
                    {formatMiB(state.total, 2)}
                  </span>
                  <span>{Math.round(downloadPercent)}%</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {state.phase === "welcome" ? (
            <div className="installer-license">
              <p>{t("installer.license")}</p>
              <label className="installer-checkline">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>{t("installer.licenseCheck")}</span>
              </label>
            </div>
          ) : null}

          {state.phase === "error" ? (
            <div className="installer-error" role="alert">
              <p className="installer-error__msg">{t(ERROR_KEYS[state.code])}</p>
              <p className="installer-error__code">{state.code}</p>
              <details className="installer-error__details">
                <summary>{t("installer.details")}</summary>
                <pre>{state.detail}</pre>
              </details>
            </div>
          ) : null}

          <div className="installer-actions">
            {state.phase === "welcome" ? (
              <>
                <button
                  type="button"
                  className="installer-btn installer-btn--primary"
                  disabled={!acknowledged}
                  onClick={controller.start}
                >
                  {t("installer.downloadInstall")}
                </button>
                <button
                  type="button"
                  className="installer-btn installer-btn--ghost"
                  onClick={controller.importZip}
                >
                  {t("installer.importZip")}
                </button>
                {!preview && onQuit ? (
                  <button
                    type="button"
                    className="installer-link"
                    onClick={onQuit}
                  >
                    {t("installer.quit")}
                  </button>
                ) : null}
              </>
            ) : null}

            {state.phase === "downloading" ? (
              <button
                type="button"
                className="installer-btn installer-btn--ghost"
                onClick={controller.cancel}
              >
                {t("installer.cancel")}
              </button>
            ) : null}

            {state.phase === "done" ? (
              <>
                <button
                  type="button"
                  className="installer-btn installer-btn--primary"
                  onClick={handleDoneStart}
                >
                  {t("installer.start")}
                </button>
                <button
                  type="button"
                  className="installer-btn installer-btn--ghost"
                  disabled
                  title="Phase B"
                >
                  {t("installer.viewLocation")}
                </button>
              </>
            ) : null}

            {state.phase === "error" ? (
              <>
                <button
                  type="button"
                  className="installer-btn installer-btn--primary"
                  onClick={controller.retry}
                >
                  {t("installer.retry")}
                </button>
                <button
                  type="button"
                  className="installer-btn installer-btn--ghost"
                  onClick={controller.importZip}
                >
                  {t("installer.importZip")}
                </button>
                {!preview && onQuit ? (
                  <button
                    type="button"
                    className="installer-link"
                    onClick={onQuit}
                  >
                    {t("installer.quit")}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>

          <p className="installer-footer">{t("installer.footer")}</p>
        </section>
      </div>

      {preview ? (
        <div className="installer-preview">
          <span className="installer-preview__tag">
            {t("installer.preview.tag")}
          </span>
          <div
            className="installer-preview__group"
            role="group"
            aria-label={t("installer.preview.statesAria")}
          >
            {PREVIEW_PHASES.map((phase) => (
              <button
                key={phase}
                type="button"
                className={`installer-chip${
                  state.phase === phase ? " is-active" : ""
                }`}
                onClick={() => controller.jump?.(phase)}
              >
                {t(PREVIEW_PHASE_KEYS[phase])}
              </button>
            ))}
          </div>
          <div
            className="installer-preview__group"
            role="group"
            aria-label={t("installer.preview.themeAria")}
          >
            {THEME_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`installer-chip${
                  theme === id ? " is-active" : ""
                }`}
                onClick={() => onThemeChange(id)}
              >
                {t(THEME_LABEL_KEYS[id])}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="installer-preview__back"
            onClick={onExit}
          >
            {t("installer.preview.back")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
