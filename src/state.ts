import type {
  CharacterGreetingSource,
  ChatGreetingSource,
  Greeting,
  GreetingContext,
  GreetingSelection,
  PendingHandoff,
  TransitionJournal,
  WaypointChatState,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function selectionFrom(value: unknown): GreetingSelection | null {
  if (!isRecord(value) || typeof value.characterId !== "string" || !Number.isInteger(value.greetingIndex)) return null;
  return { characterId: value.characterId, greetingIndex: Number(value.greetingIndex) };
}

function journalFrom(value: unknown): TransitionJournal | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.eventKey !== "string") return null;
  const target = selectionFrom(value.target);
  if (!target) return null;
  const phase = value.phase === "appended" ? "appended" : value.phase === "prepared" ? "prepared" : null;
  if (!phase) return null;
  return {
    id: value.id,
    eventKey: value.eventKey,
    handoffKey: typeof value.handoffKey === "string" ? value.handoffKey : undefined,
    sourceMessageId: typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined,
    target,
    previousActive: selectionFrom(value.previousActive),
    previousUpcoming: selectionFrom(value.previousUpcoming),
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now(),
    phase,
    insertedMessageId: typeof value.insertedMessageId === "string" ? value.insertedMessageId : undefined,
  };
}

function pendingFrom(value: unknown): PendingHandoff[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.eventKey !== "string" || typeof entry.contentHash !== "string") return [];
    return [{
      eventKey: entry.eventKey,
      contentHash: entry.contentHash,
      sourceMessageId: typeof entry.sourceMessageId === "string" ? entry.sourceMessageId : undefined,
      tagCount: Number.isInteger(entry.tagCount) ? Number(entry.tagCount) : 1,
      at: Number.isFinite(entry.at) ? Number(entry.at) : Date.now(),
    }];
  });
}

export function emptyChatState(): WaypointChatState {
  return {
    version: 1,
    chatEnabled: true,
    active: null,
    upcoming: null,
    groupEnabledByCharacter: {},
    pendingHandoffs: [],
    recentTransitionKeys: [],
    journal: null,
  };
}

export function parseChatState(value: string | undefined | null): WaypointChatState {
  if (!value) return emptyChatState();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return emptyChatState();
    const rawEnabled = isRecord(parsed.groupEnabledByCharacter) ? parsed.groupEnabledByCharacter : {};
    const groupEnabledByCharacter: Record<string, boolean> = {};
    for (const [characterId, enabled] of Object.entries(rawEnabled)) {
      if (typeof enabled === "boolean") groupEnabledByCharacter[characterId] = enabled;
    }
    return {
      version: 1,
      chatEnabled: parsed.chatEnabled !== false,
      active: selectionFrom(parsed.active),
      upcoming: selectionFrom(parsed.upcoming),
      groupEnabledByCharacter,
      pendingHandoffs: pendingFrom(parsed.pendingHandoffs),
      recentTransitionKeys: stringArray(parsed.recentTransitionKeys),
      journal: journalFrom(parsed.journal),
    };
  } catch {
    return emptyChatState();
  }
}

export function serializeChatState(state: WaypointChatState): string {
  return JSON.stringify(state);
}

export function selectionKey(selection: GreetingSelection | null | undefined): string {
  return selection ? selection.characterId + ":" + String(selection.greetingIndex) : "";
}

export function sameSelection(left: GreetingSelection | null | undefined, right: GreetingSelection | null | undefined): boolean {
  return selectionKey(left) === selectionKey(right);
}

export function groupCharacterIds(chat: ChatGreetingSource): string[] {
  const metadata = chat.metadata ?? {};
  const direct = stringArray(metadata.character_ids);
  const nested = isRecord(metadata.group) ? stringArray(metadata.group.character_ids) : [];
  const ids = direct.length ? direct : nested;
  const unique = [...new Set(ids)];
  return unique.length > 1 ? unique : [chat.character_id];
}

export function buildGreetingContext(
  chat: ChatGreetingSource,
  characters: CharacterGreetingSource[],
): GreetingContext {
  const characterIds = groupCharacterIds(chat);
  const included = characters.filter((character) => characterIds.includes(character.id));
  const greetings: Greeting[] = [];
  for (const character of included) {
    const all = [character.first_mes, ...(character.alternate_greetings ?? [])];
    for (let greetingIndex = 0; greetingIndex < all.length; greetingIndex += 1) {
      const text = typeof all[greetingIndex] === "string" ? all[greetingIndex].trim() : "";
      if (text) {
        greetings.push({
          characterId: character.id,
          characterName: character.name || "Unnamed character",
          greetingIndex,
          text,
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
    greetings,
  };
}

export function greetingForSelection(
  greetings: readonly Greeting[],
  selection: GreetingSelection | null | undefined,
): Greeting | null {
  if (!selection) return null;
  return greetings.find(
    (greeting) =>
      greeting.characterId === selection.characterId &&
      greeting.greetingIndex === selection.greetingIndex,
  ) ?? null;
}

export function firstGreetingForCharacter(
  greetings: readonly Greeting[],
  characterId: string,
): GreetingSelection | null {
  const greeting = greetings.find((entry) => entry.characterId === characterId);
  return greeting
    ? { characterId: greeting.characterId, greetingIndex: greeting.greetingIndex }
    : null;
}

export function nextGreetingForSelection(
  greetings: readonly Greeting[],
  selection: GreetingSelection | null,
): GreetingSelection | null {
  if (!selection) return null;
  const following = greetings.find(
    (entry) =>
      entry.characterId === selection.characterId &&
      entry.greetingIndex > selection.greetingIndex,
  );
  return following
    ? { characterId: following.characterId, greetingIndex: following.greetingIndex }
    : null;
}

/** Greeting choices shown by the next-greeting picker for this current selection. */
export function nextGreetingChoices(
  greetings: readonly Greeting[],
  active: Greeting | null,
  isGroupChat: boolean,
): Greeting[] {
  if (!active) return [...greetings];
  if (isGroupChat) {
    return greetings.filter((greeting) =>
      greeting.characterId !== active.characterId || greeting.greetingIndex !== active.greetingIndex,
    );
  }
  return greetings.filter((greeting) =>
    greeting.characterId === active.characterId && greeting.greetingIndex > active.greetingIndex,
  );
}

export function defaultSelections(context: GreetingContext): Pick<WaypointChatState, "active" | "upcoming"> {
  const active =
    firstGreetingForCharacter(context.greetings, context.primaryCharacterId) ??
    (context.greetings[0]
      ? { characterId: context.greetings[0].characterId, greetingIndex: context.greetings[0].greetingIndex }
      : null);
  return { active, upcoming: nextGreetingForSelection(context.greetings, active) };
}

export function reconcileChatState(
  state: WaypointChatState,
  context: GreetingContext,
): WaypointChatState {
  const defaults = defaultSelections(context);
  const active = greetingForSelection(context.greetings, state.active) ? state.active : defaults.active;
  let upcoming = greetingForSelection(context.greetings, state.upcoming) ? state.upcoming : nextGreetingForSelection(context.greetings, active);
  if (sameSelection(active, upcoming)) upcoming = nextGreetingForSelection(context.greetings, active);
  const allowedCharacters = new Set(context.characterIds);
  const enabled: Record<string, boolean> = {};
  for (const [characterId, value] of Object.entries(state.groupEnabledByCharacter)) {
    if (allowedCharacters.has(characterId)) enabled[characterId] = value;
  }
  return {
    ...state,
    active,
    upcoming,
    groupEnabledByCharacter: enabled,
  };
}

export function addRecentTransition(
  state: WaypointChatState,
  eventKey: string,
  limit: number,
): void {
  state.recentTransitionKeys = [
    ...state.recentTransitionKeys.filter((entry) => entry !== eventKey),
    eventKey,
  ].slice(-limit);
}

export function rememberPendingHandoff(
  state: WaypointChatState,
  pending: PendingHandoff,
  limit: number,
): void {
  state.pendingHandoffs = [
    ...state.pendingHandoffs.filter((entry) => entry.eventKey !== pending.eventKey),
    pending,
  ].slice(-limit);
}

export function consumePendingHandoff(state: WaypointChatState, eventKey: string): void {
  state.pendingHandoffs = state.pendingHandoffs.filter((entry) => entry.eventKey !== eventKey);
}
