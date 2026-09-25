import type {
  ChatMessageDTO,
  InterceptorResultDTO,
  LlmMessageDTO,
  MessageContentProcessorCtxDTO,
  MessageContentProcessorResultDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS, settingsFromStorage, validateSettings } from "./config";
import { insertAtDepth, renderPrompt, stripHandoffTags } from "./prompt";
import {
  addRecentTransition,
  buildGreetingContext,
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
  CharacterGreetingSource,
  Greeting,
  GreetingContext,
  GreetingSelection,
  HandoffExtraMetadata,
  InsertedGreetingMetadata,
  PromptStatus,
  TransitionJournal,
  TransitionResult,
  WaypointChatState,
  WaypointLoomValues,
  WaypointSettings,
  WaypointsView,
} from "./types";

const AUTOMATIC_PERMISSIONS = ["characters", "chats", "chat_mutation", "generation"];
const CONTEXT_PERMISSIONS = ["characters", "chats"];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

export function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function selected(selection: GreetingSelection | null): GreetingSelection | null {
  return selection ? { characterId: selection.characterId, greetingIndex: selection.greetingIndex } : null;
}

function sourceCharacters(context: GreetingContext): CharacterGreetingSource[] {
  return context.characters;
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
    return buildGreetingContext(chat, characters);
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
    const character = sourceCharacters(context).find((entry) => entry.id === characterId);
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
    return selection !== null && this.isCharacterEnabled(context, state, selection.characterId);
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
        reason: "The upcoming greeting's character is turned off.",
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
    state.upcoming = nextGreetingForSelection(context.greetings, state.active);
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
      return { advanced: false, reason: "The upcoming greeting's character is turned off." };
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
        state.upcoming = nextGreetingForSelection(context.greetings, state.active);
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
        await this.api.characters.update(characterId, {
          extensions: { [EXTENSION_ID]: { enabled } },
        }, this.userId);
      }
      this.note("enabled state changed for " + characterId);
    });
  }

  async intercept(messages: LlmMessageDTO[], chatId: string): Promise<LlmMessageDTO[] | InterceptorResultDTO> {
    try {
      const settings = await this.settings();
      if (!settings.autoPrompt) return messages;
      if (this.missingPermissions(CONTEXT_PERMISSIONS).length) return messages;
      return this.serial(chatId, async () => {
        const context = await this.context(chatId);
        const state = reconcileChatState(await this.state(chatId), context);
        await this.reconcileJournalLocked(chatId, state, context, settings);
        const prompt = this.promptStatus(context, state, settings);
        if (!prompt.ready || !prompt.content) return messages;
        const injected: LlmMessageDTO = { role: settings.promptRole, content: prompt.content };
        const result = insertAtDepth(messages, injected, settings.insertionDepth);
        const index = result.indexOf(injected);
        return {
          messages: result,
          breakdown: [{ messageIndex: index, name: "Waypoints: upcoming scene" }],
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
    if (!chatId || this.missingPermissions(CONTEXT_PERMISSIONS).length) {
      return {
        active: false,
        content: "",
        altMessages: [],
        nextMessages: [],
        currentMessage: "",
        nextMessage: "",
      };
    }
    try {
      return this.serial(chatId, async () => {
        const settings = await this.settings();
        const context = await this.context(chatId);
        const state = reconcileChatState(await this.state(chatId), context);
        const active = greetingForSelection(context.greetings, state.active);
        const upcoming = greetingForSelection(context.greetings, state.upcoming);
        const altMessages = this.alternateMessages(context);
        const nextMessages = nextGreetingChoices(context.greetings, active, context.isGroupChat)
          .map((greeting) => greeting.text);
        const prompt = this.promptStatus(context, state, settings);
        const ready = Boolean(
          active
          && this.isSelectionEnabled(context, state, state.active)
          && prompt.ready
          && prompt.content,
        );
        return {
          active: ready,
          content: ready ? prompt.content : "",
          altMessages,
          nextMessages,
          currentMessage: active?.text ?? "",
          nextMessage: upcoming?.text ?? "",
        };
      });
    } catch {
      return {
        active: false,
        content: "",
        altMessages: [],
        nextMessages: [],
        currentMessage: "",
        nextMessage: "",
      };
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

  async view(chatId?: string | null): Promise<WaypointsView> {
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
          reason: "Chat context permission is missing.",
        },
        diagnostics: this.diagnostics(),
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
          reason: "No active chat.",
        },
        diagnostics: this.diagnostics(),
      };
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
      const status = !state.upcoming
        ? "No upcoming greeting is selected."
        : !this.isSelectionEnabled(context, state, state.upcoming)
          ? "The selected upcoming character is turned off."
          : "Ready: " + upcoming?.characterName + " greeting " + String((upcoming?.greetingIndex ?? 0) + 1) + ".";
      return {
        chatId: resolvedChatId,
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
        diagnostics: this.diagnostics(),
      };
    });
  }
}
