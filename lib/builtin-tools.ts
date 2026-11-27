import {
  defaultToolEntries,
  getGlobalSettingsPath,
  readGlobalSettings,
  updateGlobalSettings,
} from "./global-settings-file";
import { SETTINGS_BUILTIN_TOOLS } from "./tool-presets";

const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
/**
 * The shell slot of `SETTINGS_BUILTIN_TOOLS`. `bash` is the shell Pi Web starts sessions
 * with; a settings file that still names `powershell` reads as the same slot and is
 * rewritten to `bash` the next time Settings › General edits the built-in tools.
 */
const SHELL_TOOLS: readonly string[] = ["bash", "powershell"];

function isToolModifier(entry: string): boolean {
  return entry.startsWith("+") || entry.startsWith("-");
}

/**
 * The tools a `defaultTools` list selects, by pi's rule (0.99): plain names replace the
 * defaults, then each `+name` adds and each `-name` removes a tool, in list order.
 */
export function resolveDefaultToolEntries(entries: readonly string[]): string[] {
  const plain = entries.filter((entry) => !isToolModifier(entry));
  const tools = plain.length > 0 || entries.length === 0 ? plain : [...DEFAULT_TOOLS];
  for (const entry of entries) {
    if (!isToolModifier(entry)) continue;
    const name = entry.slice(1);
    const index = tools.indexOf(name);
    if (entry.startsWith("+") && index === -1 && name) tools.push(name);
    else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
  }
  return tools;
}

/** The built-in tools a global `defaultTools` list starts sessions with. */
export function builtinToolsOf(entries: readonly string[] | undefined): string[] {
  const tools = entries === undefined ? DEFAULT_TOOLS : resolveDefaultToolEntries(entries);
  return SETTINGS_BUILTIN_TOOLS.filter((name) =>
    name === "bash" ? SHELL_TOOLS.some((tool) => tools.includes(tool)) : tools.includes(name));
}

/**
 * The entries that start sessions with exactly `selected` of the built-in tools, every
 * other entry kept. Beside another plain name the built-ins are plain names too; else they
 * are `-name` / `+name` against pi's defaults, so pi's defaults alone remove the key.
 * The shell is always written as `bash`.
 */
export function withBuiltinTools(
  entries: readonly string[] | undefined,
  selected: readonly string[],
): string[] | undefined {
  const managed = [...SETTINGS_BUILTIN_TOOLS, ...SHELL_TOOLS];
  const kept = (entries ?? []).filter((entry) => !managed.includes(isToolModifier(entry) ? entry.slice(1) : entry));
  const wanted = SETTINGS_BUILTIN_TOOLS.filter((name) => selected.includes(name));
  if (kept.some((entry) => !isToolModifier(entry))) return [...wanted, ...kept];
  const next = [
    ...kept,
    ...DEFAULT_TOOLS.filter((name) => !wanted.includes(name)).map((name) => `-${name}`),
    ...wanted.filter((name) => !DEFAULT_TOOLS.includes(name)).map((name) => `+${name}`),
  ];
  return next.length > 0 ? next : undefined;
}

export async function readBuiltinTools(
  settingsPath = getGlobalSettingsPath(),
): Promise<string[]> {
  return readGlobalSettings(settingsPath, (settings) => builtinToolsOf(defaultToolEntries(settings)));
}

export async function writeBuiltinTools(
  selected: readonly string[],
  settingsPath = getGlobalSettingsPath(),
): Promise<void> {
  await updateGlobalSettings(settingsPath, (settings) => {
    const next = withBuiltinTools(defaultToolEntries(settings), selected);
    if (next === undefined) delete settings.defaultTools;
    else settings.defaultTools = next;
  });
}
