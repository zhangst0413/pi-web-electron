import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent";

/** Code mode's one choice (ADR 0006): Automatic writes nothing, Always on adds `+codemode` to the global defaultTools. */
export type McpCodemodePreference = "automatic" | "always";

/** One settings layer's `codemode.inlineBudget`, as the codemode extension reads it. */
export interface CodemodeInlineBudgetSetting {
  /** The budget sessions use; absent when unset or ignored, which gives them pi's default. */
  value?: number;
  /** A value pi ignores (not a finite number of 0 or more), as shortened JSON. */
  invalid?: string;
}

/**
 * pi's `codemode.mode`: how the codemode tool presents the other tools while
 * it is active. "on" (pi's default) keeps them declared; "only" hides the
 * active `direct` ones (built-in, extension and direct MCP tools) from the
 * model and lists them in the codemode description, so scripts call them.
 */
export type CodemodeMode = "on" | "only";

/** One settings layer's `codemode.mode`, as the codemode extension reads it. */
export interface CodemodeModeSetting {
  /** The mode sessions get: "only" when set to exactly that, else "on". */
  value: CodemodeMode;
  /** A value that is neither mode, which pi reads as "on", as shortened JSON. */
  invalid?: string;
}

export interface ToolSettingsResponse {
  /** The built-in tools the global defaultTools starts sessions with; `bash` is the shell. */
  builtinTools: string[];
  /** "always" when the global defaultTools starts sessions with codemode active (ADR 0006). */
  codemode: McpCodemodePreference;
  /** The global `codemode.mode`. */
  codemodeMode: CodemodeModeSetting;
  /** The global `codemode.inlineBudget`. */
  codemodeInlineBudget: CodemodeInlineBudgetSetting;
}

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: ResourceDiagnostic[];
  projectResourcesLoaded: boolean;
}

export interface SkillContentResponse {
  content: string;
}

/** One file of a bulk `PATCH /api/skills`; `error` means it was left as it was. */
export interface SkillToggleResult {
  filePath: string;
  error?: string;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
  /**
   * The nearest decision `trust.json` records for this folder or an ancestor,
   * null when there is none. Read for a folder that requires no trust too, so
   * a fresh folder (no decision anywhere) can be told from one inside a
   * trusted or untrusted tree.
   */
  decision: boolean | null;
  /** The folder that decision is recorded for, as `trust.json` keys it (its real path). */
  decisionPath?: string;
  /** The decision is recorded for an ancestor, so every folder below it shares it. */
  inherited: boolean;
  /**
   * Set only for a folder that requires no trust when `trust.json` could not
   * be read; `decision` is then null although one may exist. A folder that
   * requires trust reports the failure as an error instead.
   */
  decisionError?: string;
}

export interface AppUpdateResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}
