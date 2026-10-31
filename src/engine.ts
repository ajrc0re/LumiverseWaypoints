import type {
  ChatMessageDTO,
  InterceptorResultDTO,
  LlmMessageDTO,
  MessageContentProcessorCtxDTO,
  MessageContentProcessorResultDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS, settingsFromStorage, validateSettings } from "./config";
import { insertAtDepths, renderPrompt, stripHandoffTags } from "./prompt";
import {
  STORYLINE_NOTES_LIMIT,
  STORYLINE_OVERVIEW_LIMIT,
  cardOrder,
  effectiveRoute,
  emptyStoryline,
  generatedText,
  isOverviewStale,
  parseStoryline,
  renderGeneratorPrompt,
  renderStorylinePrompt,
  resolveRoute,
  routeEntries,
  routeSignature,
  sameRoute,
  storylinePath,
  storylinePosition,
} from "./storyline";
import { hashText, isRecord } from "./util";
import {
  addRecentTransition,
  buildGreetingContext,
  chatRoutes,
  consumePendingHandoff,
  greetingForSelection,
  groupCharacterIds,
  nextGreetingChoices,
  nextGreetingForSelection,
  parseChatState,
  reconcileChatState,
  rememberPendingHandoff,
  serializeChatState,
} from "./state";
import {
  CHAT_STATE_KEY,
  EXTENSION_ID,
  HANDOFF_EXTRA_KEY,
  INSERTED_GREETING_METADATA_KEY,
  SETTINGS_PATH,
} from "./types";
import type {
  CharacterStoryline,
  Greeting,
  GreetingContext,
  GreetingSelection,
  HandoffExtraMetadata,
  InsertedGreetingMetadata,
  PromptStatus,
  StorylineCharacterView,
  StorylinePromptStatus,
  StorylineView,
  TransitionJournal,
  TransitionResult,
  WaypointChatState,
  WaypointLoomValues,
  WaypointSettings,
  WaypointsView,
} from "./types";

const AUTOMATIC_PERMISSIONS = ["characters", "chats", "chat_mutation", "generation"];
const CONTEXT_PERMISSIONS = ["characters", "chats"];
const STORYLINE_GENERATION_PERMISSIONS = ["characters", "chats", "generation"];

export interface StorylineDraftInput {
  /** Greeting indices in story order. Empty or full card order means "every greeting in card order". */
  route: number[];
  notes: string;
  overview?: string;
}

export interface ConnectionChoice {
  id: string;
  name: string;
  model: string;
  isDefault: boolean;
}

function emptyLoomValues(): WaypointLoomValues {
  return {
    active: false,
    content: "",
    altMessages: [],
    nextMessages: [],
    currentMessage: "",
    nextMessage: "",
    storylineActive: false,
    storyline: "",
  };
}

function emptyStorylineView(reason: string): StorylineView {
  return {
    routeEnabled: true,
    overviewEnabled: true,
    characters: [],
    prompt: { ready: false, content: "", characterId: null, position: null, reason },
  };
}

export interface HandoffSignal {
  chatId: string;
  eventKey: string;
  sourceMessageId?: string;
  content?: string;
  extra?: Record<string, unknown>;
}

export type SettingsChanged = (settings: WaypointSettings, userId?: string) => void | Promise<void>;

interface InsertedMessage {
  id: string;
  metadata: InsertedGreetingMetadata;
  previousMessageId?: string;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function journalId(): string {
  return "wp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export { hashText };

function selected(selection: GreetingSelection | null): GreetingSelection | null {
  return selection ? { characterId: selection.characterId, greetingIndex: selection.greetingIndex } : null;
}

function asInsertedMetadata(value: unknown): InsertedGreetingMetadata | null {
  if (!isRecord(value) || value.kind !== "inserted-greeting" || value.version !== 1) return null;
  if (typeof value.journalId !== "string" || typeof value.eventKey !== "string" || typeof value.contentHash !== "string") return null;
  if (!isRecord(value.target) || typeof value.target.characterId !== "string" || !Number.isInteger(value.target.greetingIndex)) return null;
  const selection = (candidate: unknown): GreetingSelection | null => {
    if (!isRecord(candidate) || typeof candidate.characterId !== "string" || !Number.isInteger(candidate.greetingIndex)) return null;
    return { characterId: candidate.characterId, greetingIndex: Number(candidate.greetingIndex) };
  };
  return {
    kind: "inserted-greeting",
    version: 1,
    journalId: value.journalId,
    eventKey: value.eventKey,
    handoffKey: typeof value.handoffKey === "string" ? value.handoffKey : undefined,
    target: { characterId: value.target.characterId, greetingIndex: Number(value.target.greetingIndex) },
    previousActive: selection(value.previousActive),
    previousUpcoming: selection(value.previousUpcoming),
    sourceMessageId: typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined,
    contentHash: value.contentHash,
    insertedAt: Number.isFinite(value.insertedAt) ? Number(value.insertedAt) : 0,
  };
}

function asHandoffExtra(value: unknown): HandoffExtraMetadata | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.tagName !== "string") return null;
  return {
    version: 1,
    tagName: value.tagName,
    tagCount: Number.isInteger(value.tagCount) ? Number(value.tagCount) : 1,
    origin: typeof value.origin === "string" ? value.origin : "",
    contentHash: typeof value.contentHash === "string" ? value.contentHash : "",
    at: Number.isFinite(value.at) ? Number(value.at) : 0,
  };
}

function messageMetadata(message: { metadata?: Record<string, unknown> }): InsertedGreetingMetadata | null {
  return asInsertedMetadata(message.metadata?.[INSERTED_GREETING_METADATA_KEY]);
}

function messageExtraHandoff(message: { extra?: Record<string, unknown> }): HandoffExtraMetadata | null {
  return asHandoffExtra(message.extra?.[HANDOFF_EXTRA_KEY]);
}

export class WaypointEngine {
  private settingsCache: WaypointSettings | null = null;
  private readonly queues = new Map<string, Promise<unknown>>();
  private diagnosticsLines: string[] = [];
  private readonly storylineCache = new Map<string, CharacterStoryline | null>();
  private readonly generations = new Map<string, AbortController>();

  constructor(
    private readonly api: SpindleAPI,
    private readonly userId?: string,
    private readonly settingsChanged?: SettingsChanged,
  ) {}

  private note(message: string): void {
    const settings = this.settingsCache;
    if (settings && !settings.diagnosticLogging) return;
    const line = new Date().toISOString() + " " + message;
    const limit = settings?.diagnosticLineLimit ?? DEFAULT_SETTINGS.diagnosticLineLimit;
    this.diagnosticsLines = [...this.diagnosticsLines, line].slice(-limit);
    this.api.log.info("[Waypoints] " + message);
  }

  private warn(message: string): void {
    this.note(message);
    this.api.log.warn("[Waypoints] " + message);
  }

  diagnostics(): string[] {
    return [...this.diagnosticsLines];
  }

  clearDiagnostics(): void {
    this.diagnosticsLines = [];
  }

  async settings(): Promise<WaypointSettings> {
    if (!this.settingsCache) {
      const stored = await this.api.userStorage.getJson<unknown>(SETTINGS_PATH, {
        fallback: {},
        userId: this.userId,
      });
      this.settingsCache = settingsFromStorage(stored);
    }
    return clone(this.settingsCache);
  }

  async saveSettings(draft: unknown): Promise<{ settings: WaypointSettings; warnings: string[] }> {
    const validated = validateSettings(draft);
    // The host writes one JSON object, so invalid drafts cannot partially apply.
    await this.api.userStorage.setJson(SETTINGS_PATH, validated.settings, { userId: this.userId });
    this.settingsCache = clone(validated.settings);
    if (this.settingsChanged) await this.settingsChanged(clone(validated.settings), this.userId);
    this.note("settings saved");
    return { settings: clone(validated.settings), warnings: validated.warnings };
  }

  async resetSettings(): Promise<{ settings: WaypointSettings; warnings: string[] }> {
    return this.saveSettings(clone(DEFAULT_SETTINGS));
  }

  private missingPermissions(required: readonly string[]): string[] {
    return required.filter((permission) => !this.api.permissions.has(permission));
  }

  private assertPermissions(required: readonly string[], action: string): void {
    const missing = this.missingPermissions(required);
    if (missing.length) {
      throw new Error(action + " needs the " + missing.join(", ") + " permission" + (missing.length === 1 ? "" : "s") + ".");
    }
  }

  private async serial<T>(chatId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(chatId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(action);
    this.queues.set(chatId, run.then(() => undefined, () => undefined));
    return run;
  }

  private async getActiveChatId(settings: WaypointSettings): Promise<string | null> {
    this.assertPermissions(["chats"], "Finding the active chat");
    for (let attempt = 0; attempt < settings.activeChatRetryAttempts; attempt += 1) {
      const active = await this.api.chats.getActive(this.userId);
      if (active) return active.id;
      if (attempt + 1 < settings.activeChatRetryAttempts) await sleep(settings.activeChatRetryDelayMs);
    }
    return null;
  }

  private async context(chatId: string): Promise<GreetingContext> {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Loading Waypoints");
    const chat = await this.api.chats.get(chatId, this.userId);
    if (!chat) throw new Error("The selected chat no longer exists.");
    const ids = groupCharacterIds(chat);
    const loaded = await Promise.all(ids.map((characterId) => this.api.characters.get(characterId, this.userId)));
    const characters = loaded.filter((character): character is NonNullable<typeof character> => Boolean(character));
    const context = buildGreetingContext(chat, characters);
    const storylines: Record<string, CharacterStoryline> = {};
    const stored = await Promise.all(context.characterIds.map((characterId) => this.storyline(characterId)));
    for (const storyline of stored) if (storyline) storylines[storyline.characterId] = storyline;
    return { ...context, storylines };
  }

  /** Storylines are written only through this engine, so a per-user cache stays coherent. */
  private async storyline(characterId: string): Promise<CharacterStoryline | null> {
    if (this.storylineCache.has(characterId)) return clone(this.storylineCache.get(characterId) ?? null);
    let parsed: CharacterStoryline | null = null;
    try {
      const stored = await this.api.userStorage.getJson<unknown>(storylinePath(characterId), {
        fallback: null,
        userId: this.userId,
      });
      parsed = parseStoryline(stored, characterId);
    } catch {
      parsed = null;
    }
    this.storylineCache.set(characterId, parsed);
    return clone(parsed);
  }

  private async writeStoryline(storyline: CharacterStoryline): Promise<void> {
    await this.api.userStorage.setJson(storylinePath(storyline.characterId), storyline, { userId: this.userId });
    this.storylineCache.set(storyline.characterId, clone(storyline));
  }

  private alternateMessages(context: GreetingContext): string[] {
    const character = context.characters.find((entry) => entry.id === context.primaryCharacterId);
    return Array.isArray(character?.alternate_greetings)
      ? character.alternate_greetings.map((message) => typeof message === "string" ? message : "")
      : [];
  }

  private async state(chatId: string): Promise<WaypointChatState> {
    try {
      return parseChatState(await this.api.variables.chat.get(chatId, CHAT_STATE_KEY));
    } catch {
      return parseChatState(null);
    }
  }

  private async persistState(chatId: string, state: WaypointChatState): Promise<void> {
    await this.api.variables.chat.set(chatId, CHAT_STATE_KEY, serializeChatState(state));
  }

  private isCharacterEnabled(
    context: GreetingContext,
    state: WaypointChatState,
    characterId: string,
  ): boolean {
    if (context.isGroupChat) return state.groupEnabledByCharacter[characterId] !== false;
    const character = context.characters.find((entry) => entry.id === characterId);
    const extensionData = character && isRecord(character.extensions?.[EXTENSION_ID])
      ? character.extensions?.[EXTENSION_ID]
      : null;
    return !isRecord(extensionData) || extensionData.enabled !== false;
  }

  private isSelectionEnabled(
    context: GreetingContext,
    state: WaypointChatState,
    selection: GreetingSelection | null,
  ): boolean {
    return state.chatEnabled && selection !== null && this.isCharacterEnabled(context, state, selection.characterId);
  }

  private promptStatus(
    context: GreetingContext,
    state: WaypointChatState,
    settings: WaypointSettings,
  ): PromptStatus {
    const upcoming = greetingForSelection(context.greetings, state.upcoming);
    if (!upcoming) {
      return {
        ready: false,
        autoPrompt: settings.autoPrompt,
        role: settings.promptRole,
        insertionDepth: settings.insertionDepth,
        content: "",
        reason: "Choose an upcoming greeting to shape the scene.",
      };
    }
    if (!this.isSelectionEnabled(context, state, state.upcoming)) {
      return {
        ready: false,
        autoPrompt: settings.autoPrompt,
        role: settings.promptRole,
        insertionDepth: settings.insertionDepth,
        content: "",
        reason: state.chatEnabled ? "The upcoming greeting's character is turned off." : "Waypoints is off for this chat.",
      };
    }
    const rendered = renderPrompt(settings, upcoming.text);
    return {
      ready: true,
      autoPrompt: settings.autoPrompt,
      role: settings.promptRole,
      insertionDepth: settings.insertionDepth,
      content: rendered.content,
    };
  }

  private async latestInsertedGreeting(chatId: string): Promise<InsertedMessage | null> {
    const messages = await this.api.chat.getMessages(chatId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const metadata = messageMetadata(message);
      if (metadata && message.role === "assistant") return { id: message.id, metadata, previousMessageId: messages[index - 1]?.id };
    }
    return null;
  }

  private async journalMessage(chatId: string, journal: TransitionJournal): Promise<InsertedMessage | null> {
    const messages = await this.api.chat.getMessages(chatId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const metadata = messageMetadata(message);
      if (metadata && metadata.journalId === journal.id && message.role === "assistant") {
        return { id: message.id, metadata };
      }
    }
    return null;
  }

  private async commitJournal(
    chatId: string,
    state: WaypointChatState,
    context: GreetingContext,
    settings: WaypointSettings,
    journal: TransitionJournal,
    insertedMessageId: string,
  ): Promise<void> {
    const target = greetingForSelection(context.greetings, journal.target);
    if (!target) {
      state.journal = null;
      await this.persistState(chatId, state);
      this.warn("journal target disappeared; no Waypoints selection was advanced");
      return;
    }
    state.active = selected(journal.target);
    state.upcoming = nextGreetingForSelection(context.greetings, state.active, chatRoutes(context, state));
    addRecentTransition(state, journal.eventKey, settings.recentTransitionLimit);
    consumePendingHandoff(state, journal.eventKey);
    if (journal.handoffKey) {
      addRecentTransition(state, journal.handoffKey, settings.recentTransitionLimit);
      consumePendingHandoff(state, journal.handoffKey);
    }
    state.journal = null;
    await this.persistState(chatId, state);
    this.note("transition committed: " + journal.eventKey + " -> " + insertedMessageId);
  }

  /**
   * A restart can happen after an append committed but before the selection
   * state did. The journal's ID is embedded in the appended message metadata,
   * allowing a single safe reconciliation before any fresh insert.
   */
  private async reconcileJournalLocked(
    chatId: string,
    state: WaypointChatState,
    context: GreetingContext,
    settings: WaypointSettings,
  ): Promise<boolean> {
    if (!state.journal) return false;
    const journal = state.journal;
    const inserted = await this.journalMessage(chatId, journal);
    if (inserted) {
      await this.commitJournal(chatId, state, context, settings, journal, inserted.id);
      return true;
    }
    // No Waypoints-stamped row exists, so no user-authored message can be
    // affected. Roll the failed pre-append journal back before new work.
    state.journal = null;
    await this.persistState(chatId, state);
    this.note("stale transition journal rolled back: " + journal.eventKey);
    return false;
  }

  private makeMetadata(journal: TransitionJournal, target: Greeting): Record<string, unknown> {
    const metadata: InsertedGreetingMetadata = {
      kind: "inserted-greeting",
      version: 1,
      journalId: journal.id,
      eventKey: journal.eventKey,
      handoffKey: journal.handoffKey,
      target: selected(journal.target) as GreetingSelection,
      previousActive: selected(journal.previousActive),
      previousUpcoming: selected(journal.previousUpcoming),
      sourceMessageId: journal.sourceMessageId,
      contentHash: hashText(target.text),
      insertedAt: Date.now(),
    };
    return { [INSERTED_GREETING_METADATA_KEY]: metadata };
  }

  private async transitionLocked(
    chatId: string,
    state: WaypointChatState,
    context: GreetingContext,
    settings: WaypointSettings,
    target: GreetingSelection,
    eventKey: string,
    sourceMessageId?: string,
    handoffKey?: string,
  ): Promise<TransitionResult> {
    if (state.recentTransitionKeys.includes(eventKey)) {
      return { advanced: false, reason: "This handoff was already processed." };
    }
    const greeting = greetingForSelection(context.greetings, target);
    if (!greeting) return { advanced: false, reason: "The selected upcoming greeting no longer exists." };
    if (!this.isSelectionEnabled(context, state, target)) {
      return { advanced: false, reason: state.chatEnabled ? "The upcoming greeting's character is turned off." : "Waypoints is off for this chat." };
    }

    const journal: TransitionJournal = {
      id: journalId(),
      eventKey,
      sourceMessageId,
      handoffKey,
      target: selected(target) as GreetingSelection,
      previousActive: selected(state.active),
      previousUpcoming: selected(state.upcoming),
      createdAt: Date.now(),
      phase: "prepared",
    };
    state.journal = journal;
    await this.persistState(chatId, state);
    this.note("transition journaled: " + eventKey);

    try {
      const appended = await this.api.chat.appendMessage(chatId, {
        role: "assistant",
        content: greeting.text,
        metadata: this.makeMetadata(journal, greeting),
      });
      journal.phase = "appended";
      journal.insertedMessageId = appended.id;
      state.journal = journal;
      await this.persistState(chatId, state);
      await this.commitJournal(chatId, state, context, settings, journal, appended.id);
      return { advanced: true, reason: "Inserted the upcoming greeting.", insertedMessageId: appended.id };
    } catch (error) {
      // A transport failure may have happened after the write. Scan only for
      // our stamped journal before rolling state back; never inspect/delete
      // arbitrary messages.
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

  private async handoffMessage(
    chatId: string,
    settings: WaypointSettings,
    signal: HandoffSignal,
    attempts = settings.handoffReadRetryAttempts,
  ): Promise<{ id: string; eventKey: string; contentHash: string; tagCount: number; alreadyInserted: boolean } | null> {
    const direct = stripHandoffTags(signal.content ?? "", settings.handoffTagName);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const messages = await this.api.chat.getMessages(chatId);
      // A stopped generation may omit its message ID. Only its current reply
      // can qualify; never search back through unrelated historical handoffs.
      const message = signal.sourceMessageId
        ? messages.find((entry) => entry.id === signal.sourceMessageId)
        : [...messages].reverse().find((entry) => !messageMetadata(entry));
      if (message) {
        if (message.role !== "assistant" || messageMetadata(message)) return null;
        const stored = stripHandoffTags(message.content, settings.handoffTagName);
        if (signal.content && direct.content !== stored.content) return null;
        const contentHash = hashText(stored.content);
        const extra = messageExtraHandoff(message) ?? asHandoffExtra(signal.extra?.[HANDOFF_EXTRA_KEY]);
        const stamped = extra?.tagName === settings.handoffTagName && extra.contentHash === contentHash;
        if (!direct.hasHandoff && !stored.hasHandoff && !stamped) return null;
        const eventKey = chatId + ":handoff:" + message.id + ":" + String(message.swipe_id) + ":" + contentHash;
        return {
          id: message.id,
          // All lifecycle notifications for the same reply/swipe share one key,
          // whether the wire content still contains the tag or has been stripped.
          eventKey,
          contentHash,
          tagCount: direct.tagCount || stored.tagCount || (stamped ? extra.tagCount : 0),
          alreadyInserted: messages.some((entry) => {
            const metadata = messageMetadata(entry);
            return metadata?.eventKey === eventKey || metadata?.handoffKey === eventKey || Boolean(
              metadata?.sourceMessageId === message.id && !metadata.handoffKey && !metadata.eventKey.includes(":handoff:"),
            );
          }),
        };
      }
      if (attempt + 1 < attempts) await sleep(settings.handoffReadRetryDelayMs);
    }
    return null;
  }

  async processContent(
    ctx: MessageContentProcessorCtxDTO,
  ): Promise<MessageContentProcessorResultDTO | void> {
    if (ctx.isUser) return;
    const settings = await this.settings();
    const handoff = stripHandoffTags(ctx.content, settings.handoffTagName);
    if (!handoff.hasHandoff) return;
    const patch: MessageContentProcessorResultDTO = {};
    if (handoff.content !== ctx.content) patch.content = handoff.content;
    if (ctx.origin !== "render" && ctx.origin !== "swipe_add" && ctx.origin !== "swipe_update") {
      const metadata: HandoffExtraMetadata = {
        version: 1,
        tagName: settings.handoffTagName,
        tagCount: handoff.tagCount,
        origin: ctx.origin,
        contentHash: hashText(handoff.content),
        at: Date.now(),
      };
      patch.extra = { [HANDOFF_EXTRA_KEY]: metadata };
    }
    this.note("handoff tag stripped from " + ctx.origin);
    return Object.keys(patch).length ? patch : undefined;
  }

  async handleHandoff(signal: HandoffSignal): Promise<TransitionResult> {
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
      if (!state.chatEnabled) return { advanced: false, reason: "Waypoints is off for this chat." };
      if (state.recentTransitionKeys.includes(signal.eventKey)) {
        return { advanced: false, reason: "This handoff was already processed." };
      }

      const handoff = await this.handoffMessage(signal.chatId, settings, signal);
      if (!handoff) return { advanced: false, reason: "No handoff was found in the current assistant reply." };
      if (handoff.alreadyInserted || state.recentTransitionKeys.includes(handoff.eventKey)) {
        return { advanced: false, reason: "This handoff was already processed." };
      }

      rememberPendingHandoff(state, {
        eventKey: handoff.eventKey,
        sourceMessageId: handoff.id,
        contentHash: handoff.contentHash,
        tagCount: handoff.tagCount,
        at: Date.now(),
      }, settings.pendingHandoffLimit);
      await this.persistState(signal.chatId, state);

      if (!state.upcoming) {
        consumePendingHandoff(state, handoff.eventKey);
        await this.persistState(signal.chatId, state);
        return { advanced: false, reason: "There is no upcoming greeting to insert." };
      }
      return this.transitionLocked(
        signal.chatId,
        state,
        context,
        settings,
        state.upcoming,
        handoff.eventKey,
        handoff.id,
      );
    });
  }

  async force(chatId?: string): Promise<TransitionResult> {
    this.assertPermissions(["characters", "chats", "chat_mutation"], "Forcing a greeting");
    const settings = await this.settings();
    const resolvedChatId = chatId ?? await this.getActiveChatId(settings);
    if (!resolvedChatId) return { advanced: false, reason: "There is no active chat." };
    return this.serial(resolvedChatId, async () => {
      const context = await this.context(resolvedChatId);
      const state = reconcileChatState(await this.state(resolvedChatId), context);
      await this.reconcileJournalLocked(resolvedChatId, state, context, settings);
      if (!state.upcoming) return { advanced: false, reason: "There is no upcoming greeting to insert." };
      const handoff = await this.handoffMessage(resolvedChatId, settings, { chatId: resolvedChatId, eventKey: "" }, 1);
      return this.transitionLocked(
        resolvedChatId,
        state,
        context,
        settings,
        state.upcoming,
        "force:" + journalId(),
        handoff?.id,
        handoff?.eventKey,
      );
    });
  }

  async undo(chatId?: string): Promise<TransitionResult> {
    this.assertPermissions(["characters", "chats", "chat_mutation"], "Undoing a Waypoints insertion");
    const settings = await this.settings();
    const resolvedChatId = chatId ?? await this.getActiveChatId(settings);
    if (!resolvedChatId) return { advanced: false, reason: "There is no active chat." };
    return this.serial(resolvedChatId, async () => {
      const context = await this.context(resolvedChatId);
      const state = reconcileChatState(await this.state(resolvedChatId), context);
      const inserted = await this.latestInsertedGreeting(resolvedChatId);
      if (!inserted) return { advanced: false, reason: "There is no Waypoints-stamped greeting to undo." };
      // Older insertions did not store a shared handoff key. Resolve only their
      // recorded source (or immediately preceding row for old Force actions).
      let handoffKey = inserted.metadata.handoffKey;
      const sourceMessageId = inserted.metadata.sourceMessageId ?? inserted.previousMessageId;
      if (!handoffKey && sourceMessageId) {
        handoffKey = (await this.handoffMessage(resolvedChatId, settings, {
          chatId: resolvedChatId, eventKey: inserted.metadata.eventKey, sourceMessageId,
        }, 1))?.eventKey;
      }
      // This delete is metadata-gated. Text similarity or message position never
      // qualifies a message for undo.
      await this.api.chat.deleteMessage(resolvedChatId, inserted.id);
      state.active = selected(inserted.metadata.previousActive);
      state.upcoming = selected(inserted.metadata.previousUpcoming);
      // Undo restores the path, but must not re-arm the source message's tag.
      addRecentTransition(state, inserted.metadata.eventKey, settings.recentTransitionLimit);
      consumePendingHandoff(state, inserted.metadata.eventKey);
      if (handoffKey) {
        addRecentTransition(state, handoffKey, settings.recentTransitionLimit);
        consumePendingHandoff(state, handoffKey);
      }
      state.journal = null;
      const reconciled = reconcileChatState(state, context);
      await this.persistState(resolvedChatId, reconciled);
      this.note("undid Waypoints message " + inserted.id);
      return { advanced: true, reason: "Removed the last Waypoints-inserted greeting and restored the previous current and next greetings.", insertedMessageId: inserted.id };
    });
  }

  private validateSelection(context: GreetingContext, selection: GreetingSelection | null): GreetingSelection | null {
    if (!selection) return null;
    if (!greetingForSelection(context.greetings, selection)) {
      throw new Error("That greeting is not available in this chat.");
    }
    return selected(selection);
  }

  async setActive(chatId: string, selection: GreetingSelection): Promise<void> {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing the active greeting");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      state.active = this.validateSelection(context, selection);
      if (state.active && (!state.upcoming || state.upcoming.characterId === state.active.characterId && state.upcoming.greetingIndex === state.active.greetingIndex)) {
        state.upcoming = nextGreetingForSelection(context.greetings, state.active, chatRoutes(context, state));
      }
      await this.persistState(chatId, state);
    });
  }

  async setUpcoming(chatId: string, selection: GreetingSelection | null): Promise<void> {
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

  async setEnabled(chatId: string, characterId: string, enabled: boolean): Promise<void> {
    this.assertPermissions(["characters", "chats"], "Changing Waypoints state");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      if (!context.characterIds.includes(characterId)) throw new Error("That character is not in this chat.");
      if (context.isGroupChat) {
        const state = reconcileChatState(await this.state(chatId), context);
        state.groupEnabledByCharacter[characterId] = enabled;
        await this.persistState(chatId, state);
      } else {
        // Extensions are shallow-merged per key, so keep any other Waypoints
        // fields already stored on the card.
        const character = context.characters.find((entry) => entry.id === characterId);
        const existing = isRecord(character?.extensions?.[EXTENSION_ID]) ? character?.extensions?.[EXTENSION_ID] as Record<string, unknown> : {};
        await this.api.characters.update(characterId, {
          extensions: { [EXTENSION_ID]: { ...existing, enabled } },
        }, this.userId);
      }
      this.note("enabled state changed for " + characterId);
    });
  }

  async setChatEnabled(chatId: string, enabled: boolean): Promise<void> {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing this chat's Waypoints state");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      if (enabled && context.greetings.length < 2) {
        throw new Error("This chat has no alternate greetings for Waypoints to cycle.");
      }
      const state = reconcileChatState(await this.state(chatId), context);
      state.chatEnabled = enabled;
      if (!enabled) state.pendingHandoffs = [];
      await this.persistState(chatId, state);
      this.note("chat " + chatId + " Waypoints " + (enabled ? "enabled" : "disabled"));
    });
  }


  /** Per-chat switch: follow the character's storyline route instead of card order. */
  async setStoryRoute(chatId: string, enabled: boolean): Promise<void> {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing this chat's storyline route");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      state.storyRoute = enabled;
      // Re-plan from the current greeting so the new order applies immediately.
      state.upcoming = nextGreetingForSelection(context.greetings, state.active, chatRoutes(context, state));
      await this.persistState(chatId, state);
      this.note("chat " + chatId + " storyline route " + (enabled ? "on" : "off"));
    });
  }

  /** Per-chat switch: include the character's narrative overview in prompts. */
  async setStoryOverview(chatId: string, enabled: boolean): Promise<void> {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing this chat's narrative overview");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      state.storyOverview = enabled;
      await this.persistState(chatId, state);
      this.note("chat " + chatId + " narrative overview " + (enabled ? "on" : "off"));
    });
  }

  private storylineCharacter(context: GreetingContext, characterId: string) {
    const character = context.characters.find((entry) => entry.id === characterId);
    if (!character || !context.characterIds.includes(characterId)) throw new Error("That character is not in this chat.");
    return character;
  }

  /** Validates a requested route against the card. Full card order is stored as the empty default. */
  private normalizeRoute(context: GreetingContext, characterId: string, route: unknown): number[] {
    const order = cardOrder(context.greetings, characterId);
    if (!Array.isArray(route) || !route.length) return [];
    const available = new Set(order);
    const seen = new Set<number>();
    const indices: number[] = [];
    for (const value of route) {
      if (!Number.isInteger(value) || !available.has(Number(value))) throw new Error("A storyline stop is not one of this character's greetings.");
      if (seen.has(Number(value))) throw new Error("A greeting can appear only once in a storyline.");
      seen.add(Number(value));
      indices.push(Number(value));
    }
    return sameRoute(indices, order) ? [] : indices;
  }

  /**
   * After a route change, the open chat re-plans its upcoming greeting from
   * the current one. Other chats pick the new route up at their next handoff.
   */
  private async replanChat(chatId: string, characterId: string): Promise<void> {
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      if (!state.storyRoute || state.active?.characterId !== characterId) return;
      state.upcoming = nextGreetingForSelection(context.greetings, state.active, chatRoutes(context, state));
      await this.persistState(chatId, state);
    });
  }

  async saveStoryline(chatId: string, characterId: string, input: StorylineDraftInput): Promise<void> {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Saving a storyline");
    const context = await this.serial(chatId, () => this.context(chatId));
    this.storylineCharacter(context, characterId);
    const indices = this.normalizeRoute(context, characterId, input.route);
    const notes = typeof input.notes === "string" ? input.notes : "";
    const overview = typeof input.overview === "string" ? input.overview : undefined;
    if (notes.length > STORYLINE_NOTES_LIMIT) throw new Error("Author guidance is too long (maximum " + String(STORYLINE_NOTES_LIMIT) + " characters).");
    if (overview !== undefined && overview.length > STORYLINE_OVERVIEW_LIMIT) {
      throw new Error("The narrative overview is too long (maximum " + String(STORYLINE_OVERVIEW_LIMIT) + " characters).");
    }
    const previous = await this.storyline(characterId) ?? emptyStoryline(characterId);
    const previousRoute = resolveRoute(previous, context.greetings);
    const next: CharacterStoryline = {
      ...previous,
      route: routeEntries(indices, context.greetings, characterId),
      notes,
      updatedAt: Date.now(),
    };
    if (overview !== undefined) {
      next.overview = overview;
      if (!overview.trim()) {
        next.overviewSignature = "";
        next.generatedAt = null;
      }
    }
    await this.writeStoryline(next);
    this.note("storyline saved for " + characterId);
    if (!sameRoute(previousRoute, indices)) await this.replanChat(chatId, characterId);
  }

  /** Deletes the character's storyline: route, guidance, and overview. */
  async deleteStoryline(chatId: string, characterId: string): Promise<void> {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Deleting a storyline");
    const context = await this.serial(chatId, () => this.context(chatId));
    this.storylineCharacter(context, characterId);
    await this.api.userStorage.delete(storylinePath(characterId), this.userId).catch(async () => {
      // Hosts without delete support still end up with an empty storyline.
      await this.api.userStorage.setJson(storylinePath(characterId), null, { userId: this.userId });
    });
    this.storylineCache.set(characterId, null);
    this.note("storyline deleted for " + characterId);
    await this.replanChat(chatId, characterId);
  }

  isGeneratingStoryline(characterId: string): boolean {
    return this.generations.has(characterId);
  }

  cancelStorylineGeneration(characterId: string): boolean {
    const controller = this.generations.get(characterId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Asks the model for a narrative overview of the route, then saves the
   * route, guidance, and overview together so an expensive result is never lost.
   */
  async generateStoryline(chatId: string, characterId: string, input: StorylineDraftInput): Promise<void> {
    this.assertPermissions(STORYLINE_GENERATION_PERMISSIONS, "Generating a narrative overview");
    if (this.generations.has(characterId)) throw new Error("A narrative overview is already being generated for this character.");
    const settings = await this.settings();
    const context = await this.serial(chatId, () => this.context(chatId));
    const character = this.storylineCharacter(context, characterId);
    const indices = this.normalizeRoute(context, characterId, input.route);
    const notes = typeof input.notes === "string" ? input.notes.slice(0, STORYLINE_NOTES_LIMIT) : "";
    const route = indices.length ? indices : cardOrder(context.greetings, characterId);
    const greetings = route.flatMap((greetingIndex) => {
      const greeting = greetingForSelection(context.greetings, { characterId, greetingIndex });
      return greeting ? [greeting] : [];
    });
    if (!greetings.length) throw new Error("This character has no greetings to build a storyline from.");
    const prompt = renderGeneratorPrompt(settings, { character, route: greetings, notes });

    const controller = new AbortController();
    this.generations.set(characterId, controller);
    this.note("narrative overview generation started for " + characterId);
    let overview: string;
    try {
      const result = await this.api.generate.quiet({
        type: "quiet",
        messages: [{ role: "user", content: prompt }],
        ...(settings.storylineConnectionId ? { connection_id: settings.storylineConnectionId } : {}),
        ...(this.userId ? { userId: this.userId } : {}),
        signal: controller.signal,
      });
      overview = generatedText(result);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        this.note("narrative overview generation cancelled for " + characterId);
        throw new Error("Narrative overview generation was cancelled.");
      }
      this.warn("narrative overview generation failed: " + (error instanceof Error ? error.message : String(error)));
      throw error;
    } finally {
      this.generations.delete(characterId);
    }
    if (!overview) throw new Error("The model returned an empty narrative overview. Try again or adjust the generator instructions.");

    const previous = await this.storyline(characterId) ?? emptyStoryline(characterId);
    const previousRoute = resolveRoute(previous, context.greetings);
    const now = Date.now();
    await this.writeStoryline({
      ...previous,
      route: routeEntries(indices, context.greetings, characterId),
      notes,
      overview,
      overviewSignature: routeSignature(route, context.greetings, characterId),
      generatedAt: now,
      updatedAt: now,
    });
    this.note("narrative overview generated for " + characterId + " (" + String(overview.length) + " characters)");
    if (!sameRoute(previousRoute, indices)) await this.replanChat(chatId, characterId);
  }

  async listConnections(): Promise<ConnectionChoice[]> {
    if (!this.api.permissions.has("generation")) return [];
    const connections = await this.api.connections.list(this.userId);
    return connections.map((connection) => ({
      id: connection.id,
      name: connection.name || connection.id,
      model: connection.model || "",
      isDefault: Boolean(connection.is_default),
    }));
  }

  /**
   * The overview of the character whose greeting is in play: the current
   * greeting's character, else the upcoming one's, else the chat's main character.
   */
  private storylinePrompt(
    context: GreetingContext,
    state: WaypointChatState,
    settings: WaypointSettings,
  ): StorylinePromptStatus {
    const active = greetingForSelection(context.greetings, state.active);
    const upcoming = greetingForSelection(context.greetings, state.upcoming);
    const characterId = active?.characterId ?? upcoming?.characterId ?? (context.characterIds.includes(context.primaryCharacterId) ? context.primaryCharacterId : context.characterIds[0] ?? null);
    if (!characterId) return { ready: false, content: "", characterId: null, position: null, reason: "No character is loaded." };
    const storyline = context.storylines?.[characterId];
    const route = effectiveRoute(storyline, context.greetings, characterId);
    const position = storylinePosition(
      route,
      active?.characterId === characterId ? active.greetingIndex : null,
      upcoming?.characterId === characterId ? upcoming.greetingIndex : null,
    );
    const blocked = (reason: string): StorylinePromptStatus => ({ ready: false, content: "", characterId, position, reason });
    if (!storyline?.overview.trim()) return blocked("No narrative overview has been saved for this character.");
    if (context.greetings.length < 2) return blocked("This chat has no alternate greetings, so Waypoints stays off.");
    if (!state.chatEnabled) return blocked("Waypoints is off for this chat.");
    if (!state.storyOverview) return blocked("The narrative overview is off for this chat.");
    if (!this.isCharacterEnabled(context, state, characterId)) return blocked("This character's Waypoints switch is off.");
    const name = context.characters.find((entry) => entry.id === characterId)?.name || "the character";
    return { ready: true, content: renderStorylinePrompt(settings, storyline.overview, position, name), characterId, position };
  }

  private storylineView(context: GreetingContext, state: WaypointChatState, settings: WaypointSettings): StorylineView {
    const characters: StorylineCharacterView[] = context.characterIds.flatMap((characterId) => {
      if (!context.characters.some((entry) => entry.id === characterId)) return [];
      const storyline = context.storylines?.[characterId];
      return [{
        characterId,
        route: resolveRoute(storyline, context.greetings),
        effectiveRoute: effectiveRoute(storyline, context.greetings, characterId),
        notes: storyline?.notes ?? "",
        overview: storyline?.overview ?? "",
        generatedAt: storyline?.generatedAt ?? null,
        stale: isOverviewStale(storyline, context.greetings),
        updatedAt: storyline ? storyline.updatedAt : null,
        generating: this.generations.has(characterId),
      }];
    });
    return {
      routeEnabled: state.storyRoute,
      overviewEnabled: state.storyOverview,
      characters,
      prompt: this.storylinePrompt(context, state, settings),
    };
  }

  async intercept(messages: LlmMessageDTO[], chatId: string): Promise<LlmMessageDTO[] | InterceptorResultDTO> {
    try {
      const settings = await this.settings();
      if (!settings.autoPrompt) return messages;
      if (this.missingPermissions(CONTEXT_PERMISSIONS).length) return messages;
      // Awaited so a failed read falls back to the untouched prompt below
      // instead of rejecting the whole generation.
      return await this.serial(chatId, async () => {
        const context = await this.context(chatId);
        const state = reconcileChatState(await this.state(chatId), context);
        await this.reconcileJournalLocked(chatId, state, context, settings);
        const scene = this.promptStatus(context, state, settings);
        const story = this.storylinePrompt(context, state, settings);
        const entries: Array<{ value: LlmMessageDTO; depth: number; name: string }> = [];
        // The overview comes first when both share a depth: journey, then next scene.
        if (story.ready && story.content) {
          entries.push({ value: { role: settings.promptRole, content: story.content }, depth: settings.storylineInsertionDepth, name: "Waypoints: storyline overview" });
        }
        if (scene.ready && scene.content) {
          entries.push({ value: { role: settings.promptRole, content: scene.content }, depth: settings.insertionDepth, name: "Waypoints: upcoming scene" });
        }
        if (!entries.length) return messages;
        const result = insertAtDepths(messages, entries);
        return {
          messages: result,
          breakdown: entries.map((entry) => ({ messageIndex: result.indexOf(entry.value), name: entry.name })),
        };
      });
    } catch (error) {
      this.warn("prompt interceptor skipped: " + (error instanceof Error ? error.message : String(error)));
      return messages;
    }
  }

  /**
   * Read-only values for Loom macros. This intentionally does not reconcile or
   * persist a journal: macro resolution can be a dry pass and must not mutate
   * chat state simply because a preset was previewed.
   */
  async loomValues(chatId?: string): Promise<WaypointLoomValues> {
    if (!chatId || this.missingPermissions(CONTEXT_PERMISSIONS).length) return emptyLoomValues();
    try {
      return await this.serial(chatId, async () => {
        const settings = await this.settings();
        const context = await this.context(chatId);
        const state = reconcileChatState(await this.state(chatId), context);
        const active = greetingForSelection(context.greetings, state.active);
        const upcoming = greetingForSelection(context.greetings, state.upcoming);
        const altMessages = this.alternateMessages(context);
        const nextMessages = nextGreetingChoices(context.greetings, active, context.isGroupChat, chatRoutes(context, state))
          .map((greeting) => greeting.text);
        const prompt = this.promptStatus(context, state, settings);
        const ready = Boolean(
          active
          && this.isSelectionEnabled(context, state, state.active)
          && prompt.ready
          && prompt.content,
        );
        const story = this.storylinePrompt(context, state, settings);
        return {
          active: ready,
          content: ready ? prompt.content : "",
          altMessages,
          nextMessages,
          currentMessage: active?.text ?? "",
          nextMessage: upcoming?.text ?? "",
          storylineActive: story.ready,
          storyline: story.ready ? story.content : "",
        };
      });
    } catch {
      return emptyLoomValues();
    }
  }

  /** Number of alternate greeting slots on the currently active character card. */
  async activeAlternateGreetingCount(): Promise<number> {
    if (this.missingPermissions(CONTEXT_PERMISSIONS).length) return 0;
    try {
      const chatId = await this.getActiveChatId(await this.settings());
      if (!chatId) return 0;
      return await this.serial(chatId, async () => this.alternateMessages(await this.context(chatId)).length);
    } catch {
      return 0;
    }
  }

  private emptyView(
    settings: WaypointSettings,
    grantedPermissions: string[],
    missingPermissions: string[],
    status: string,
    reason: string,
  ): WaypointsView {
    return {
      chatId: null,
      chatEnabled: true,
      isGroupChat: false,
      grantedPermissions,
      characters: [],
      greetings: [],
      active: null,
      upcoming: null,
      canUndo: false,
      missingPermissions,
      status,
      settings,
      prompt: {
        ready: false,
        autoPrompt: settings.autoPrompt,
        role: settings.promptRole,
        insertionDepth: settings.insertionDepth,
        content: "",
        reason,
      },
      routes: {},
      storyline: emptyStorylineView(reason),
      diagnostics: this.diagnostics(),
    };
  }

  async view(chatId?: string | null): Promise<WaypointsView> {
    const settings = await this.settings();
    const grantedPermissions = await this.api.permissions.getGranted().catch(() => []);
    const missingPermissions = this.missingPermissions(["characters", "chats", "chat_mutation", "generation", "interceptor"]);
    if (this.missingPermissions(CONTEXT_PERMISSIONS).length) {
      return this.emptyView(settings, grantedPermissions, missingPermissions, "Grant characters and chats to load Waypoints.", "Chat context permission is missing.");
    }
    const resolvedChatId = chatId === undefined ? await this.getActiveChatId(settings) : chatId;
    if (!resolvedChatId) {
      return this.emptyView(settings, grantedPermissions, missingPermissions, "Open a character or group chat to use Waypoints.", "No active chat.");
    }
    return this.serial(resolvedChatId, async () => {
      const context = await this.context(resolvedChatId);
      const state = reconcileChatState(await this.state(resolvedChatId), context);
      await this.reconcileJournalLocked(resolvedChatId, state, context, settings);
      const prompt = this.promptStatus(context, state, settings);
      const active = greetingForSelection(context.greetings, state.active);
      const upcoming = greetingForSelection(context.greetings, state.upcoming);
      const canUndo = this.api.permissions.has("chat_mutation")
        ? Boolean(await this.latestInsertedGreeting(resolvedChatId).catch(() => null))
        : false;
      // A chat with fewer than two greetings has no alternate to advance to, so
      // Waypoints reads as off without writing state; gaining an alternate later
      // restores the stored choice.
      const hasGreetingChoices = context.greetings.length > 1;
      const status = !hasGreetingChoices
        ? "This chat has no alternate greetings, so Waypoints stays off."
        : !state.chatEnabled
        ? "Waypoints is off for this chat."
        : !state.upcoming
        ? "No upcoming greeting is selected."
        : !this.isSelectionEnabled(context, state, state.upcoming)
          ? "The selected upcoming character is turned off."
          : "Ready: " + upcoming?.characterName + " greeting " + String((upcoming?.greetingIndex ?? 0) + 1) + ".";
      return {
        chatId: resolvedChatId,
        chatEnabled: state.chatEnabled && hasGreetingChoices,
        isGroupChat: context.isGroupChat,
        grantedPermissions,
        characters: context.characters.map((character) => ({
          id: character.id,
          name: character.name,
          enabled: this.isCharacterEnabled(context, state, character.id),
        })),
        greetings: context.greetings,
        active,
        upcoming,
        canUndo,
        missingPermissions,
        status,
        settings,
        prompt,
        routes: chatRoutes(context, state),
        storyline: this.storylineView(context, state, settings),
        diagnostics: this.diagnostics(),
      };
    });
  }
}
