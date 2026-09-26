// src/config.ts
var TAG_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
var OVERRIDE_NAME = /^[A-Za-z0-9_]{1,64}$/;
var ROLES = new Set(["system", "user", "assistant"]);
var DEFAULT_PROMPT_TEMPLATE = [
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
  "</shape_scene_direction>"
].join(`
`);
var DEFAULT_SETTINGS = {
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
  reminderToast: true,
  reminderTimeoutAction: "yes",
  actionBarButton: true,
  extrasActions: true
};

class SettingsValidationError extends Error {
  issues;
  constructor(issues) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "SettingsValidationError";
    this.issues = issues;
  }
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function readString(input, field, fallback, maxLength, issues) {
  const value = input[field];
  if (value === undefined)
    return fallback;
  if (typeof value !== "string") {
    issues.push({ field, message: String(field) + " must be text." });
    return fallback;
  }
  if (value.length > maxLength) {
    issues.push({
      field,
      message: String(field) + " is too long (maximum " + String(maxLength) + " characters)."
    });
    return fallback;
  }
  return value;
}
function readBoolean(input, field, fallback, issues) {
  const value = input[field];
  if (value === undefined)
    return fallback;
  if (typeof value !== "boolean") {
    issues.push({ field, message: String(field) + " must be on or off." });
    return fallback;
  }
  return value;
}
function readInteger(input, field, fallback, min, max, issues) {
  const value = input[field];
  if (value === undefined)
    return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    issues.push({
      field,
      message: String(field) + " must be a whole number from " + String(min) + " to " + String(max) + "."
    });
    return fallback;
  }
  return Number(value);
}
function readRole(input, issues) {
  const value = input.promptRole;
  if (value === undefined)
    return DEFAULT_SETTINGS.promptRole;
  if (typeof value !== "string" || !ROLES.has(value)) {
    issues.push({ field: "promptRole", message: "Prompt role must be system, user, or assistant." });
    return DEFAULT_SETTINGS.promptRole;
  }
  return value;
}
function readReminderTimeoutAction(input, issues) {
  const value = input.reminderTimeoutAction;
  if (value === undefined)
    return DEFAULT_SETTINGS.reminderTimeoutAction;
  if (value === "yes" || value === "no")
    return value;
  issues.push({ field: "reminderTimeoutAction", message: "Reminder timeout action must be Yes or No." });
  return DEFAULT_SETTINGS.reminderTimeoutAction;
}
function validateTagName(value) {
  return TAG_NAME.test(value);
}
function validateOverrideName(value) {
  return OVERRIDE_NAME.test(value);
}
function finalRegexDelimiter(value) {
  for (let index = value.length - 1;index > 0; index -= 1) {
    if (value[index] !== "/")
      continue;
    let backslashes = 0;
    for (let cursor = index - 1;cursor >= 0 && value[cursor] === "\\"; cursor -= 1)
      backslashes += 1;
    if (backslashes % 2 === 0)
      return index;
  }
  return -1;
}
function stripExtendedRegexWhitespace(pattern) {
  let output = "";
  let inClass = false;
  let escaped = false;
  let comment = false;
  for (let index = 0;index < pattern.length; index += 1) {
    const character = pattern[index];
    if (comment) {
      if (character === `
` || character === "\r")
        comment = false;
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
    if (!inClass && /\s/.test(character))
      continue;
    output += character;
  }
  return output;
}
function compileExcludeRegex(value) {
  const trimmed = value.trim();
  if (!trimmed)
    return null;
  let pattern = trimmed;
  let flags = "";
  if (trimmed.startsWith("/")) {
    const delimiter = finalRegexDelimiter(trimmed);
    if (delimiter <= 0)
      throw new Error("Regex literal is missing its closing slash.");
    pattern = trimmed.slice(1, delimiter);
    flags = trimmed.slice(delimiter + 1);
    if (!/^[gimsuyx]*$/.test(flags)) {
      throw new Error("Regex flags may use g, i, m, s, u, y, and LumiScript's x flag.");
    }
    if (new Set(flags).size !== flags.length)
      throw new Error("Regex flags cannot be repeated.");
  }
  if (flags.includes("x")) {
    pattern = stripExtendedRegexWhitespace(pattern);
    flags = flags.replaceAll("x", "");
  }
  flags = flags.replaceAll("y", "");
  if (!flags.includes("g"))
    flags += "g";
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error("Invalid exclusion regex: " + (error instanceof Error ? error.message : String(error)));
  }
}
function validateSettings(input) {
  const source = isRecord(input) ? input : {};
  const issues = [];
  const warnings = [];
  const promptTemplate = readString(source, "promptTemplate", DEFAULT_SETTINGS.promptTemplate, 32000, issues);
  const settings = {
    promptTemplate,
    prewrittenSceneCharLimit: readInteger(source, "prewrittenSceneCharLimit", DEFAULT_SETTINGS.prewrittenSceneCharLimit, 1, 1e5, issues),
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
    reminderToast: readBoolean(source, "reminderToast", DEFAULT_SETTINGS.reminderToast, issues),
    reminderTimeoutAction: readReminderTimeoutAction(source, issues),
    actionBarButton: readBoolean(source, "actionBarButton", DEFAULT_SETTINGS.actionBarButton, issues),
    extrasActions: readBoolean(source, "extrasActions", DEFAULT_SETTINGS.extrasActions, issues)
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
      message: "Handoff tag names must start with a letter and may contain letters, numbers, dots, colons, underscores, or hyphens."
    });
  }
  if (!validateOverrideName(settings.overrideTagName)) {
    issues.push({
      field: "overrideTagName",
      message: "Override tag names may contain letters, numbers, and underscores."
    });
  }
  try {
    compileExcludeRegex(settings.promptExcludeRegex);
  } catch (error) {
    issues.push({
      field: "promptExcludeRegex",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  if (issues.length)
    throw new SettingsValidationError(issues);
  return { settings, warnings };
}

// src/state.ts
function nextGreetingChoices(greetings, active, isGroupChat) {
  if (!active)
    return [...greetings];
  if (isGroupChat) {
    return greetings.filter((greeting) => greeting.characterId !== active.characterId || greeting.greetingIndex !== active.greetingIndex);
  }
  return greetings.filter((greeting) => greeting.characterId === active.characterId && greeting.greetingIndex > active.greetingIndex);
}

// src/frontend-model.ts
function approximatePromptTokenCount(characterCount) {
  return Math.max(0, Math.ceil(Math.max(0, characterCount) / 4));
}
function formatPromptCount(tokenCount, characterCount, approximate) {
  return (approximate ? "~" : "") + String(Math.max(0, Math.round(tokenCount))) + " Tokens / " + String(Math.max(0, characterCount)) + " Characters";
}
function cloneSettingsDraft(settings) {
  return structuredClone(settings);
}
function draftValidation(settings) {
  try {
    const result = validateSettings(settings);
    return { valid: true, messages: result.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, messages: [message] };
  }
}
function canShowHud(floatingControls, grantedPermissions) {
  return floatingControls && grantedPermissions.includes("ui_panels");
}
function greetingPickerOptions(kind, view) {
  if (kind === "current")
    return view.greetings;
  return nextGreetingChoices(view.greetings, view.active, view.isGroupChat);
}
function shouldRefreshDrawer(eventName) {
  return eventName === "CHAT_SWITCHED" || eventName === "CHAT_CHANGED" || eventName === "waypoints:changed";
}

// src/prompt.ts
function handoffTag(settings) {
  return "<" + settings.handoffTagName + " />";
}
function overrideTag(settings) {
  return "--" + settings.overrideTagName + "--";
}

// src/styles.ts
var waypointStyles = [
  ".wp-root{color:var(--lumiverse-text,#ececf1);font:13px/1.45 system-ui,sans-serif;padding:12px;max-width:760px;margin:auto}",
  ".wp-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}",
  ".wp-header h2{font-size:18px;margin:0 0 3px}.wp-muted{color:var(--lumiverse-text-muted,#9da0a8);margin:0}",
  ".wp-tabs{display:flex;gap:6px;border-bottom:1px solid var(--lumiverse-border,#34363c);margin-bottom:14px}",
  ".wp-tab{appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;padding:8px 12px;cursor:pointer;font:inherit}",
  ".wp-tab[aria-selected=true]{border-color:var(--lumiverse-primary,#8b7cff);color:var(--lumiverse-primary,#a99dff)}",
  ".wp-card,.wp-section{background:var(--lumiverse-bg-elevated,#202126);border:1px solid var(--lumiverse-border,#34363c);border-radius:9px;padding:12px;margin:0 0 12px}",
  ".wp-section h3{font-size:14px;margin:0 0 9px}.wp-section h4{font-size:13px;margin:14px 0 6px}",
  ".wp-alert{border-left:3px solid #e7ad42;background:color-mix(in srgb,#e7ad42 11%,transparent);padding:9px 10px;margin:0 0 12px;border-radius:4px}",
  ".wp-notice{border-left:3px solid var(--lumiverse-primary,#8b7cff);background:color-mix(in srgb,var(--lumiverse-primary,#8b7cff) 11%,transparent);padding:9px 10px;margin:0 0 12px;border-radius:4px}",
  ".wp-notice.error{border-color:#e66161;background:color-mix(in srgb,#e66161 11%,transparent)}",
  ".wp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.wp-field{min-width:0;margin:0 0 12px}",
  ".wp-field>label,.wp-label{display:block;font-weight:600;margin-bottom:4px}.wp-help{font-size:12px;color:var(--lumiverse-text-muted,#9da0a8);margin:3px 0 6px}",
  ".wp-native{min-height:32px}.wp-prompt-count{display:inline-flex;align-items:center;margin:6px 0 2px;padding:4px 7px;border:1px solid var(--lumiverse-border,#34363c);border-radius:5px;color:var(--lumiverse-text-muted,#9da0a8);font:600 12px/1.25 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}.wp-preview{white-space:pre-wrap;max-height:180px;overflow:auto;background:var(--lumiverse-bg,#16171b);border:1px solid var(--lumiverse-border,#34363c);border-radius:6px;padding:9px;margin:6px 0 0;font:12px/1.35 ui-monospace,Consolas,monospace}",
  ".wp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.wp-row.between{justify-content:space-between}.wp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
  ".wp-button{appearance:none;border:1px solid var(--lumiverse-border,#4c4e56);border-radius:6px;background:var(--lumiverse-bg,#2a2b31);color:inherit;padding:6px 10px;cursor:pointer;font:inherit}",
  ".wp-button.primary{background:var(--lumiverse-primary,#796bdf);border-color:var(--lumiverse-primary,#796bdf);color:#fff}.wp-button.danger{border-color:#c75a5a}.wp-button:disabled{opacity:.48;cursor:not-allowed}",
  ".wp-character{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--lumiverse-border,#34363c)}.wp-character:first-child{border-top:0}",
  ".wp-character-name{font-weight:600}.wp-kicker{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--lumiverse-text-muted,#9da0a8)}",
  ".wp-validation{font-size:12px;margin:4px 0 8px}.wp-validation.good{color:#77c68e}.wp-validation.bad{color:#ef8b8b}",
  ".wp-loom-help{margin-top:12px;padding:10px;border:1px solid var(--lumiverse-border,#34363c);border-radius:7px;background:color-mix(in srgb,var(--lumiverse-bg,#16171b) 65%,transparent)}.wp-loom-help .wp-preview{margin-bottom:0}",
  ".wp-code{font-family:ui-monospace,Consolas,monospace;background:var(--lumiverse-bg,#16171b);border-radius:4px;padding:2px 5px}",
  ".wp-diagnostics summary{cursor:pointer;font-weight:600}.wp-diagnostics pre{max-height:240px}.wp-divider{height:1px;background:var(--lumiverse-border,#34363c);margin:14px 0}",
  ".wp-action-bar-mount{display:contents}.wp-action-bar-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 28px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--lumiverse-text-muted,#9da0a8);cursor:pointer}.wp-action-bar-button:hover{background:var(--lumiverse-bg-hover,#34363c)}.wp-action-bar-button:focus-visible{outline:2px solid var(--lumiverse-primary,#8b7cff);outline-offset:-2px}.wp-action-bar-button:disabled{opacity:.45;cursor:not-allowed}.wp-action-bar-button svg{width:15px;height:15px}",
  ".wp-picker{height:min(78vh,900px);min-height:min(560px,calc(100vh - 170px));display:flex;min-width:0;flex-direction:column;overflow:hidden;color:var(--lumiverse-text,#ececf1);font:13px/1.45 system-ui,sans-serif}.wp-picker *{box-sizing:border-box}.wp-picker-main{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px;overflow:hidden}.wp-picker-meta{color:var(--lumiverse-text-muted,#9da0a8);font-size:12px;line-height:1.35;overflow-wrap:anywhere}.wp-picker-field{display:grid;gap:6px;flex:0 0 auto}.wp-picker-label{color:var(--lumiverse-text-muted,#9da0a8);font-size:12px}.wp-picker-select{width:100%;min-height:54px;color:var(--lumiverse-text,#ececf1);background:var(--lumiverse-fill,rgba(255,255,255,.08));border:1px solid var(--lumiverse-border,#34363c);border-radius:7px;padding:13px 14px;font:600 16px/1.35 system-ui,sans-serif}.wp-picker-preview{flex:1 1 auto;min-height:0;overflow:auto;background:rgba(0,0,0,.22);border:1px solid var(--lumiverse-border,#34363c);border-radius:8px}.wp-picker-preview pre{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;font:13px/1.45 ui-monospace,Consolas,monospace}.wp-picker-error{flex:0 0 auto;color:#ef8b8b;border-left:3px solid #e66161;background:color-mix(in srgb,#e66161 11%,transparent);padding:8px 10px;border-radius:4px}.wp-picker-footer{flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px 16px;border-top:1px solid var(--lumiverse-border,#34363c)}",
  ".wp-hud{display:flex;align-items:center;gap:5px;height:100%;box-sizing:border-box;background:var(--lumiverse-bg-elevated,#202126);border:1px solid var(--lumiverse-border,#34363c);border-radius:8px;padding:5px 7px;box-shadow:0 4px 16px #0006}.wp-hud-label{font-weight:700;font-size:12px;margin-right:2px}.wp-hud .wp-button{font-size:11px;padding:4px 6px}",
  ".wp-reminder{width:100%;height:100%;color:var(--lumiverse-text,#ececf1);font:13px/1.35 system-ui,sans-serif}.wp-reminder-card{box-sizing:border-box;width:100%;height:100%;overflow:hidden;border:1px solid color-mix(in srgb,var(--lumiverse-primary,#8b7cff) 80%,white);border-left:4px solid var(--lumiverse-primary,#8b7cff);border-radius:9px;background:var(--lumiverse-bg-elevated,#202126);box-shadow:0 8px 28px #0009;padding:9px 10px 0}.wp-reminder-title{font-weight:750;color:var(--lumiverse-primary,#ad9dff);font-size:12px}.wp-reminder-copy{font-size:12px;margin-top:2px}.wp-reminder-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:5px}.wp-reminder-count{margin-right:auto;font:700 11px/1 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}.wp-reminder .wp-button{font-size:11px;line-height:1;padding:5px 10px}.wp-reminder-track{height:4px;margin:7px -10px 0;background:color-mix(in srgb,var(--lumiverse-primary,#8b7cff) 20%,transparent);overflow:hidden}.wp-reminder-progress{width:100%;height:100%;background:var(--lumiverse-primary,#8b7cff);transform-origin:left center;will-change:transform}",
  "@media (max-height:760px){.wp-picker{height:calc(100vh - 170px);min-height:0}}@media (max-width:430px){.wp-root{padding:8px}.wp-header{display:block}.wp-header .wp-button{margin-top:8px}.wp-grid{grid-template-columns:1fr}}"
].join(`
`);

// src/frontend.ts
function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className)
    node.className = className;
  if (text !== undefined)
    node.textContent = text;
  return node;
}
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function safeRecord(value) {
  return isRecord2(value) ? value : {};
}
function asView(value) {
  if (!isRecord2(value) || !isRecord2(value.settings) || !Array.isArray(value.greetings))
    return null;
  return value;
}
function selectionValue(greeting) {
  return greeting ? JSON.stringify({ characterId: greeting.characterId, greetingIndex: greeting.greetingIndex }) : "";
}
function parseSelection(value) {
  if (!value)
    return null;
  try {
    const parsed = JSON.parse(value);
    if (!isRecord2(parsed) || typeof parsed.characterId !== "string" || !Number.isInteger(parsed.greetingIndex))
      return null;
    return { characterId: parsed.characterId, greetingIndex: Number(parsed.greetingIndex) };
  } catch {
    return null;
  }
}
function greetingLabel(greeting) {
  const firstLine = greeting.text.replace(/\s+/g, " ").slice(0, 86);
  return greeting.characterName + " — greeting " + String(greeting.greetingIndex + 1) + (firstLine ? ": " + firstLine : "");
}
function compactPreview(value, limit = 580) {
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}
var WAYPOINTS_COMPASS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2.7 5-5 2.7 2.7-5 5-2.7Z"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>';
function setup(ctx) {
  const tab = ctx.ui.registerDrawerTab({
    id: "waypoints",
    title: "Waypoints",
    shortName: "Waypoints",
    headerTitle: "Waypoints",
    description: "Guide a chat through character greetings as story waypoints",
    keywords: ["greetings", "handoff", "scene", "prompt", "waypoints"],
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 19V5m0 0 11 3-3 5 6 2-3 5-11-3"/><circle cx="5" cy="5" r="1.5"/></svg>'
  });
  tab.root.classList.add("wp-mount");
  const root = element("div", "wp-root");
  tab.root.append(root);
  const removeStyle = ctx.dom.addStyle(waypointStyles);
  let actionBarMount = null;
  try {
    actionBarMount = ctx.ui.mount("chat_actions");
    actionBarMount.classList.add("wp-action-bar-mount");
  } catch (error) {
    console.warn("[Waypoints] action-bar mount unavailable", error);
  }
  const actionBarButton = actionBarMount ? element("button", "wp-action-bar-button") : null;
  if (actionBarButton && actionBarMount) {
    actionBarButton.type = "button";
    actionBarButton.innerHTML = WAYPOINTS_COMPASS_ICON;
    actionBarButton.title = "Waypoints controls";
    actionBarButton.setAttribute("aria-label", "Waypoints controls");
    actionBarButton.hidden = true;
    actionBarMount.append(actionBarButton);
  }
  let page = "waypoints";
  let view = null;
  let draft = cloneSettingsDraft(DEFAULT_SETTINGS);
  let draftInitialized = false;
  let destroyed = false;
  let busy = false;
  let notice = "";
  let noticeError = false;
  let sequence = 0;
  let selection = ctx.getActiveChat();
  let selectionVersion = 0;
  let refreshFlight;
  let hud;
  let reminder;
  let pendingReminderChatId = null;
  const createdChatIds = new Map;
  let extrasActions = [];
  let pickerModal;
  let pickerOpen = false;
  let promptCountContent = "";
  let promptCountDisplay = null;
  let promptCountSequence = 0;
  const pending = new Map;
  let componentHandles = [];
  const disposers = [];
  function clearComponents() {
    for (const handle of componentHandles)
      handle.destroy();
    componentHandles = [];
  }
  function rpc(action, input = {}) {
    if (destroyed)
      return Promise.reject(new Error("Waypoints is closed."));
    const requestId = "wp-" + String(++sequence) + "-" + Date.now().toString(36);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Waypoints did not respond in time."));
      }, 30000);
      pending.set(requestId, { resolve: (value) => resolve(value), reject, timer });
      try {
        ctx.sendToBackend({ type: "waypoints:request", requestId, action, input });
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  function setNotice(message, error = false) {
    notice = message;
    noticeError = error;
  }
  function currentChatId() {
    return ctx.getActiveChat().chatId ?? undefined;
  }
  function requireCurrentChatId() {
    const chatId = currentChatId();
    if (!chatId || view?.chatId !== chatId)
      throw new Error("Wait for the active chat to load first.");
    return chatId;
  }
  function syncSelection() {
    if (destroyed)
      return false;
    const next = ctx.getActiveChat();
    if (next.chatId === selection.chatId && next.characterId === selection.characterId)
      return false;
    const chatChanged = next.chatId !== selection.chatId;
    if (chatChanged) {
      dismissReminder();
      pendingReminderChatId = next.chatId;
    }
    selection = next;
    selectionVersion += 1;
    refreshFlight = undefined;
    view = null;
    busy = false;
    setNotice("");
    refreshPromptCount("");
    pickerModal?.dismiss();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("The active chat changed."));
    }
    pending.clear();
    render();
    syncActionControls();
    syncHud();
    return true;
  }
  function dismissReminder() {
    if (!reminder)
      return;
    clearInterval(reminder.interval);
    reminder.widget.destroy();
    reminder = undefined;
  }
  function updateReminder() {
    if (!reminder)
      return;
    const remaining = Math.max(0, reminder.deadline - Date.now());
    reminder.count.textContent = String(Math.ceil(remaining / 1000)) + "s";
    reminder.progress.style.transform = "scaleX(" + String(remaining / reminder.durationMs) + ")";
    if (remaining === 0)
      chooseReminder(reminder.chatId, reminder.version, view?.settings.reminderTimeoutAction !== "no");
  }
  function chooseReminder(chatId, version, enabled) {
    dismissReminder();
    if (destroyed || version !== selectionVersion || ctx.getActiveChat().chatId !== chatId)
      return;
    safely(async () => {
      await rpc("set-chat-enabled", { chatId, enabled });
      await load();
    });
  }
  function maybeShowReminder() {
    if (!view || !pendingReminderChatId || pendingReminderChatId !== view.chatId)
      return;
    const chatId = pendingReminderChatId;
    pendingReminderChatId = null;
    if (!view.settings.reminderToast || !view.grantedPermissions.includes("ui_panels") || !view.greetings.length)
      return;
    const createdAt = createdChatIds.get(chatId);
    createdChatIds.delete(chatId);
    const durationMs = createdAt !== undefined && Date.now() - createdAt < 60000 ? 1e4 : 5000;
    let widget;
    try {
      const viewportWidth = document.defaultView?.innerWidth ?? 1280;
      const options = {
        width: 316,
        height: 112,
        initialPosition: { x: Math.max(12, viewportWidth - 332), y: 68 },
        snapToEdge: true,
        chromeless: true,
        tooltip: "Waypoints chat reminder",
        persistGeometry: "chat-reminder"
      };
      widget = ctx.ui.createFloatWidget(options);
    } catch (error) {
      console.warn("[Waypoints] reminder widget unavailable", error);
      return;
    }
    const version = selectionVersion;
    const card = element("div", "wp-reminder-card");
    card.setAttribute("role", "status");
    card.append(element("div", "wp-reminder-title", view.chatEnabled ? "Waypoints is active" : "Waypoints is off"));
    card.append(element("div", "wp-reminder-copy", "Use Waypoints for this chat?"));
    const actions = element("div", "wp-reminder-actions");
    const count = element("span", "wp-reminder-count", String(durationMs / 1000) + "s");
    actions.append(count, button("No", () => chooseReminder(chatId, version, false)), button("Yes", () => chooseReminder(chatId, version, true), "primary"));
    card.append(actions);
    const track = element("div", "wp-reminder-track");
    const progress = element("div", "wp-reminder-progress");
    track.append(progress);
    card.append(track);
    widget.root.className = "wp-reminder";
    widget.root.replaceChildren(card);
    reminder = { chatId, version, widget, durationMs, deadline: Date.now() + durationMs, interval: setInterval(updateReminder, 50), count, progress };
    updateReminder();
  }
  function isCurrentSelection(version) {
    if (destroyed)
      return false;
    if (syncSelection())
      refresh();
    return version === selectionVersion;
  }
  function refresh() {
    if (destroyed)
      return;
    const loading = load();
    const version = selectionVersion;
    loading.catch((error) => {
      if (!isCurrentSelection(version))
        return;
      setNotice(error instanceof Error ? error.message : String(error), true);
      render();
    });
  }
  function refreshPromptCount(content) {
    if (!content) {
      promptCountContent = "";
      promptCountDisplay = null;
      promptCountSequence += 1;
      return;
    }
    if (content === promptCountContent && promptCountDisplay !== null)
      return;
    const sequenceAtStart = ++promptCountSequence;
    const characterCount = content.length;
    promptCountContent = content;
    promptCountDisplay = "Counting… / " + String(characterCount) + " Characters";
    (async () => {
      let tokenCount = approximatePromptTokenCount(characterCount);
      let approximate = true;
      try {
        const result = ctx.tokens ? await ctx.tokens.countText(content) : undefined;
        if (result && Number.isFinite(result.total_tokens)) {
          tokenCount = result.total_tokens;
          approximate = result.approximate || result.tokenizer_id === null;
        }
      } catch {}
      if (destroyed || sequenceAtStart !== promptCountSequence || promptCountContent !== content)
        return;
      promptCountDisplay = formatPromptCount(tokenCount, characterCount, approximate);
      if (page === "waypoints")
        render();
    })();
  }
  function updateDraftValidation(target) {
    const result = draftValidation(draft);
    target.className = "wp-validation " + (result.valid ? "good" : "bad");
    target.textContent = result.valid ? result.messages.length ? result.messages.join(" ") : "Draft is ready to save." : result.messages.join(" ");
  }
  function addField(parent, label, help, mount) {
    const wrap = element("div", "wp-field");
    wrap.append(element("label", "wp-label", label));
    if (help)
      wrap.append(element("p", "wp-help", help));
    const target = element("div", "wp-native");
    wrap.append(target);
    parent.append(wrap);
    componentHandles.push(mount(target));
  }
  async function load() {
    if (destroyed)
      return;
    syncSelection();
    if (refreshFlight) {
      refreshFlight.queued = true;
      return refreshFlight.promise;
    }
    const flight = { version: selectionVersion, queued: false, promise: Promise.resolve() };
    refreshFlight = flight;
    flight.promise = (async () => {
      do {
        flight.queued = false;
        const chatId = selection.chatId;
        const loaded = asView(await rpc("refresh", { chatId }));
        if (!isCurrentSelection(flight.version))
          throw new Error("The active chat changed.");
        if (!loaded || loaded.chatId !== null && loaded.chatId !== chatId) {
          throw new Error("Waypoints returned an invalid status.");
        }
        view = loaded;
        if (!draftInitialized) {
          draft = cloneSettingsDraft(loaded.settings);
          draftInitialized = true;
        }
        refreshPromptCount(loaded.prompt.content);
        render();
        syncActionControls();
        syncHud();
        if (reminder && !loaded.settings.reminderToast)
          dismissReminder();
        maybeShowReminder();
      } while (flight.queued);
    })().finally(() => {
      if (refreshFlight === flight)
        refreshFlight = undefined;
    });
    return flight.promise;
  }
  async function safely(action) {
    if (destroyed)
      return;
    if (syncSelection()) {
      refresh();
      return;
    }
    if (busy)
      return;
    const version = selectionVersion;
    busy = true;
    try {
      syncActionControls();
      syncHud();
      render();
      await action();
    } catch (error) {
      if (isCurrentSelection(version))
        setNotice(error instanceof Error ? error.message : String(error), true);
    } finally {
      if (isCurrentSelection(version)) {
        busy = false;
        render();
        syncActionControls();
        syncHud();
      }
    }
  }
  async function toggleChatEnabled() {
    if (!view)
      throw new Error("Open a chat first.");
    const chatId = requireCurrentChatId();
    await rpc("set-chat-enabled", { chatId, enabled: !view.chatEnabled });
    await load();
  }
  async function forceTransition() {
    const result = await rpc("force", { chatId: requireCurrentChatId() });
    const transition = isRecord2(result) ? safeTransitionText(result.transition) : "";
    if (transition)
      setNotice(transition);
    await load();
  }
  async function undoTransition() {
    const result = await rpc("undo", { chatId: requireCurrentChatId() });
    const transition = isRecord2(result) ? safeTransitionText(result.transition) : "";
    if (transition)
      setNotice(transition);
    await load();
  }
  function openPickerSafely(kind) {
    const version = selectionVersion;
    openGreetingPicker(kind).catch((error) => {
      if (!isCurrentSelection(version))
        return;
      setNotice(error instanceof Error ? error.message : String(error), true);
      render();
      syncActionControls();
    });
  }
  async function openGreetingPicker(kind) {
    if (!isCurrentSelection(selectionVersion))
      return;
    if (pickerOpen || busy || !view)
      return;
    const version = selectionVersion;
    const currentView = view;
    const options = greetingPickerOptions(kind, currentView);
    if (!options.length) {
      setNotice(kind === "current" ? "There are no greetings available for this chat." : "There is no later greeting available for this chat.", true);
      render();
      return;
    }
    const preferred = kind === "current" ? currentView.active : currentView.upcoming;
    let selected = options.find((greeting) => preferred && selectionValue(greeting) === selectionValue(preferred)) ?? options[0];
    const openedChatId = currentChatId();
    if (!openedChatId) {
      setNotice("Open a chat before choosing a greeting.", true);
      render();
      return;
    }
    let modal;
    try {
      modal = ctx.ui.showModal({
        title: kind === "current" ? "Choose Current Greeting" : "Choose Next Greeting",
        width: 1040,
        maxHeight: 1000,
        persistent: false
      });
    } catch (error2) {
      throw new Error("Could not open the greeting picker: " + (error2 instanceof Error ? error2.message : String(error2)));
    }
    pickerModal = modal;
    pickerOpen = true;
    const picker = element("div", "wp-picker");
    const main = element("div", "wp-picker-main");
    const groupLabel = currentView.isGroupChat ? "Group chat: " + String(currentView.characters.length) + " characters" : "Character: " + (currentView.characters[0]?.name || "(unnamed)");
    main.append(element("div", "wp-picker-meta", groupLabel));
    const field = element("div", "wp-picker-field");
    const selectLabel = element("label", "wp-picker-label", kind === "current" ? "Current greeting" : "Next greeting");
    const select = element("select", "wp-picker-select");
    select.id = "wp-picker-select-" + kind;
    selectLabel.htmlFor = select.id;
    for (const greeting of options) {
      const option = element("option", "", greetingLabel(greeting));
      option.value = selectionValue(greeting);
      option.selected = selectionValue(greeting) === selectionValue(selected);
      select.append(option);
    }
    field.append(selectLabel, select);
    main.append(field);
    const selectedLabel = element("div", "wp-picker-meta");
    const hint = element("div", "wp-picker-meta", kind === "current" ? "The selected greeting becomes current. The next greeting is recalculated only when needed." : "The current greeting remains unchanged.");
    const preview = element("div", "wp-picker-preview");
    const previewText = element("pre", "", "");
    preview.append(previewText);
    const error = element("div", "wp-picker-error");
    error.hidden = true;
    main.append(selectedLabel, hint, preview, error);
    const footer = element("div", "wp-picker-footer");
    const cancel = element("button", "wp-button", "Cancel");
    cancel.type = "button";
    const confirm = element("button", "wp-button primary", kind === "current" ? "Use current greeting" : "Use next greeting");
    confirm.type = "button";
    footer.append(cancel, confirm);
    picker.append(main, footer);
    modal.root.replaceChildren(picker);
    const updateSelection = (greeting) => {
      selected = greeting;
      selectedLabel.textContent = "Selected: " + greetingLabel(greeting);
      previewText.textContent = greeting.text || "(empty)";
    };
    updateSelection(selected);
    select.onchange = () => {
      const next = options.find((greeting) => selectionValue(greeting) === select.value);
      if (next)
        updateSelection(next);
    };
    return new Promise((resolve) => {
      let settled = false;
      let committing = false;
      let unsubscribeDismiss;
      const finish = (dismiss = true) => {
        if (settled)
          return;
        settled = true;
        unsubscribeDismiss?.();
        if (pickerModal === modal)
          pickerModal = undefined;
        pickerOpen = false;
        if (dismiss)
          modal.dismiss();
        resolve();
      };
      const showError = (message) => {
        error.hidden = false;
        error.textContent = message;
        confirm.disabled = false;
        cancel.disabled = false;
        select.disabled = false;
      };
      const commit = async () => {
        const chosen = selected;
        if (settled || !isCurrentSelection(version) || !chosen || committing || busy)
          return;
        committing = true;
        busy = true;
        confirm.disabled = true;
        cancel.disabled = true;
        select.disabled = true;
        syncActionControls();
        try {
          if (currentChatId() !== openedChatId)
            throw new Error("The active chat changed; choose the greeting again.");
          await rpc(kind === "current" ? "set-active" : "set-upcoming", {
            chatId: openedChatId,
            selection: { characterId: chosen.characterId, greetingIndex: chosen.greetingIndex }
          });
          await load();
          setNotice(kind === "current" ? "Current greeting updated." : "Next greeting updated.");
          render();
          finish();
        } catch (errorValue) {
          if (isCurrentSelection(version))
            showError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        } finally {
          committing = false;
          if (isCurrentSelection(version)) {
            busy = false;
            render();
            syncActionControls();
            syncHud();
          }
        }
      };
      unsubscribeDismiss = modal.onDismiss(() => finish(false));
      cancel.onclick = () => finish();
      confirm.onclick = () => {
        commit();
      };
    });
  }
  async function openActionBarMenu() {
    if (!isCurrentSelection(selectionVersion))
      return;
    if (!actionBarButton || busy || !view)
      return;
    const version = selectionVersion;
    const rect = actionBarButton.getBoundingClientRect();
    let result;
    try {
      result = await ctx.ui.showContextMenu({
        position: { x: rect.left, y: rect.bottom + 4 },
        items: [
          {
            key: "toggle",
            label: view.chatEnabled ? "Disable Waypoints for this chat" : "Enable Waypoints for this chat",
            active: view.chatEnabled,
            disabled: !view.chatId
          },
          { key: "choose-current", label: "Choose current greeting", disabled: greetingPickerOptions("current", view).length === 0 },
          { key: "choose-next", label: "Choose next greeting", disabled: greetingPickerOptions("next", view).length === 0 },
          { key: "force", label: "Force next greeting", disabled: !view.upcoming || busy },
          { key: "undo", label: "Undo last insertion", disabled: !view.canUndo || busy },
          { key: "divider", label: "", type: "divider" },
          { key: "open", label: "Open Waypoints drawer" }
        ]
      });
    } catch (error) {
      if (!isCurrentSelection(version))
        return;
      setNotice(error instanceof Error ? error.message : String(error), true);
      render();
      return;
    }
    if (!isCurrentSelection(version))
      return;
    if (result.selectedKey === "toggle")
      safely(toggleChatEnabled);
    else if (result.selectedKey === "choose-current")
      openPickerSafely("current");
    else if (result.selectedKey === "choose-next")
      openPickerSafely("next");
    else if (result.selectedKey === "force")
      safely(forceTransition);
    else if (result.selectedKey === "undo")
      safely(undoTransition);
    else if (result.selectedKey === "open")
      tab.activate();
  }
  function syncActionControls() {
    const settings = view?.settings;
    const actionBarVisible = settings?.actionBarButton === true;
    if (actionBarMount)
      actionBarMount.hidden = !actionBarVisible;
    if (actionBarButton) {
      actionBarButton.hidden = !actionBarVisible;
      actionBarButton.disabled = busy || !view;
      actionBarButton.title = view?.chatId ? "Waypoints controls — " + (view.chatEnabled ? "ON" : "OFF") : "Waypoints controls";
      actionBarButton.setAttribute("aria-label", actionBarButton.title);
    }
    const extrasVisible = settings?.extrasActions === true && !busy && Boolean(view?.chatId);
    for (const action of extrasActions)
      action.setEnabled(extrasVisible);
    if (extrasActions.length < 5)
      return;
    extrasActions[0].setLabel(view?.chatEnabled ? "Disable Waypoints for this chat" : "Enable Waypoints for this chat");
    extrasActions[0].setSubtitle("Changes only this chat");
    extrasActions[1].setLabel("Choose current greeting");
    extrasActions[1].setSubtitle("Select the greeting Waypoints treats as current");
    extrasActions[2].setLabel("Choose next greeting");
    extrasActions[2].setSubtitle("Select the upcoming greeting Waypoints will use");
    extrasActions[3].setLabel("Undo last Waypoints insertion");
    extrasActions[3].setSubtitle(view?.canUndo ? "Remove the latest Waypoints greeting" : "No Waypoints insertion available");
    extrasActions[4].setLabel("Force next Waypoints greeting");
    extrasActions[4].setSubtitle(view?.upcoming ? "Insert the selected upcoming greeting" : "Choose an upcoming greeting first");
  }
  function registerExtrasActions() {
    const registered = [];
    try {
      registered.push(ctx.ui.registerInputBarAction({
        id: "toggle-waypoints",
        label: "Toggle Waypoints",
        subtitle: "Enable or disable Waypoints for this chat",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "choose-current-waypoints",
        label: "Choose current greeting",
        subtitle: "Select the greeting Waypoints treats as current",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "choose-next-waypoints",
        label: "Choose next greeting",
        subtitle: "Select the upcoming greeting Waypoints will use",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "undo-waypoints",
        label: "Undo last Waypoints insertion",
        subtitle: "Remove the latest Waypoints greeting",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "force-waypoints",
        label: "Force next Waypoints greeting",
        subtitle: "Insert the selected upcoming greeting",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      extrasActions = registered;
      disposers.push(registered[0].onClick(() => {
        safely(toggleChatEnabled);
      }), registered[1].onClick(() => openPickerSafely("current")), registered[2].onClick(() => openPickerSafely("next")), registered[3].onClick(() => {
        safely(undoTransition);
      }), registered[4].onClick(() => {
        safely(forceTransition);
      }));
    } catch (error) {
      for (const action of registered)
        action.destroy();
      console.warn("[Waypoints] Extras actions unavailable", error);
    }
  }
  if (actionBarButton)
    actionBarButton.onclick = () => {
      openActionBarMenu();
    };
  registerExtrasActions();
  function button(label, action, className = "", disabled = false) {
    const node = element("button", "wp-button" + (className ? " " + className : ""), label);
    node.type = "button";
    node.disabled = disabled || busy;
    const version = selectionVersion;
    node.onclick = () => {
      if (isCurrentSelection(version))
        action();
    };
    return node;
  }
  function renderNotice(parent) {
    if (!notice)
      return;
    parent.append(element("div", "wp-notice" + (noticeError ? " error" : ""), notice));
  }
  function renderTabs(parent) {
    const tabs = element("div", "wp-tabs");
    tabs.setAttribute("role", "tablist");
    for (const descriptor of [
      ["waypoints", "Waypoints"],
      ["settings", "Settings"]
    ]) {
      const targetPage = descriptor[0];
      const node = element("button", "wp-tab", descriptor[1]);
      node.type = "button";
      node.setAttribute("role", "tab");
      node.setAttribute("aria-selected", String(page === targetPage));
      node.onclick = () => {
        page = targetPage;
        render();
      };
      tabs.append(node);
    }
    parent.append(tabs);
  }
  function renderPicker(parent, label, selectedGreeting, allowClear, changed) {
    const currentView = view;
    if (!currentView)
      return;
    const version = selectionVersion;
    addField(parent, label, currentView.isGroupChat ? "All group members' greetings are available here." : "", (target) => ctx.components.mountSelect(target, {
      value: selectionValue(selectedGreeting),
      clearable: allowClear,
      clearLabel: "No upcoming greeting",
      placeholder: "Choose a greeting",
      options: currentView.greetings.map((greeting) => ({
        value: selectionValue(greeting),
        label: greetingLabel(greeting),
        group: greeting.characterName
      })),
      onChange: (value) => {
        if (!isCurrentSelection(version))
          return;
        const selection2 = parseSelection(value);
        if (!selection2 && !allowClear)
          return;
        safely(async () => {
          const chatId = currentChatId();
          if (!chatId)
            throw new Error("Open a chat first.");
          await changed(selection2);
          await load();
        });
      }
    }));
  }
  function renderDashboard(parent) {
    if (!view) {
      parent.append(element("div", "wp-card", "Loading Waypoints…"));
      return;
    }
    if (view.missingPermissions.length) {
      parent.append(element("div", "wp-alert", "Automatic handoffs are unavailable until these permissions are granted: " + view.missingPermissions.join(", ") + "."));
    }
    const status = element("section", "wp-card");
    const heading = element("div", "wp-row between");
    const headingText = element("div");
    headingText.append(element("div", "wp-kicker", view.isGroupChat ? "Group chat" : "Character chat"));
    headingText.append(element("h3", "", "Status"));
    heading.append(headingText);
    heading.append(button("Refresh", refresh));
    status.append(heading, element("p", "wp-muted", view.status));
    if (view.chatId) {
      const chatRow = element("div", "wp-character");
      chatRow.append(element("div", "wp-character-name", "Use Waypoints in this chat"));
      const chatTarget = element("div", "wp-native");
      chatRow.append(chatTarget);
      status.append(chatRow);
      componentHandles.push(ctx.components.mountSwitch(chatTarget, {
        checked: view.chatEnabled,
        ariaLabel: "Use Waypoints in this chat",
        onChange: (checked) => {
          safely(async () => {
            await rpc("set-chat-enabled", { chatId: requireCurrentChatId(), enabled: checked });
            await load();
          });
        }
      }));
    }
    parent.append(status);
    const selections = element("section", "wp-section");
    selections.append(element("h3", "", "Greeting path"));
    const grid = element("div", "wp-grid");
    selections.append(grid);
    renderPicker(grid, "Active greeting", view.active, false, async (selection2) => {
      await rpc("set-active", { chatId: currentChatId(), selection: selection2 });
    });
    renderPicker(grid, "Upcoming greeting", view.upcoming, true, async (selection2) => {
      await rpc("set-upcoming", { chatId: currentChatId(), selection: selection2 });
    });
    const previews = element("div", "wp-grid");
    const activePreview = element("div", "wp-field");
    activePreview.append(element("label", "wp-label", "Active preview"));
    activePreview.append(element("pre", "wp-preview", view.active ? compactPreview(view.active.text) : "No active greeting."));
    const upcomingPreview = element("div", "wp-field");
    upcomingPreview.append(element("label", "wp-label", "Upcoming preview"));
    upcomingPreview.append(element("pre", "wp-preview", view.upcoming ? compactPreview(view.upcoming.text) : "No upcoming greeting."));
    previews.append(activePreview, upcomingPreview);
    selections.append(previews);
    const actions = element("div", "wp-actions");
    actions.append(button("Force", () => safely(forceTransition), "primary", !view.upcoming), button("Undo", () => safely(undoTransition), "", !view.canUndo));
    selections.append(actions);
    parent.append(selections);
    const enabled = element("section", "wp-section");
    enabled.append(element("h3", "", view.isGroupChat ? "Group member switches" : "Character switch"));
    enabled.append(element("p", "wp-help", view.isGroupChat ? "Each group member has a per-chat override. New members default to ON." : "This character's Waypoints switch is stored on the character card."));
    for (const character of view.characters) {
      const version = selectionVersion;
      const row = element("div", "wp-character");
      const names = element("div");
      names.append(element("div", "wp-character-name", character.name || "Unnamed character"));
      names.append(element("div", "wp-help", character.enabled ? "ON" : "OFF"));
      const mount = element("div", "wp-native");
      row.append(names, mount);
      enabled.append(row);
      componentHandles.push(ctx.components.mountSwitch(mount, {
        checked: character.enabled,
        ariaLabel: "Enable Waypoints for " + character.name,
        onChange: (checked) => {
          if (!isCurrentSelection(version))
            return;
          safely(async () => {
            await rpc("set-enabled", {
              chatId: currentChatId(),
              characterId: character.id,
              enabled: checked
            });
            await load();
          });
        }
      }));
    }
    parent.append(enabled);
    const prompt = element("section", "wp-section");
    prompt.append(element("h3", "", "Rendered prompt status"));
    const promptText = view.prompt.ready ? view.prompt.autoPrompt ? "Auto-prompt is ON." : "Auto-prompt is OFF; add {{waypoints_content}} to a Loom preset to inject it." : view.prompt.reason ?? "No prompt is available.";
    prompt.append(element("p", "wp-muted", promptText + " Role: " + view.prompt.role + ". Depth: " + String(view.prompt.insertionDepth) + "."));
    if (view.prompt.content) {
      prompt.append(element("div", "wp-prompt-count", promptCountDisplay ?? "Counting… / " + String(view.prompt.content.length) + " Characters"));
      const details2 = element("details", "wp-diagnostics");
      details2.append(element("summary", "", "Show rendered prompt"));
      details2.append(element("pre", "wp-preview", view.prompt.content));
      prompt.append(details2);
    }
    parent.append(prompt);
    const diagnostics = element("section", "wp-section");
    diagnostics.append(element("h3", "", "Diagnostics"));
    const diagActions = element("div", "wp-actions");
    diagActions.append(button("Copy diagnostics", () => safely(async () => {
      const text = view?.diagnostics.join(`
`) ?? "";
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard access is unavailable in this Lumiverse window.");
      await navigator.clipboard.writeText(text);
      setNotice("Diagnostics copied.");
    })), button("Clear diagnostics", () => safely(async () => {
      await rpc("clear-diagnostics", { chatId: currentChatId() });
      await load();
      setNotice("Diagnostics cleared.");
    })));
    diagnostics.append(diagActions);
    const details = element("details", "wp-diagnostics");
    details.append(element("summary", "", "Show " + String(view.diagnostics.length) + " recent lines"));
    details.append(element("pre", "wp-preview", view.diagnostics.join(`
`) || "No diagnostic lines yet."));
    diagnostics.append(details);
    parent.append(diagnostics);
    if (view.settings.floatingControls && !canShowHud(true, view.grantedPermissions)) {
      parent.append(element("div", "wp-alert", "Floating controls are enabled in Settings, but ui_panels permission is not granted. The drawer still works."));
    }
  }
  function safeTransitionText(value) {
    if (!isRecord2(value) || typeof value.reason !== "string")
      return "";
    return value.reason;
  }
  function renderSettings(parent) {
    const settings = element("section", "wp-section");
    settings.append(element("h3", "", "Settings"));
    settings.append(element("p", "wp-help", "Edits stay in this draft until you select Save settings. Invalid drafts never change live behavior."));
    const validation = element("div", "wp-validation");
    updateDraftValidation(validation);
    settings.append(validation);
    settings.append(element("h4", "", "Prompt"));
    addField(settings, "Scene-shaping template", "Required placeholders: {{scene_excerpt}} and {{handoff_tag}}. {{override_tag}} is optional but recommended.", (target) => ctx.components.mountTextArea(target, {
      value: draft.promptTemplate,
      rows: 16,
      ariaLabel: "Scene-shaping template",
      onChange: (value) => {
        draft.promptTemplate = value;
        updateDraftValidation(validation);
      }
    }));
    const promptGrid = element("div", "wp-grid");
    settings.append(promptGrid);
    addField(promptGrid, "Prewritten-scene limit", "Characters retained after exclusion filtering.", (target) => ctx.components.mountNumericInput(target, {
      value: draft.prewrittenSceneCharLimit,
      integer: true,
      min: 1,
      max: 1e5,
      onChange: (value) => {
        if (value !== null)
          draft.prewrittenSceneCharLimit = value;
        updateDraftValidation(validation);
      }
    }));
    addField(promptGrid, "Exclusion regex", "Accepts /pattern/flags. The LumiScript-style x flag removes spaces and # comments outside character classes.", (target) => ctx.components.mountTextInput(target, {
      value: draft.promptExcludeRegex,
      placeholder: "/private block/gi",
      onChange: (value) => {
        draft.promptExcludeRegex = value;
        updateDraftValidation(validation);
      }
    }));
    addField(promptGrid, "Prompt insertion depth", "0 is the newest edge of the assembled prompt.", (target) => ctx.components.mountNumericInput(target, {
      value: draft.insertionDepth,
      integer: true,
      min: 0,
      max: 9999,
      onChange: (value) => {
        if (value !== null)
          draft.insertionDepth = value;
        updateDraftValidation(validation);
      }
    }));
    addField(promptGrid, "Prompt role", "Use system unless your connection requires another role.", (target) => ctx.components.mountSelect(target, {
      value: draft.promptRole,
      options: [
        { value: "system", label: "system" },
        { value: "user", label: "user" },
        { value: "assistant", label: "assistant" }
      ],
      onChange: (value) => {
        if (value === "system" || value === "user" || value === "assistant")
          draft.promptRole = value;
        updateDraftValidation(validation);
      }
    }));
    const autoTarget = element("div", "wp-native");
    settings.append(autoTarget);
    componentHandles.push(ctx.components.mountCheckbox(autoTarget, {
      checked: draft.autoPrompt,
      label: "Automatically insert the rendered prompt before generation",
      hint: "Off by default. Keep it off when a Loom preset injects {{waypoints_content}}, so the prompt is not added twice.",
      onChange: (checked) => {
        draft.autoPrompt = checked;
        updateDraftValidation(validation);
      }
    }));
    const loomHelp = element("div", "wp-loom-help");
    loomHelp.append(element("div", "wp-label", "Loom preset macros"));
    loomHelp.append(element("p", "wp-help", "Use these extension macros in a Loom block. They are not local variables, so do not add a leading dot."));
    loomHelp.append(element("pre", "wp-preview", `{{if::{{waypoints_active}}}}
{{waypoints_content}}
{{/if}}`));
    loomHelp.append(element("p", "wp-help", "Pre-run council tools can also use {{altMessage1}}, {{altMessage2}}, and so on for this character's alternate greetings. {{altMessages}} returns them as a JSON array; the standard {{firstMessage}} is separate. Higher altMessage indices are unregistered when switching to a character with fewer alternate greetings. {{nextMessages}} returns the choices offered by Waypoints' next-greeting picker (only later greetings in solo chats). {{currentMessage}} and {{nextMessage}} return the selected current and upcoming greetings."));
    settings.append(loomHelp);
    settings.append(element("div", "wp-divider"));
    settings.append(element("h4", "", "Handoff"));
    const handoffGrid = element("div", "wp-grid");
    settings.append(handoffGrid);
    let updateHandoffPreviews = () => {};
    addField(handoffGrid, "Handoff tag name", "Waypoints recognizes both self-closing and paired forms.", (target) => ctx.components.mountTextInput(target, {
      value: draft.handoffTagName,
      onChange: (value) => {
        draft.handoffTagName = value;
        updateDraftValidation(validation);
        updateHandoffPreviews();
      }
    }));
    addField(handoffGrid, "User override tag name", "A user can request the closest viable handoff with this marker.", (target) => ctx.components.mountTextInput(target, {
      value: draft.overrideTagName,
      onChange: (value) => {
        draft.overrideTagName = value;
        updateDraftValidation(validation);
        updateHandoffPreviews();
      }
    }));
    const previews = element("p", "wp-help");
    previews.append("Live previews: ");
    const handoffPreview = element("code", "wp-code", handoffTag(draft));
    const overridePreview = element("code", "wp-code", overrideTag(draft));
    previews.append(handoffPreview);
    previews.append(document.createTextNode(" and "));
    previews.append(overridePreview);
    settings.append(previews);
    updateHandoffPreviews = () => {
      handoffPreview.textContent = handoffTag(draft);
      overridePreview.textContent = overrideTag(draft);
    };
    settings.append(element("div", "wp-divider"));
    settings.append(element("h4", "", "Advanced"));
    const advancedGrid = element("div", "wp-grid");
    settings.append(advancedGrid);
    const numericFields = [
      ["interceptorPriority", "Interceptor priority", "Lower priorities run first.", 0, 1000],
      ["contentProcessorPriority", "Content-processor priority", "Lower priorities run first.", 0, 1000],
      ["activeChatRetryAttempts", "Active-chat retries", "Attempts while a chat switch settles.", 1, 25],
      ["activeChatRetryDelayMs", "Active-chat retry delay (ms)", "Delay between active-chat retries.", 0, 2000],
      ["handoffReadRetryAttempts", "Handoff-read retries", "Attempts while a handoff message settles.", 1, 25],
      ["handoffReadRetryDelayMs", "Handoff-read retry delay (ms)", "Delay between handoff-read retries.", 0, 2000],
      ["pendingHandoffLimit", "Pending-handoff limit", "Recent handoff observations retained in chat state.", 1, 500],
      ["recentTransitionLimit", "Recent-transition limit", "Dedupe keys retained in chat state.", 1, 500],
      ["diagnosticLineLimit", "Diagnostic line limit", "Runtime diagnostic lines retained in the drawer.", 10, 500]
    ];
    for (const descriptor of numericFields) {
      const field = descriptor[0];
      addField(advancedGrid, descriptor[1], descriptor[2], (target) => ctx.components.mountNumericInput(target, {
        value: draft[field],
        integer: true,
        min: descriptor[3],
        max: descriptor[4],
        onChange: (value) => {
          if (value !== null)
            draft[field] = value;
          updateDraftValidation(validation);
        }
      }));
    }
    const diagnosticsTarget = element("div", "wp-native");
    settings.append(diagnosticsTarget);
    componentHandles.push(ctx.components.mountCheckbox(diagnosticsTarget, {
      checked: draft.diagnosticLogging,
      label: "Keep diagnostic logging",
      hint: "When off, new runtime diagnostic lines are not added.",
      onChange: (checked) => {
        draft.diagnosticLogging = checked;
        updateDraftValidation(validation);
      }
    }));
    settings.append(element("div", "wp-divider"));
    settings.append(element("h4", "", "Interface"));
    const hudTarget = element("div", "wp-native");
    settings.append(hudTarget);
    componentHandles.push(ctx.components.mountCheckbox(hudTarget, {
      checked: draft.floatingControls,
      label: "Show floating ON / Undo / Force controls",
      hint: "Enabled by default. Lumiverse owns its drag position and reset behavior.",
      onChange: (checked) => {
        draft.floatingControls = checked;
        updateDraftValidation(validation);
      }
    }));
    const reminderTarget = element("div", "wp-native");
    settings.append(reminderTarget);
    componentHandles.push(ctx.components.mountCheckbox(reminderTarget, {
      checked: draft.reminderToast,
      label: "Ask whether to use Waypoints when switching chats",
      hint: "Shows a brief floating reminder when a chat opens. Requires ui_panels permission.",
      onChange: (checked) => {
        draft.reminderToast = checked;
        updateDraftValidation(validation);
      }
    }));
    addField(settings, "When reminder time runs out", "New chats get 10 seconds; existing chats get 5 seconds.", (target) => ctx.components.mountSelect(target, {
      value: draft.reminderTimeoutAction,
      options: [{ value: "yes", label: "Yes — use Waypoints" }, { value: "no", label: "No — turn Waypoints off for this chat" }],
      onChange: (value) => {
        if (value === "yes" || value === "no")
          draft.reminderTimeoutAction = value;
        updateDraftValidation(validation);
      }
    }));
    const actionBarTarget = element("div", "wp-native");
    settings.append(actionBarTarget);
    componentHandles.push(ctx.components.mountCheckbox(actionBarTarget, {
      checked: draft.actionBarButton,
      label: "Show the compass button in the chat action bar",
      hint: "Adds a compact Waypoints menu beside the buttons above the input box.",
      onChange: (checked) => {
        draft.actionBarButton = checked;
        updateDraftValidation(validation);
      }
    }));
    const extrasTarget = element("div", "wp-native");
    settings.append(extrasTarget);
    componentHandles.push(ctx.components.mountCheckbox(extrasTarget, {
      checked: draft.extrasActions,
      label: "Show Waypoints actions in the Extras menu",
      hint: "Adds Toggle, Undo, and Force entries under Lumiverse's native Extras popover.",
      onChange: (checked) => {
        draft.extrasActions = checked;
        updateDraftValidation(validation);
      }
    }));
    const actions = element("div", "wp-actions");
    actions.append(button("Save settings", () => safely(async () => {
      const validationResult = draftValidation(draft);
      if (!validationResult.valid)
        throw new Error(validationResult.messages.join(" "));
      const result = safeRecord(await rpc("save-settings", { settings: draft }));
      const saved = isRecord2(result.settings) ? result.settings : null;
      if (saved) {
        draft = cloneSettingsDraft(saved);
        draftInitialized = true;
        const warnings = Array.isArray(result.warnings) ? result.warnings.filter((item) => typeof item === "string") : [];
        setNotice(warnings.length ? "Settings saved. " + warnings.join(" ") : "Settings saved.");
      }
      await load();
    }), "primary"), button("Discard draft", () => {
      if (view)
        draft = cloneSettingsDraft(view.settings);
      render();
    }), button("Reset defaults", () => safely(async () => {
      const result = safeRecord(await rpc("reset-settings"));
      const saved = isRecord2(result.settings) ? result.settings : null;
      if (saved) {
        draft = cloneSettingsDraft(saved);
        draftInitialized = true;
      }
      setNotice("Settings reset to defaults.");
      await load();
    }), "danger"));
    settings.append(actions);
    parent.append(settings);
  }
  function syncHud() {
    const visible = Boolean(view && canShowHud(view.settings.floatingControls, view.grantedPermissions));
    if (!visible) {
      hud?.destroy();
      hud = undefined;
      return;
    }
    if (!hud) {
      try {
        hud = ctx.ui.createFloatWidget({
          width: 245,
          height: 44,
          snapToEdge: true,
          tooltip: "Waypoints controls",
          chromeless: true
        });
      } catch {
        return;
      }
    }
    renderHud();
  }
  function renderHud() {
    if (!hud || !view)
      return;
    const root2 = hud.root;
    root2.replaceChildren();
    root2.className = "wp-hud";
    root2.append(element("span", "wp-hud-label", "Waypoints"));
    root2.append(button(view.chatEnabled ? "ON" : "OFF", () => safely(toggleChatEnabled), "", !view.chatId));
    root2.append(button("Undo", () => safely(undoTransition), "", !view.canUndo));
    root2.append(button("Force", () => safely(forceTransition), "primary", !view.upcoming));
  }
  function render() {
    if (destroyed)
      return;
    clearComponents();
    root.replaceChildren();
    const header = element("header", "wp-header");
    const intro = element("div");
    intro.append(element("h2", "", "Waypoints"));
    intro.append(element("p", "wp-muted", "Guide a chat through the next greeting without exposing its contents."));
    header.append(intro);
    header.append(button("Refresh", refresh));
    root.append(header);
    renderNotice(root);
    renderTabs(root);
    const pageRoot = element("div", "wp-page");
    pageRoot.setAttribute("role", "tabpanel");
    root.append(pageRoot);
    if (page === "waypoints")
      renderDashboard(pageRoot);
    else
      renderSettings(pageRoot);
  }
  disposers.push(ctx.onBackendMessage((payload) => {
    if (syncSelection())
      refresh();
    const message = safeRecord(payload);
    if (message.type === "waypoints:reply" && typeof message.requestId === "string") {
      const request = pending.get(message.requestId);
      if (!request)
        return;
      pending.delete(message.requestId);
      clearTimeout(request.timer);
      if (typeof message.error === "string" && message.error)
        request.reject(new Error(message.error));
      else
        request.resolve(message.result);
      return;
    }
    if (message.type === "waypoints:permission-denied" || typeof message.type === "string" && shouldRefreshDrawer(message.type)) {
      refresh();
    }
  }));
  disposers.push(tab.onActivate(refresh));
  disposers.push(ctx.events.on("CHAT_SWITCHED", refresh));
  disposers.push(ctx.events.on("CHAT_CHANGED", refresh));
  disposers.push(ctx.events.on("CHAT_CREATED", (payload) => {
    const data = safeRecord(payload);
    const chat = safeRecord(data.chat);
    const chatId = typeof data.id === "string" ? data.id : typeof chat.id === "string" ? chat.id : null;
    if (!chatId)
      return;
    createdChatIds.set(chatId, Date.now());
    if (reminder?.chatId === chatId && reminder.durationMs === 5000) {
      createdChatIds.delete(chatId);
      reminder.durationMs = 1e4;
      reminder.deadline += 5000;
      updateReminder();
    }
  }));
  const selectionChanged = () => {
    if (syncSelection())
      refresh();
  };
  let subscribed = false;
  try {
    if (ctx.state) {
      disposers.push(ctx.state.subscribe("chat.active", selectionChanged));
      subscribed = true;
    }
  } catch {}
  if (!subscribed) {
    const selectionTimer = setInterval(selectionChanged, 500);
    disposers.push(() => clearInterval(selectionTimer));
  }
  render();
  syncActionControls();
  ctx.ready();
  refresh();
  return () => {
    destroyed = true;
    clearComponents();
    for (const dispose of disposers)
      dispose();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Waypoints closed."));
    }
    pending.clear();
    dismissReminder();
    pickerModal?.dismiss();
    hud?.destroy();
    for (const action of extrasActions)
      action.destroy();
    actionBarMount?.replaceChildren();
    tab.destroy();
    removeStyle();
  };
}
export {
  setup
};
