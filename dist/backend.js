// @bun
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
  "UPCOMING PREWRITTEN SCENE \u2014 DIRECTION AND TIMING REFERENCE ONLY:",
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
function settingsFromStorage(input) {
  try {
    return validateSettings(input).settings;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

// src/prompt.ts
function escapeRegex(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}
function normalizeHandoffContent(content) {
  return String(content ?? "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\r\n?/g, `
`);
}
function handoffTag(settings) {
  return "<" + settings.handoffTagName + " />";
}
function overrideTag(settings) {
  return "--" + settings.overrideTagName + "--";
}
function handoffTagPattern(tagName) {
  const name = escapeRegex(tagName);
  const start = "<\\s*" + name + `(?=\\s|/|>)(?:[^>"']|"[^"]*"|'[^']*')*`;
  const selfClosing = start + "/\\s*>";
  const paired = start + ">([\\s\\S]*?)<\\s*/\\s*" + name + "\\s*>";
  return new RegExp(selfClosing + "|" + paired, "gi");
}
function stripHandoffTags(content, tagName) {
  const normalized = normalizeHandoffContent(content);
  let tagCount = 0;
  const stripped = normalized.replace(handoffTagPattern(tagName), () => {
    tagCount += 1;
    return "";
  });
  return {
    hasHandoff: tagCount > 0,
    tagCount,
    content: stripped.replace(/[ \t]+\n/g, `
`).replace(/\n{3,}/g, `

`).replace(/[ \t]{2,}/g, " ").trimEnd()
  };
}
function applyPromptExcludeRegex(scene, source) {
  const regex = compileExcludeRegex(source);
  return regex ? scene.replace(regex, "") : scene;
}
function substitute(template, placeholder, value) {
  return template.split(placeholder).join(value);
}
function renderPrompt(settings, scene) {
  const filteredScene = applyPromptExcludeRegex(scene, settings.promptExcludeRegex);
  const sceneExcerpt = filteredScene.slice(0, settings.prewrittenSceneCharLimit);
  let content = settings.promptTemplate;
  content = substitute(content, "{{scene_excerpt}}", sceneExcerpt);
  content = substitute(content, "{{handoff_tag}}", handoffTag(settings));
  content = substitute(content, "{{override_tag}}", overrideTag(settings));
  return { content, filteredScene, sceneExcerpt };
}
function insertAtDepth(messages, value, depth) {
  const insertionIndex = Math.max(0, messages.length - Math.max(0, depth));
  return [...messages.slice(0, insertionIndex), value, ...messages.slice(insertionIndex)];
}

// src/state.ts
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
}
function selectionFrom(value) {
  if (!isRecord2(value) || typeof value.characterId !== "string" || !Number.isInteger(value.greetingIndex))
    return null;
  return { characterId: value.characterId, greetingIndex: Number(value.greetingIndex) };
}
function journalFrom(value) {
  if (!isRecord2(value) || typeof value.id !== "string" || typeof value.eventKey !== "string")
    return null;
  const target = selectionFrom(value.target);
  if (!target)
    return null;
  const phase = value.phase === "appended" ? "appended" : value.phase === "prepared" ? "prepared" : null;
  if (!phase)
    return null;
  return {
    id: value.id,
    eventKey: value.eventKey,
    sourceMessageId: typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined,
    target,
    previousActive: selectionFrom(value.previousActive),
    previousUpcoming: selectionFrom(value.previousUpcoming),
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now(),
    phase,
    insertedMessageId: typeof value.insertedMessageId === "string" ? value.insertedMessageId : undefined
  };
}
function pendingFrom(value) {
  if (!Array.isArray(value))
    return [];
  return value.flatMap((entry) => {
    if (!isRecord2(entry) || typeof entry.eventKey !== "string" || typeof entry.contentHash !== "string")
      return [];
    return [{
      eventKey: entry.eventKey,
      contentHash: entry.contentHash,
      sourceMessageId: typeof entry.sourceMessageId === "string" ? entry.sourceMessageId : undefined,
      tagCount: Number.isInteger(entry.tagCount) ? Number(entry.tagCount) : 1,
      at: Number.isFinite(entry.at) ? Number(entry.at) : Date.now()
    }];
  });
}
function emptyChatState() {
  return {
    version: 1,
    active: null,
    upcoming: null,
    groupEnabledByCharacter: {},
    pendingHandoffs: [],
    recentTransitionKeys: [],
    journal: null
  };
}
function parseChatState(value) {
  if (!value)
    return emptyChatState();
  try {
    const parsed = JSON.parse(value);
    if (!isRecord2(parsed))
      return emptyChatState();
    const rawEnabled = isRecord2(parsed.groupEnabledByCharacter) ? parsed.groupEnabledByCharacter : {};
    const groupEnabledByCharacter = {};
    for (const [characterId, enabled] of Object.entries(rawEnabled)) {
      if (typeof enabled === "boolean")
        groupEnabledByCharacter[characterId] = enabled;
    }
    return {
      version: 1,
      active: selectionFrom(parsed.active),
      upcoming: selectionFrom(parsed.upcoming),
      groupEnabledByCharacter,
      pendingHandoffs: pendingFrom(parsed.pendingHandoffs),
      recentTransitionKeys: stringArray(parsed.recentTransitionKeys),
      journal: journalFrom(parsed.journal)
    };
  } catch {
    return emptyChatState();
  }
}
function serializeChatState(state) {
  return JSON.stringify(state);
}
function selectionKey(selection) {
  return selection ? selection.characterId + ":" + String(selection.greetingIndex) : "";
}
function sameSelection(left, right) {
  return selectionKey(left) === selectionKey(right);
}
function groupCharacterIds(chat) {
  const metadata = chat.metadata ?? {};
  const direct = stringArray(metadata.character_ids);
  const nested = isRecord2(metadata.group) ? stringArray(metadata.group.character_ids) : [];
  const ids = direct.length ? direct : nested;
  const unique = [...new Set(ids)];
  return unique.length > 1 ? unique : [chat.character_id];
}
function buildGreetingContext(chat, characters) {
  const characterIds = groupCharacterIds(chat);
  const included = characters.filter((character) => characterIds.includes(character.id));
  const greetings = [];
  for (const character of included) {
    const all = [character.first_mes, ...character.alternate_greetings ?? []];
    for (let greetingIndex = 0;greetingIndex < all.length; greetingIndex += 1) {
      const text = typeof all[greetingIndex] === "string" ? all[greetingIndex].trim() : "";
      if (text) {
        greetings.push({
          characterId: character.id,
          characterName: character.name || "Unnamed character",
          greetingIndex,
          text
        });
      }
    }
  }
  return {
    chatId: chat.id,
    primaryCharacterId: chat.character_id,
    isGroupChat: characterIds.length > 1,
    characterIds,
    characters: included,
    greetings
  };
}
function greetingForSelection(greetings, selection) {
  if (!selection)
    return null;
  return greetings.find((greeting) => greeting.characterId === selection.characterId && greeting.greetingIndex === selection.greetingIndex) ?? null;
}
function firstGreetingForCharacter(greetings, characterId) {
  const greeting = greetings.find((entry) => entry.characterId === characterId);
  return greeting ? { characterId: greeting.characterId, greetingIndex: greeting.greetingIndex } : null;
}
function nextGreetingForSelection(greetings, selection) {
  if (!selection)
    return null;
  const following = greetings.find((entry) => entry.characterId === selection.characterId && entry.greetingIndex > selection.greetingIndex);
  return following ? { characterId: following.characterId, greetingIndex: following.greetingIndex } : null;
}
function defaultSelections(context) {
  const active = firstGreetingForCharacter(context.greetings, context.primaryCharacterId) ?? (context.greetings[0] ? { characterId: context.greetings[0].characterId, greetingIndex: context.greetings[0].greetingIndex } : null);
  return { active, upcoming: nextGreetingForSelection(context.greetings, active) };
}
function reconcileChatState(state, context) {
  const defaults = defaultSelections(context);
  const active = greetingForSelection(context.greetings, state.active) ? state.active : defaults.active;
  let upcoming = greetingForSelection(context.greetings, state.upcoming) ? state.upcoming : nextGreetingForSelection(context.greetings, active);
  if (sameSelection(active, upcoming))
    upcoming = nextGreetingForSelection(context.greetings, active);
  const allowedCharacters = new Set(context.characterIds);
  const enabled = {};
  for (const [characterId, value] of Object.entries(state.groupEnabledByCharacter)) {
    if (allowedCharacters.has(characterId))
      enabled[characterId] = value;
  }
  return {
    ...state,
    active,
    upcoming,
    groupEnabledByCharacter: enabled
  };
}
function addRecentTransition(state, eventKey, limit) {
  state.recentTransitionKeys = [
    ...state.recentTransitionKeys.filter((entry) => entry !== eventKey),
    eventKey
  ].slice(-limit);
}
function removeRecentTransition(state, eventKey) {
  state.recentTransitionKeys = state.recentTransitionKeys.filter((entry) => entry !== eventKey);
}
function rememberPendingHandoff(state, pending, limit) {
  state.pendingHandoffs = [
    ...state.pendingHandoffs.filter((entry) => entry.eventKey !== pending.eventKey),
    pending
  ].slice(-limit);
}
function consumePendingHandoff(state, eventKey) {
  state.pendingHandoffs = state.pendingHandoffs.filter((entry) => entry.eventKey !== eventKey);
}

// src/types.ts
var EXTENSION_ID = "lumiverse_waypoints";
var CHAT_STATE_KEY = "lumiverse_waypoints.state.v1";
var SETTINGS_PATH = "settings.json";
var HANDOFF_EXTRA_KEY = "lumiverse_waypoints.handoff";
var INSERTED_GREETING_METADATA_KEY = "lumiverse_waypoints";

// src/engine.ts
var AUTOMATIC_PERMISSIONS = ["characters", "chats", "chat_mutation", "generation"];
var CONTEXT_PERMISSIONS = ["characters", "chats"];
function isRecord3(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function clone(value) {
  return structuredClone(value);
}
function journalId() {
  return "wp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function hashText(value) {
  let hash = 2166136261;
  for (let index = 0;index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function selected(selection) {
  return selection ? { characterId: selection.characterId, greetingIndex: selection.greetingIndex } : null;
}
function sourceCharacters(context) {
  return context.characters;
}
function asInsertedMetadata(value) {
  if (!isRecord3(value) || value.kind !== "inserted-greeting" || value.version !== 1)
    return null;
  if (typeof value.journalId !== "string" || typeof value.eventKey !== "string" || typeof value.contentHash !== "string")
    return null;
  if (!isRecord3(value.target) || typeof value.target.characterId !== "string" || !Number.isInteger(value.target.greetingIndex))
    return null;
  const selection = (candidate) => {
    if (!isRecord3(candidate) || typeof candidate.characterId !== "string" || !Number.isInteger(candidate.greetingIndex))
      return null;
    return { characterId: candidate.characterId, greetingIndex: Number(candidate.greetingIndex) };
  };
  return {
    kind: "inserted-greeting",
    version: 1,
    journalId: value.journalId,
    eventKey: value.eventKey,
    target: { characterId: value.target.characterId, greetingIndex: Number(value.target.greetingIndex) },
    previousActive: selection(value.previousActive),
    previousUpcoming: selection(value.previousUpcoming),
    sourceMessageId: typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined,
    contentHash: value.contentHash,
    insertedAt: Number.isFinite(value.insertedAt) ? Number(value.insertedAt) : 0
  };
}
function asHandoffExtra(value) {
  if (!isRecord3(value) || value.version !== 1 || typeof value.tagName !== "string")
    return null;
  return {
    version: 1,
    tagName: value.tagName,
    tagCount: Number.isInteger(value.tagCount) ? Number(value.tagCount) : 1,
    origin: typeof value.origin === "string" ? value.origin : "",
    contentHash: typeof value.contentHash === "string" ? value.contentHash : "",
    at: Number.isFinite(value.at) ? Number(value.at) : 0
  };
}
function messageMetadata(message) {
  return asInsertedMetadata(message.metadata?.[INSERTED_GREETING_METADATA_KEY]);
}
function messageExtraHandoff(message) {
  return asHandoffExtra(message.extra?.[HANDOFF_EXTRA_KEY]);
}

class WaypointEngine {
  api;
  userId;
  settingsChanged;
  settingsCache = null;
  queues = new Map;
  diagnosticsLines = [];
  constructor(api, userId, settingsChanged) {
    this.api = api;
    this.userId = userId;
    this.settingsChanged = settingsChanged;
  }
  note(message) {
    const settings = this.settingsCache;
    if (settings && !settings.diagnosticLogging)
      return;
    const line = new Date().toISOString() + " " + message;
    const limit = settings?.diagnosticLineLimit ?? DEFAULT_SETTINGS.diagnosticLineLimit;
    this.diagnosticsLines = [...this.diagnosticsLines, line].slice(-limit);
    this.api.log.info("[Waypoints] " + message);
  }
  warn(message) {
    this.note(message);
    this.api.log.warn("[Waypoints] " + message);
  }
  diagnostics() {
    return [...this.diagnosticsLines];
  }
  clearDiagnostics() {
    this.diagnosticsLines = [];
  }
  async settings() {
    if (!this.settingsCache) {
      const stored = await this.api.userStorage.getJson(SETTINGS_PATH, {
        fallback: {},
        userId: this.userId
      });
      this.settingsCache = settingsFromStorage(stored);
    }
    return clone(this.settingsCache);
  }
  async saveSettings(draft) {
    const validated = validateSettings(draft);
    await this.api.userStorage.setJson(SETTINGS_PATH, validated.settings, { userId: this.userId });
    this.settingsCache = clone(validated.settings);
    if (this.settingsChanged)
      await this.settingsChanged(clone(validated.settings), this.userId);
    this.note("settings saved");
    return { settings: clone(validated.settings), warnings: validated.warnings };
  }
  async resetSettings() {
    return this.saveSettings(clone(DEFAULT_SETTINGS));
  }
  missingPermissions(required) {
    return required.filter((permission) => !this.api.permissions.has(permission));
  }
  assertPermissions(required, action) {
    const missing = this.missingPermissions(required);
    if (missing.length) {
      throw new Error(action + " needs the " + missing.join(", ") + " permission" + (missing.length === 1 ? "" : "s") + ".");
    }
  }
  async serial(chatId, action) {
    const previous = this.queues.get(chatId) ?? Promise.resolve();
    const run = previous.catch(() => {
      return;
    }).then(action);
    this.queues.set(chatId, run.then(() => {
      return;
    }, () => {
      return;
    }));
    return run;
  }
  async getActiveChatId(settings) {
    this.assertPermissions(["chats"], "Finding the active chat");
    for (let attempt = 0;attempt < settings.activeChatRetryAttempts; attempt += 1) {
      const active = await this.api.chats.getActive(this.userId);
      if (active)
        return active.id;
      if (attempt + 1 < settings.activeChatRetryAttempts)
        await sleep(settings.activeChatRetryDelayMs);
    }
    return null;
  }
  async context(chatId) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Loading Waypoints");
    const chat = await this.api.chats.get(chatId, this.userId);
    if (!chat)
      throw new Error("The selected chat no longer exists.");
    const ids = groupCharacterIds(chat);
    const loaded = await Promise.all(ids.map((characterId) => this.api.characters.get(characterId, this.userId)));
    const characters = loaded.filter((character) => Boolean(character));
    return buildGreetingContext(chat, characters);
  }
  async state(chatId) {
    try {
      return parseChatState(await this.api.variables.chat.get(chatId, CHAT_STATE_KEY));
    } catch {
      return parseChatState(null);
    }
  }
  async persistState(chatId, state) {
    await this.api.variables.chat.set(chatId, CHAT_STATE_KEY, serializeChatState(state));
  }
  isCharacterEnabled(context, state, characterId) {
    if (context.isGroupChat)
      return state.groupEnabledByCharacter[characterId] !== false;
    const character = sourceCharacters(context).find((entry) => entry.id === characterId);
    const extensionData = character && isRecord3(character.extensions?.[EXTENSION_ID]) ? character.extensions?.[EXTENSION_ID] : null;
    return !isRecord3(extensionData) || extensionData.enabled !== false;
  }
  isSelectionEnabled(context, state, selection) {
    return selection !== null && this.isCharacterEnabled(context, state, selection.characterId);
  }
  promptStatus(context, state, settings) {
    const upcoming = greetingForSelection(context.greetings, state.upcoming);
    if (!upcoming) {
      return {
        ready: false,
        autoPrompt: settings.autoPrompt,
        role: settings.promptRole,
        insertionDepth: settings.insertionDepth,
        content: "",
        reason: "Choose an upcoming greeting to shape the scene."
      };
    }
    if (!this.isSelectionEnabled(context, state, state.upcoming)) {
      return {
        ready: false,
        autoPrompt: settings.autoPrompt,
        role: settings.promptRole,
        insertionDepth: settings.insertionDepth,
        content: "",
        reason: "The upcoming greeting's character is turned off."
      };
    }
    const rendered = renderPrompt(settings, upcoming.text);
    return {
      ready: true,
      autoPrompt: settings.autoPrompt,
      role: settings.promptRole,
      insertionDepth: settings.insertionDepth,
      content: rendered.content
    };
  }
  async latestInsertedGreeting(chatId) {
    const messages = await this.api.chat.getMessages(chatId);
    for (let index = messages.length - 1;index >= 0; index -= 1) {
      const message = messages[index];
      const metadata = messageMetadata(message);
      if (metadata && message.role === "assistant")
        return { id: message.id, metadata };
    }
    return null;
  }
  async journalMessage(chatId, journal) {
    const messages = await this.api.chat.getMessages(chatId);
    for (let index = messages.length - 1;index >= 0; index -= 1) {
      const message = messages[index];
      const metadata = messageMetadata(message);
      if (metadata && metadata.journalId === journal.id && message.role === "assistant") {
        return { id: message.id, metadata };
      }
    }
    return null;
  }
  async commitJournal(chatId, state, context, settings, journal, insertedMessageId) {
    const target = greetingForSelection(context.greetings, journal.target);
    if (!target) {
      state.journal = null;
      await this.persistState(chatId, state);
      this.warn("journal target disappeared; no Waypoints selection was advanced");
      return;
    }
    state.active = selected(journal.target);
    state.upcoming = nextGreetingForSelection(context.greetings, state.active);
    addRecentTransition(state, journal.eventKey, settings.recentTransitionLimit);
    consumePendingHandoff(state, journal.eventKey);
    state.journal = null;
    await this.persistState(chatId, state);
    this.note("transition committed: " + journal.eventKey + " -> " + insertedMessageId);
  }
  async reconcileJournalLocked(chatId, state, context, settings) {
    if (!state.journal)
      return false;
    const journal = state.journal;
    const inserted = await this.journalMessage(chatId, journal);
    if (inserted) {
      await this.commitJournal(chatId, state, context, settings, journal, inserted.id);
      return true;
    }
    state.journal = null;
    await this.persistState(chatId, state);
    this.note("stale transition journal rolled back: " + journal.eventKey);
    return false;
  }
  makeMetadata(journal, target) {
    const metadata = {
      kind: "inserted-greeting",
      version: 1,
      journalId: journal.id,
      eventKey: journal.eventKey,
      target: selected(journal.target),
      previousActive: selected(journal.previousActive),
      previousUpcoming: selected(journal.previousUpcoming),
      sourceMessageId: journal.sourceMessageId,
      contentHash: hashText(target.text),
      insertedAt: Date.now()
    };
    return { [INSERTED_GREETING_METADATA_KEY]: metadata };
  }
  async transitionLocked(chatId, state, context, settings, target, eventKey, sourceMessageId) {
    if (state.recentTransitionKeys.includes(eventKey)) {
      return { advanced: false, reason: "This handoff was already processed." };
    }
    const greeting = greetingForSelection(context.greetings, target);
    if (!greeting)
      return { advanced: false, reason: "The selected upcoming greeting no longer exists." };
    if (!this.isSelectionEnabled(context, state, target)) {
      return { advanced: false, reason: "The upcoming greeting's character is turned off." };
    }
    const journal = {
      id: journalId(),
      eventKey,
      sourceMessageId,
      target: selected(target),
      previousActive: selected(state.active),
      previousUpcoming: selected(state.upcoming),
      createdAt: Date.now(),
      phase: "prepared"
    };
    state.journal = journal;
    await this.persistState(chatId, state);
    this.note("transition journaled: " + eventKey);
    try {
      const appended = await this.api.chat.appendMessage(chatId, {
        role: "assistant",
        content: greeting.text,
        metadata: this.makeMetadata(journal, greeting)
      });
      journal.phase = "appended";
      journal.insertedMessageId = appended.id;
      state.journal = journal;
      await this.persistState(chatId, state);
      await this.commitJournal(chatId, state, context, settings, journal, appended.id);
      return { advanced: true, reason: "Inserted the upcoming greeting.", insertedMessageId: appended.id };
    } catch (error) {
      const inserted = await this.journalMessage(chatId, journal).catch(() => null);
      if (inserted) {
        await this.commitJournal(chatId, state, context, settings, journal, inserted.id);
        return { advanced: true, reason: "Recovered a completed greeting insertion.", insertedMessageId: inserted.id };
      }
      state.journal = null;
      await this.persistState(chatId, state);
      const reason = error instanceof Error ? error.message : String(error);
      this.warn("greeting insertion failed and was rolled back: " + reason);
      return { advanced: false, reason: "Greeting insertion failed: " + reason };
    }
  }
  async handoffMessage(chatId, settings, sourceMessageId) {
    for (let attempt = 0;attempt < settings.handoffReadRetryAttempts; attempt += 1) {
      const messages = await this.api.chat.getMessages(chatId);
      const candidates = sourceMessageId ? messages.filter((message) => message.id === sourceMessageId) : [...messages].reverse();
      for (const message of candidates) {
        const extra = messageExtraHandoff(message);
        if (extra && extra.tagName === settings.handoffTagName) {
          return { id: message.id, tagCount: extra.tagCount };
        }
        const direct = stripHandoffTags(message.content, settings.handoffTagName);
        if (direct.hasHandoff)
          return { id: message.id, tagCount: direct.tagCount };
      }
      if (attempt + 1 < settings.handoffReadRetryAttempts)
        await sleep(settings.handoffReadRetryDelayMs);
    }
    return null;
  }
  async processContent(ctx) {
    const settings = await this.settings();
    const handoff = stripHandoffTags(ctx.content, settings.handoffTagName);
    if (!handoff.hasHandoff)
      return;
    const patch = {};
    if (handoff.content !== ctx.content)
      patch.content = handoff.content;
    if (ctx.origin !== "render" && ctx.origin !== "swipe_add" && ctx.origin !== "swipe_update") {
      const metadata = {
        version: 1,
        tagName: settings.handoffTagName,
        tagCount: handoff.tagCount,
        origin: ctx.origin,
        contentHash: hashText(handoff.content),
        at: Date.now()
      };
      patch.extra = { [HANDOFF_EXTRA_KEY]: metadata };
    }
    this.note("handoff tag stripped from " + ctx.origin);
    return Object.keys(patch).length ? patch : undefined;
  }
  async handleHandoff(signal) {
    const missing = this.missingPermissions(AUTOMATIC_PERMISSIONS);
    if (missing.length) {
      const reason = "Automatic handoff is waiting for: " + missing.join(", ") + ".";
      this.note(reason);
      return { advanced: false, reason };
    }
    return this.serial(signal.chatId, async () => {
      const settings = await this.settings();
      const context = await this.context(signal.chatId);
      const state = reconcileChatState(await this.state(signal.chatId), context);
      await this.reconcileJournalLocked(signal.chatId, state, context, settings);
      if (state.recentTransitionKeys.includes(signal.eventKey)) {
        return { advanced: false, reason: "This handoff was already processed." };
      }
      const direct = stripHandoffTags(signal.content ?? "", settings.handoffTagName);
      const extra = asHandoffExtra(signal.extra?.[HANDOFF_EXTRA_KEY]);
      const observed = direct.hasHandoff || extra?.tagName === settings.handoffTagName;
      const stored = observed ? null : await this.handoffMessage(signal.chatId, settings, signal.sourceMessageId);
      const tagCount = direct.tagCount || extra?.tagCount || stored?.tagCount || 0;
      if (!observed && !stored)
        return { advanced: false, reason: "No configured handoff tag was found." };
      rememberPendingHandoff(state, {
        eventKey: signal.eventKey,
        sourceMessageId: signal.sourceMessageId ?? stored?.id,
        contentHash: hashText(signal.content ?? ""),
        tagCount,
        at: Date.now()
      }, settings.pendingHandoffLimit);
      await this.persistState(signal.chatId, state);
      if (!state.upcoming) {
        consumePendingHandoff(state, signal.eventKey);
        await this.persistState(signal.chatId, state);
        return { advanced: false, reason: "There is no upcoming greeting to insert." };
      }
      return this.transitionLocked(signal.chatId, state, context, settings, state.upcoming, signal.eventKey, signal.sourceMessageId ?? stored?.id);
    });
  }
  async force(chatId) {
    this.assertPermissions(["characters", "chats", "chat_mutation"], "Forcing a greeting");
    const settings = await this.settings();
    const resolvedChatId = chatId ?? await this.getActiveChatId(settings);
    if (!resolvedChatId)
      return { advanced: false, reason: "There is no active chat." };
    return this.serial(resolvedChatId, async () => {
      const context = await this.context(resolvedChatId);
      const state = reconcileChatState(await this.state(resolvedChatId), context);
      await this.reconcileJournalLocked(resolvedChatId, state, context, settings);
      if (!state.upcoming)
        return { advanced: false, reason: "There is no upcoming greeting to insert." };
      return this.transitionLocked(resolvedChatId, state, context, settings, state.upcoming, "force:" + journalId());
    });
  }
  async undo(chatId) {
    this.assertPermissions(["characters", "chats", "chat_mutation"], "Undoing a Waypoints insertion");
    const settings = await this.settings();
    const resolvedChatId = chatId ?? await this.getActiveChatId(settings);
    if (!resolvedChatId)
      return { advanced: false, reason: "There is no active chat." };
    return this.serial(resolvedChatId, async () => {
      const context = await this.context(resolvedChatId);
      const state = reconcileChatState(await this.state(resolvedChatId), context);
      const inserted = await this.latestInsertedGreeting(resolvedChatId);
      if (!inserted)
        return { advanced: false, reason: "There is no Waypoints-stamped greeting to undo." };
      await this.api.chat.deleteMessage(resolvedChatId, inserted.id);
      state.active = selected(inserted.metadata.previousActive);
      state.upcoming = selected(inserted.metadata.previousUpcoming);
      removeRecentTransition(state, inserted.metadata.eventKey);
      state.journal = null;
      const reconciled = reconcileChatState(state, context);
      await this.persistState(resolvedChatId, reconciled);
      this.note("undid Waypoints message " + inserted.id);
      return { advanced: true, reason: "Removed the last Waypoints-inserted greeting.", insertedMessageId: inserted.id };
    });
  }
  validateSelection(context, selection) {
    if (!selection)
      return null;
    if (!greetingForSelection(context.greetings, selection)) {
      throw new Error("That greeting is not available in this chat.");
    }
    return selected(selection);
  }
  async setActive(chatId, selection) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing the active greeting");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      state.active = this.validateSelection(context, selection);
      if (state.active && (!state.upcoming || state.upcoming.characterId === state.active.characterId && state.upcoming.greetingIndex === state.active.greetingIndex)) {
        state.upcoming = nextGreetingForSelection(context.greetings, state.active);
      }
      await this.persistState(chatId, state);
    });
  }
  async setUpcoming(chatId, selection) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing the upcoming greeting");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      const next = this.validateSelection(context, selection);
      if (next && state.active && next.characterId === state.active.characterId && next.greetingIndex === state.active.greetingIndex) {
        throw new Error("The upcoming greeting must be different from the active greeting.");
      }
      state.upcoming = next;
      await this.persistState(chatId, state);
    });
  }
  async setEnabled(chatId, characterId, enabled) {
    this.assertPermissions(["characters", "chats"], "Changing Waypoints state");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      if (!context.characterIds.includes(characterId))
        throw new Error("That character is not in this chat.");
      if (context.isGroupChat) {
        const state = reconcileChatState(await this.state(chatId), context);
        state.groupEnabledByCharacter[characterId] = enabled;
        await this.persistState(chatId, state);
      } else {
        await this.api.characters.update(characterId, {
          extensions: { [EXTENSION_ID]: { enabled } }
        }, this.userId);
      }
      this.note("enabled state changed for " + characterId);
    });
  }
  async intercept(messages, chatId) {
    try {
      const settings = await this.settings();
      if (!settings.autoPrompt)
        return messages;
      if (this.missingPermissions(CONTEXT_PERMISSIONS).length)
        return messages;
      return this.serial(chatId, async () => {
        const context = await this.context(chatId);
        const state = reconcileChatState(await this.state(chatId), context);
        await this.reconcileJournalLocked(chatId, state, context, settings);
        const prompt = this.promptStatus(context, state, settings);
        if (!prompt.ready || !prompt.content)
          return messages;
        const injected = { role: settings.promptRole, content: prompt.content };
        const result = insertAtDepth(messages, injected, settings.insertionDepth);
        const index = result.indexOf(injected);
        return {
          messages: result,
          breakdown: [{ messageIndex: index, name: "Waypoints: upcoming scene" }]
        };
      });
    } catch (error) {
      this.warn("prompt interceptor skipped: " + (error instanceof Error ? error.message : String(error)));
      return messages;
    }
  }
  async loomValues(chatId) {
    if (!chatId || this.missingPermissions(CONTEXT_PERMISSIONS).length) {
      return { active: false, content: "" };
    }
    try {
      return this.serial(chatId, async () => {
        const settings = await this.settings();
        const context = await this.context(chatId);
        const state = reconcileChatState(await this.state(chatId), context);
        const active = greetingForSelection(context.greetings, state.active);
        const prompt = this.promptStatus(context, state, settings);
        const ready = Boolean(active && this.isSelectionEnabled(context, state, state.active) && prompt.ready && prompt.content);
        return { active: ready, content: ready ? prompt.content : "" };
      });
    } catch {
      return { active: false, content: "" };
    }
  }
  async view(chatId) {
    const settings = await this.settings();
    const grantedPermissions = await this.api.permissions.getGranted().catch(() => []);
    const missingPermissions = this.missingPermissions(["characters", "chats", "chat_mutation", "generation", "interceptor"]);
    if (this.missingPermissions(CONTEXT_PERMISSIONS).length) {
      return {
        chatId: null,
        isGroupChat: false,
        grantedPermissions,
        characters: [],
        greetings: [],
        active: null,
        upcoming: null,
        canUndo: false,
        missingPermissions,
        status: "Grant characters and chats to load Waypoints.",
        settings,
        prompt: {
          ready: false,
          autoPrompt: settings.autoPrompt,
          role: settings.promptRole,
          insertionDepth: settings.insertionDepth,
          content: "",
          reason: "Chat context permission is missing."
        },
        diagnostics: this.diagnostics()
      };
    }
    const resolvedChatId = chatId === undefined ? await this.getActiveChatId(settings) : chatId;
    if (!resolvedChatId) {
      return {
        chatId: null,
        isGroupChat: false,
        grantedPermissions,
        characters: [],
        greetings: [],
        active: null,
        upcoming: null,
        canUndo: false,
        missingPermissions,
        status: "Open a character or group chat to use Waypoints.",
        settings,
        prompt: {
          ready: false,
          autoPrompt: settings.autoPrompt,
          role: settings.promptRole,
          insertionDepth: settings.insertionDepth,
          content: "",
          reason: "No active chat."
        },
        diagnostics: this.diagnostics()
      };
    }
    return this.serial(resolvedChatId, async () => {
      const context = await this.context(resolvedChatId);
      const state = reconcileChatState(await this.state(resolvedChatId), context);
      await this.reconcileJournalLocked(resolvedChatId, state, context, settings);
      const prompt = this.promptStatus(context, state, settings);
      const active = greetingForSelection(context.greetings, state.active);
      const upcoming = greetingForSelection(context.greetings, state.upcoming);
      const canUndo = this.api.permissions.has("chat_mutation") ? Boolean(await this.latestInsertedGreeting(resolvedChatId).catch(() => null)) : false;
      const status = !state.upcoming ? "No upcoming greeting is selected." : !this.isSelectionEnabled(context, state, state.upcoming) ? "The selected upcoming character is turned off." : "Ready: " + upcoming?.characterName + " greeting " + String((upcoming?.greetingIndex ?? 0) + 1) + ".";
      return {
        chatId: resolvedChatId,
        isGroupChat: context.isGroupChat,
        grantedPermissions,
        characters: context.characters.map((character) => ({
          id: character.id,
          name: character.name,
          enabled: this.isCharacterEnabled(context, state, character.id)
        })),
        greetings: context.greetings,
        active,
        upcoming,
        canUndo,
        missingPermissions,
        status,
        settings,
        prompt,
        diagnostics: this.diagnostics()
      };
    });
  }
}

// src/loom-macros.ts
var WAYPOINTS_ACTIVE_MACRO = "waypoints_active";
var WAYPOINTS_CONTENT_MACRO = "waypoints_content";
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function macroIdentity(context) {
  const value = record(context);
  const env = record(value.env);
  const chat = record(env.chat);
  const extra = record(env.extra);
  return {
    chatId: nonEmptyString(value.chatId) ?? nonEmptyString(chat.id),
    userId: nonEmptyString(value.userId) ?? nonEmptyString(extra.userId)
  };
}
function register(api, name, description, returnType, resolver, select) {
  const definition = {
    name,
    category: "Waypoints",
    description,
    returnType,
    volatile: true,
    handler: async (context) => {
      try {
        return select(await resolver(macroIdentity(context)));
      } catch {
        return returnType === "boolean" ? "false" : "";
      }
    }
  };
  api.registerMacro(definition);
}
function registerWaypointsLoomMacros(api, resolver) {
  register(api, WAYPOINTS_ACTIVE_MACRO, "Returns true when the selected Waypoints path is enabled and has a rendered upcoming-scene prompt.", "boolean", resolver, (values) => values.active ? "true" : "false");
  register(api, WAYPOINTS_CONTENT_MACRO, "Returns the current Waypoints rendered upcoming-scene prompt for use in a Loom preset.", "string", resolver, (values) => values.active ? values.content : "");
}

// src/backend.ts
var engines = new Map;
var interceptorDisposer;
var configuredInterceptorPriority;
var configuredProcessorPriority;
var registrationQueue = Promise.resolve();
function engine(userId) {
  const key = userId || "owner";
  let current = engines.get(key);
  if (!current) {
    current = new WaypointEngine(spindle, userId, async (settings, changedUserId) => {
      await configureHandlers(settings);
      spindle.sendToFrontend({ type: "waypoints:changed", reason: "settings" }, changedUserId);
    });
    engines.set(key, current);
  }
  return current;
}
registerWaypointsLoomMacros(spindle, ({ chatId, userId }) => engine(userId).loomValues(chatId));
function safeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stringValue(value) {
  return typeof value === "string" && value.length ? value : undefined;
}
function chatIdFrom(payload) {
  const data = safeRecord(payload);
  return stringValue(data.chatId) || stringValue(safeRecord(data.chat).id);
}
function messageFrom(payload) {
  return safeRecord(safeRecord(payload).message);
}
function contentFrom(payload) {
  const data = safeRecord(payload);
  const message = messageFrom(payload);
  return typeof data.content === "string" ? data.content : typeof message.content === "string" ? message.content : "";
}
function sourceIdFrom(payload) {
  const data = safeRecord(payload);
  const message = messageFrom(payload);
  return stringValue(data.generationId) || stringValue(data.messageId) || stringValue(message.id);
}
function messageIdFrom(payload) {
  const data = safeRecord(payload);
  const message = messageFrom(payload);
  return stringValue(data.messageId) || stringValue(message.id);
}
function eventKey(kind, payload, chatId) {
  const data = safeRecord(payload);
  const generationId = stringValue(data.generationId);
  if (generationId)
    return chatId + ":generation:" + generationId;
  const sourceId = sourceIdFrom(payload);
  if (sourceId)
    return chatId + ":message:" + sourceId + ":" + hashText(contentFrom(payload));
  return chatId + ":" + kind + ":" + hashText(contentFrom(payload));
}
function notifyChanged(userId, reason) {
  spindle.sendToFrontend({ type: "waypoints:changed", reason }, userId);
}
async function registerHandlers(settings) {
  if (spindle.permissions.has("interceptor")) {
    if (configuredInterceptorPriority !== settings.interceptorPriority) {
      interceptorDisposer?.();
      interceptorDisposer = spindle.registerInterceptor((messages, context) => engine(context.userId).intercept(messages, context.chatId), settings.interceptorPriority);
      configuredInterceptorPriority = settings.interceptorPriority;
      spindle.log.info("[Waypoints] prompt interceptor registered at " + String(settings.interceptorPriority));
    }
  } else if (interceptorDisposer) {
    interceptorDisposer();
    interceptorDisposer = undefined;
    configuredInterceptorPriority = undefined;
  }
  if (spindle.permissions.has("chat_mutation") && configuredProcessorPriority !== settings.contentProcessorPriority) {
    spindle.registerMessageContentProcessor((ctx) => engine(ctx.userId).processContent(ctx), settings.contentProcessorPriority);
    configuredProcessorPriority = settings.contentProcessorPriority;
    spindle.log.info("[Waypoints] handoff processor registered at " + String(settings.contentProcessorPriority));
  } else if (!spindle.permissions.has("chat_mutation")) {
    configuredProcessorPriority = undefined;
  }
}
function configureHandlers(settings = DEFAULT_SETTINGS) {
  registrationQueue = registrationQueue.then(() => registerHandlers(settings), () => registerHandlers(settings));
  return registrationQueue;
}
async function refreshConfiguration() {
  const settings = await engine().settings();
  await configureHandlers(settings);
}
function parseSelection(value, required) {
  if (value === null && !required)
    return null;
  const source = safeRecord(value);
  if (typeof source.characterId !== "string" || !Number.isInteger(source.greetingIndex)) {
    throw new Error("Select a valid character greeting.");
  }
  return { characterId: source.characterId, greetingIndex: Number(source.greetingIndex) };
}
async function handleRequest(raw, userId) {
  const request = safeRecord(raw);
  if (request.type !== "waypoints:request" || typeof request.requestId !== "string" || typeof request.action !== "string")
    return;
  const reply = (result, error) => {
    spindle.sendToFrontend({
      type: "waypoints:reply",
      requestId: request.requestId,
      result,
      error
    }, userId);
  };
  const input = safeRecord(request.input);
  const selectedChatId = stringValue(input.chatId);
  try {
    const current = engine(userId);
    let result;
    switch (request.action) {
      case "bootstrap":
      case "refresh":
        result = await current.view(input.chatId === null ? null : selectedChatId);
        break;
      case "save-settings":
        result = await current.saveSettings(input.settings);
        break;
      case "reset-settings":
        result = await current.resetSettings();
        break;
      case "set-active":
        if (!selectedChatId)
          throw new Error("No active chat is available.");
        await current.setActive(selectedChatId, parseSelection(input.selection, true));
        result = await current.view(selectedChatId);
        break;
      case "set-upcoming":
        if (!selectedChatId)
          throw new Error("No active chat is available.");
        await current.setUpcoming(selectedChatId, parseSelection(input.selection, false));
        result = await current.view(selectedChatId);
        break;
      case "set-enabled":
        if (!selectedChatId || typeof input.characterId !== "string" || typeof input.enabled !== "boolean") {
          throw new Error("Choose a character and an enabled state.");
        }
        await current.setEnabled(selectedChatId, input.characterId, input.enabled);
        result = await current.view(selectedChatId);
        break;
      case "force":
        result = {
          transition: await current.force(selectedChatId),
          view: await current.view(selectedChatId)
        };
        break;
      case "undo":
        result = {
          transition: await current.undo(selectedChatId),
          view: await current.view(selectedChatId)
        };
        break;
      case "clear-diagnostics":
        current.clearDiagnostics();
        result = await current.view(selectedChatId);
        break;
      case "set-hud-visible": {
        const settings = await current.settings();
        result = await current.saveSettings({ ...settings, floatingControls: Boolean(input.visible) });
        break;
      }
      default:
        throw new Error("Unknown Waypoints action.");
    }
    reply(result);
  } catch (error) {
    reply(undefined, error instanceof Error ? error.message : String(error));
  }
}
function observeHandoff(kind, payload, userId) {
  const chatId = chatIdFrom(payload);
  if (!chatId)
    return;
  const message = messageFrom(payload);
  const extra = Object.keys(safeRecord(message.extra)).length ? safeRecord(message.extra) : safeRecord(safeRecord(payload).extra);
  engine(userId).handleHandoff({
    chatId,
    eventKey: eventKey(kind, payload, chatId),
    sourceMessageId: messageIdFrom(payload),
    content: contentFrom(payload),
    extra
  }).then((result) => {
    if (result.advanced)
      notifyChanged(userId, "handoff");
  }).catch((error) => {
    spindle.log.warn("[Waypoints] handoff observer failed: " + (error instanceof Error ? error.message : String(error)));
  });
}
spindle.onFrontendMessage((payload, userId) => {
  handleRequest(payload, userId);
});
spindle.permissions.onChanged(() => {
  refreshConfiguration().catch((error) => {
    spindle.log.warn("[Waypoints] permission refresh failed: " + (error instanceof Error ? error.message : String(error)));
  });
  notifyChanged(undefined, "permissions");
});
spindle.permissions.onDenied((detail) => {
  spindle.log.warn("[Waypoints] " + detail.operation + " requires " + detail.permission);
  notifyChanged(undefined, "permission-denied");
});
spindle.on("GENERATION_ENDED", (payload, userId) => observeHandoff("generation-ended", payload, userId));
spindle.on("GENERATION_STOPPED", (payload, userId) => observeHandoff("generation-stopped", payload, userId));
spindle.on("MESSAGE_EDITED", (payload, userId) => observeHandoff("message-edited", payload, userId));
spindle.on("MESSAGE_SWIPED", (payload, userId) => observeHandoff("message-swiped", payload, userId));
spindle.on("SWIPE_EDITED", (payload, userId) => observeHandoff("swipe-edited", payload, userId));
spindle.on("CHARACTER_MESSAGE_RENDERED", (payload, userId) => observeHandoff("character-message-rendered", payload, userId));
for (const eventName of [
  "CHAT_SWITCHED",
  "CHAT_CHANGED",
  "CHARACTER_EDITED",
  "CHARACTER_DELETED",
  "GENERATION_STARTED"
]) {
  spindle.on(eventName, (_payload, userId) => notifyChanged(userId, eventName.toLowerCase()));
}
refreshConfiguration().catch((error) => {
  spindle.log.warn("[Waypoints] initial registration failed: " + (error instanceof Error ? error.message : String(error)));
});
