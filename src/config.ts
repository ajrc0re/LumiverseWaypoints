import type {
  PromptRole,
  SettingsValidationIssue,
  SettingsValidationResult,
  WaypointSettings,
} from "./types";

const TAG_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const OVERRIDE_NAME = /^[A-Za-z0-9_]{1,64}$/;
const ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant"]);

export const DEFAULT_PROMPT_TEMPLATE = [
  "<shape_scene_direction>",
  "- DIRECTION TARGET: Treat the upcoming prewritten scene as a long-term destination. Gradually shape the narrative's setting, character positions, emotional state, and momentum so the scene can begin naturally and immediately afterward. Do not force a fade-out or make the guidance visible.",
  "- PACING AND HANDOFF: Reach the scene slowly over multiple turns. Continue the present narrative until its required conditions feel earned, rather than transitioning at the first plausible opportunity. Favor gradual progression toward the handoff point over immediate scene setup.",
  "- NARRATIVE SPACING MINIMUMS: Avoid placing major transitions or prewritten handoffs on the same day or on consecutive days. Unless the next scene is explicitly required to occur that day, allow at least one or two in-story days to pass before guiding the narrative toward it. If a handoff has already occurred that day, continue the story naturally without setting up another.",
  "- LATE HANDOFF POLICY: Continue the current narrative naturally until it reaches the doorstep of the upcoming prewritten scene. Move toward that point gradually across several turns without forcing a bridge or rushing the required setup. Trigger the handoff at the latest viable moment, ideally immediately before the scene begins. Do not hand off merely because of a calm pause, completed emotional beat, natural stopping point, fade-out, summary, chapter break, or other convenient ending.",
  "- VALID HANDOFF THRESHOLD: Hand off only when the narrative has reached the immediate starting point of the upcoming prewritten scene. The next assistant reply must be able to begin that scene without additional setup, explanation, bridging, or character repositioning. If the current narrative can still progress naturally toward that point, continue instead. When uncertain, delay the handoff and move closer at a normal pace. Never use a large time skip solely to reach the threshold faster.",
  "- USER INJECTION OVERRIDE TAG: If the user's latest reply contains {{override_tag}}, override the normal pacing rules and use the next response to make a best-effort transition toward the handoff threshold. Force the narrative into the closest viable starting position for the upcoming prewritten scene, using only as much bridging, repositioning, or time progression as necessary. The following assistant response must include {{handoff_tag}} exactly once, even if the threshold could not be reached perfectly.",
  "- PREWRITTEN CONTENT INJECTION TAG: Once the handoff threshold is fully reached, include {{handoff_tag}} exactly once on its own line. This hidden control tag exists only to trigger insertion of the upcoming prewritten content. Do not use it as a scene ending, chapter break, fade-out, or general transition marker. It may appear anywhere in the response and will be removed before the user sees it.",
  "- PREWRITTEN SCENE PRIVACY: Use the upcoming prewritten scene only as a private directional reference for pacing and steering the current narrative.",
  "- MANDATORY CONSTRAINT: Do not quote, summarize, paraphrase, adapt, preview, merge, or reproduce any part of the prewritten scene. Do not copy its wording, details, URLs, images, formatting, or headings. The scene will be inserted automatically after the handoff tag, so none of its content may appear beforehand.",
  "",
  "UPCOMING PREWRITTEN SCENE — DIRECTION AND TIMING REFERENCE ONLY:",
  "{{scene_excerpt}}",
  "</shape_scene_direction>",
].join("\n");

export const DEFAULT_SETTINGS: WaypointSettings = {
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  prewrittenSceneCharLimit: 2000,
  promptExcludeRegex: "",
  autoPrompt: false,
  insertionDepth: 0,
  promptRole: "system",
  handoffTagName: "inject-prewritten-content",
  overrideTagName: "o",
  interceptorPriority: 100,
  contentProcessorPriority: 10,
  activeChatRetryAttempts: 10,
  activeChatRetryDelayMs: 100,
  handoffReadRetryAttempts: 10,
  handoffReadRetryDelayMs: 100,
  pendingHandoffLimit: 24,
  recentTransitionLimit: 40,
  diagnosticLogging: true,
  diagnosticLineLimit: 96,
  floatingControls: true,
};

export class SettingsValidationError extends Error {
  readonly issues: SettingsValidationIssue[];

  constructor(issues: SettingsValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "SettingsValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  input: Record<string, unknown>,
  field: keyof WaypointSettings,
  fallback: string,
  maxLength: number,
  issues: SettingsValidationIssue[],
): string {
  const value = input[field];
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    issues.push({ field, message: String(field) + " must be text." });
    return fallback;
  }
  if (value.length > maxLength) {
    issues.push({
      field,
      message: String(field) + " is too long (maximum " + String(maxLength) + " characters).",
    });
    return fallback;
  }
  return value;
}

function readBoolean(
  input: Record<string, unknown>,
  field: keyof WaypointSettings,
  fallback: boolean,
  issues: SettingsValidationIssue[],
): boolean {
  const value = input[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    issues.push({ field, message: String(field) + " must be on or off." });
    return fallback;
  }
  return value;
}

function readInteger(
  input: Record<string, unknown>,
  field: keyof WaypointSettings,
  fallback: number,
  min: number,
  max: number,
  issues: SettingsValidationIssue[],
): number {
  const value = input[field];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    issues.push({
      field,
      message: String(field) + " must be a whole number from " + String(min) + " to " + String(max) + ".",
    });
    return fallback;
  }
  return Number(value);
}

function readRole(
  input: Record<string, unknown>,
  issues: SettingsValidationIssue[],
): PromptRole {
  const value = input.promptRole;
  if (value === undefined) return DEFAULT_SETTINGS.promptRole;
  if (typeof value !== "string" || !ROLES.has(value)) {
    issues.push({ field: "promptRole", message: "Prompt role must be system, user, or assistant." });
    return DEFAULT_SETTINGS.promptRole;
  }
  return value as PromptRole;
}

export function validateTagName(value: string): boolean {
  return TAG_NAME.test(value);
}

export function validateOverrideName(value: string): boolean {
  return OVERRIDE_NAME.test(value);
}

function finalRegexDelimiter(value: string): number {
  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] !== "/") continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

export function stripExtendedRegexWhitespace(pattern: string): string {
  let output = "";
  let inClass = false;
  let escaped = false;
  let comment = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (comment) {
      if (character === "\n" || character === "\r") comment = false;
      continue;
    }
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      output += character;
      escaped = true;
      continue;
    }
    if (character === "[" && !inClass) {
      inClass = true;
      output += character;
      continue;
    }
    if (character === "]" && inClass) {
      inClass = false;
      output += character;
      continue;
    }
    if (!inClass && character === "#") {
      comment = true;
      continue;
    }
    if (!inClass && /\s/.test(character)) continue;
    output += character;
  }
  return output;
}

/**
 * Accepts JavaScript regex literals such as /foo/gi and the LumiScript-style
 * x flag, which ignores unescaped whitespace and # comments outside classes.
 */
export function compileExcludeRegex(value: string): RegExp | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let pattern = trimmed;
  let flags = "";
  if (trimmed.startsWith("/")) {
    const delimiter = finalRegexDelimiter(trimmed);
    if (delimiter <= 0) throw new Error("Regex literal is missing its closing slash.");
    pattern = trimmed.slice(1, delimiter);
    flags = trimmed.slice(delimiter + 1);
    if (!/^[gimsuyx]*$/.test(flags)) {
      throw new Error("Regex flags may use g, i, m, s, u, y, and LumiScript's x flag.");
    }
    if (new Set(flags).size !== flags.length) throw new Error("Regex flags cannot be repeated.");
  }
  if (flags.includes("x")) {
    pattern = stripExtendedRegexWhitespace(pattern);
    flags = flags.replaceAll("x", "");
  }
  // replace() needs a global expression. Sticky matching would make filtering
  // depend on lastIndex, so it is intentionally removed.
  flags = flags.replaceAll("y", "");
  if (!flags.includes("g")) flags += "g";
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error("Invalid exclusion regex: " + (error instanceof Error ? error.message : String(error)));
  }
}

export function validateSettings(input: unknown): SettingsValidationResult {
  const source = isRecord(input) ? input : {};
  const issues: SettingsValidationIssue[] = [];
  const warnings: string[] = [];
  const promptTemplate = readString(source, "promptTemplate", DEFAULT_SETTINGS.promptTemplate, 32_000, issues);
  const settings: WaypointSettings = {
    promptTemplate,
    prewrittenSceneCharLimit: readInteger(source, "prewrittenSceneCharLimit", DEFAULT_SETTINGS.prewrittenSceneCharLimit, 1, 100_000, issues),
    promptExcludeRegex: readString(source, "promptExcludeRegex", DEFAULT_SETTINGS.promptExcludeRegex, 4096, issues),
    autoPrompt: readBoolean(source, "autoPrompt", DEFAULT_SETTINGS.autoPrompt, issues),
    insertionDepth: readInteger(source, "insertionDepth", DEFAULT_SETTINGS.insertionDepth, 0, 9999, issues),
    promptRole: readRole(source, issues),
    handoffTagName: readString(source, "handoffTagName", DEFAULT_SETTINGS.handoffTagName, 64, issues),
    overrideTagName: readString(source, "overrideTagName", DEFAULT_SETTINGS.overrideTagName, 64, issues),
    interceptorPriority: readInteger(source, "interceptorPriority", DEFAULT_SETTINGS.interceptorPriority, 0, 1000, issues),
    contentProcessorPriority: readInteger(source, "contentProcessorPriority", DEFAULT_SETTINGS.contentProcessorPriority, 0, 1000, issues),
    activeChatRetryAttempts: readInteger(source, "activeChatRetryAttempts", DEFAULT_SETTINGS.activeChatRetryAttempts, 1, 25, issues),
    activeChatRetryDelayMs: readInteger(source, "activeChatRetryDelayMs", DEFAULT_SETTINGS.activeChatRetryDelayMs, 0, 2000, issues),
    handoffReadRetryAttempts: readInteger(source, "handoffReadRetryAttempts", DEFAULT_SETTINGS.handoffReadRetryAttempts, 1, 25, issues),
    handoffReadRetryDelayMs: readInteger(source, "handoffReadRetryDelayMs", DEFAULT_SETTINGS.handoffReadRetryDelayMs, 0, 2000, issues),
    pendingHandoffLimit: readInteger(source, "pendingHandoffLimit", DEFAULT_SETTINGS.pendingHandoffLimit, 1, 500, issues),
    recentTransitionLimit: readInteger(source, "recentTransitionLimit", DEFAULT_SETTINGS.recentTransitionLimit, 1, 500, issues),
    diagnosticLogging: readBoolean(source, "diagnosticLogging", DEFAULT_SETTINGS.diagnosticLogging, issues),
    diagnosticLineLimit: readInteger(source, "diagnosticLineLimit", DEFAULT_SETTINGS.diagnosticLineLimit, 10, 500, issues),
    floatingControls: readBoolean(source, "floatingControls", DEFAULT_SETTINGS.floatingControls, issues),
  };

  if (!settings.promptTemplate.includes("{{scene_excerpt}}")) {
    issues.push({ field: "template", message: "Prompt template must include {{scene_excerpt}}." });
  }
  if (!settings.promptTemplate.includes("{{handoff_tag}}")) {
    issues.push({ field: "template", message: "Prompt template must include {{handoff_tag}}." });
  }
  if (!settings.promptTemplate.includes("{{override_tag}}")) {
    warnings.push("The template omits {{override_tag}}; user override tags will not be explained to the model.");
  }
  if (!validateTagName(settings.handoffTagName)) {
    issues.push({
      field: "handoffTagName",
      message: "Handoff tag names must start with a letter and may contain letters, numbers, dots, colons, underscores, or hyphens.",
    });
  }
  if (!validateOverrideName(settings.overrideTagName)) {
    issues.push({
      field: "overrideTagName",
      message: "Override tag names may contain letters, numbers, and underscores.",
    });
  }
  try {
    compileExcludeRegex(settings.promptExcludeRegex);
  } catch (error) {
    issues.push({
      field: "promptExcludeRegex",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (issues.length) throw new SettingsValidationError(issues);
  return { settings, warnings };
}

/**
 * Stored data is defensive: an old or manually edited file never prevents the
 * drawer from loading. Explicit saves still use validateSettings and reject
 * malformed drafts atomically.
 */
export function settingsFromStorage(input: unknown): WaypointSettings {
  try {
    return validateSettings(input).settings;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}
