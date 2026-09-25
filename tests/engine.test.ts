import { describe, expect, test } from "bun:test";
import type {
  MessageContentProcessorCtxDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS } from "../src/config";
import { WaypointEngine } from "../src/engine";
import { handoffSignal } from "../src/handoff-events";
import { parseChatState } from "../src/state";
import {
  HANDOFF_EXTRA_KEY,
  INSERTED_GREETING_METADATA_KEY,
} from "../src/types";

interface FakeMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  extra?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  swipeId?: number;
}

class FakeLumiverse {
  readonly granted = new Set([
    "characters",
    "chats",
    "chat_mutation",
    "interceptor",
    "generation",
    "ui_panels",
  ]);
  readonly variables = new Map<string, string>();
  readonly messages: FakeMessage[] = [];
  readonly characters = new Map<string, {
    id: string;
    name: string;
    first_mes: string;
    alternate_greetings: string[];
    extensions: Record<string, unknown>;
  }>();
  readonly chatRecord = {
    id: "chat",
    character_id: "a",
    metadata: {},
  };
  settings: unknown = {};
  failAppend = false;
  writeThenThrow = false;
  onDelete?: () => void;
  private messageNumber = 0;
  readonly api: SpindleAPI;

  constructor(greetingCount = 3) {
    const alternates = Array.from({ length: Math.max(0, greetingCount - 1) }, (_entry, index) => "Greeting " + String(index + 2));
    this.characters.set("a", {
      id: "a",
      name: "Ada",
      first_mes: "Greeting 1",
      alternate_greetings: alternates,
      extensions: {},
    });
    const owner = this;
    this.api = {
      log: { info() {}, warn() {}, error() {} },
      permissions: {
        has(permission: string) { return owner.granted.has(permission); },
        async getGranted() { return [...owner.granted]; },
      },
      userStorage: {
        async getJson<T>(_path: string, options?: { fallback?: T }) {
          return (owner.settings === undefined ? options?.fallback : owner.settings) as T;
        },
        async setJson(_path: string, value: unknown) { owner.settings = structuredClone(value); },
      },
      variables: {
        chat: {
          async get(chatId: string, key: string) { return owner.variables.get(chatId + ":" + key) ?? ""; },
          async set(chatId: string, key: string, value: string) { owner.variables.set(chatId + ":" + key, value); },
        },
      },
      chats: {
        async get(chatId: string) { return chatId === owner.chatRecord.id ? structuredClone(owner.chatRecord) : null; },
        async getActive() { return structuredClone(owner.chatRecord); },
      },
      characters: {
        async get(characterId: string) {
          const character = owner.characters.get(characterId);
          return character ? structuredClone(character) : null;
        },
        async update(characterId: string, input: { extensions?: Record<string, unknown> }) {
          const character = owner.characters.get(characterId);
          if (!character) throw new Error("missing character");
          character.extensions = { ...character.extensions, ...input.extensions };
          return structuredClone(character);
        },
      },
      chat: {
        async getMessages() {
          return owner.messages.map((message, index) => ({
            id: message.id,
            chat_id: owner.chatRecord.id,
            index_in_chat: index,
            is_user: message.role === "user",
            name: "",
            content: message.content,
            send_date: 0,
            swipe_id: message.swipeId ?? 0,
            swipes: [message.content],
            role: message.role,
            extra: message.extra ?? {},
            metadata: message.metadata,
          }));
        },
        async appendMessage(_chatId: string, message: {
          role: "system" | "user" | "assistant";
          content: string;
          metadata?: Record<string, unknown>;
        }) {
          if (owner.failAppend) throw new Error("append failed");
          const id = "wp-" + String(++owner.messageNumber);
          owner.messages.push({ id, ...message });
          if (owner.writeThenThrow) throw new Error("connection closed after append");
          return { id };
        },
        async deleteMessage(_chatId: string, messageId: string) {
          const index = owner.messages.findIndex((message) => message.id === messageId);
          if (index < 0) throw new Error("missing message");
          owner.messages.splice(index, 1);
          owner.onDelete?.();
        },
      },
    } as unknown as SpindleAPI;
  }

  state(): ReturnType<typeof parseChatState> {
    return parseChatState(this.variables.get("chat:lumiverse_waypoints.state.v1"));
  }

  async assistantHandoff(engine: WaypointEngine, id: string, raw = "Continue.\n<inject-prewritten-content />"): Promise<FakeMessage> {
    const patch = await engine.processContent({ chatId: "chat", content: raw, isUser: false, origin: "create", userId: "user" });
    const message: FakeMessage = { id, role: "assistant", content: patch?.content ?? raw, extra: patch?.extra };
    this.messages.push(message);
    return message;
  }
}

describe("WaypointEngine prompt and processor", () => {
  test("an explicit empty frontend selection never falls back to the backend's previous chat", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    expect((await engine.view()).chatId).toBe("chat");
    const empty = await engine.view(null);
    expect(empty.chatId).toBeNull();
    expect(empty.characters).toEqual([]);
    expect(empty.greetings).toEqual([]);
    expect(empty.prompt.ready).toBe(false);
  });

  test("adds the rendered prompt at the configured interceptor depth with breakdown attribution", async () => {
    const host = new FakeLumiverse();
    host.settings = { ...DEFAULT_SETTINGS, autoPrompt: true, insertionDepth: 1 };
    const engine = new WaypointEngine(host.api);
    const result = await engine.intercept([
      { role: "system", content: "old" },
      { role: "user", content: "new" },
    ], "chat");
    expect(Array.isArray(result)).toBe(false);
    const intercepted = result as Exclude<typeof result, unknown[]>;
    expect(intercepted.messages).toHaveLength(3);
    expect(intercepted.messages[1].content).toContain("Greeting 2");
    expect(intercepted.breakdown).toEqual([{ messageIndex: 1, name: "Waypoints: upcoming scene" }]);
  });

  test("exposes read-only Loom values only while the selected Waypoints path is ready", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);

    const ready = await engine.loomValues("chat");
    expect(ready.active).toBe(true);
    expect(ready.content).toContain("Greeting 2");
    expect(ready.altMessages).toEqual(["Greeting 2", "Greeting 3"]);
    // Macro previews must not create a chat variable or reconcile state.
    expect(host.variables.size).toBe(0);

    await engine.setEnabled("chat", "a", false);
    expect(await engine.loomValues("chat")).toEqual({
      active: false,
      content: "",
      altMessages: ["Greeting 2", "Greeting 3"],
    });
  });

  test("strips and stamps configured handoff tags in the content processor", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    const patch = await engine.processContent({
      chatId: "chat",
      content: "Continue.\n<inject-prewritten-content />",
      isUser: false,
      origin: "create",
      userId: "user",
    } as MessageContentProcessorCtxDTO);
    expect(patch?.content).toBe("Continue.");
    expect(patch?.extra?.[HANDOFF_EXTRA_KEY]).toMatchObject({
      version: 1,
      tagName: "inject-prewritten-content",
      tagCount: 1,
    });
  });
});

describe("WaypointEngine transitions", () => {
  test("journals a forced transition and stamps the inserted greeting", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    const result = await engine.force("chat");
    expect(result.advanced).toBe(true);
    expect(host.messages).toHaveLength(1);
    expect(host.messages[0].content).toBe("Greeting 2");
    expect(host.messages[0].metadata?.[INSERTED_GREETING_METADATA_KEY]).toMatchObject({
      kind: "inserted-greeting",
      target: { characterId: "a", greetingIndex: 1 },
    });
    expect(host.state().active).toEqual({ characterId: "a", greetingIndex: 1 });
    expect(host.state().upcoming).toEqual({ characterId: "a", greetingIndex: 2 });
    expect(host.state().journal).toBeNull();
  });

  test("advances a stopped-generation handoff once and suppresses duplicate events", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    await host.assistantHandoff(engine, "stopped-reply", "Partial response\n<inject-prewritten-content />");
    const first = await engine.handleHandoff({
      chatId: "chat",
      eventKey: "chat:generation:stopped-1",
      content: "Partial response\n<inject-prewritten-content />",
    });
    const duplicate = await engine.handleHandoff({
      chatId: "chat",
      eventKey: "chat:generation:stopped-1",
      content: "Partial response\n<inject-prewritten-content />",
    });
    expect(first.advanced).toBe(true);
    expect(duplicate.advanced).toBe(false);
    expect(host.messages.filter((message) => message.metadata?.[INSERTED_GREETING_METADATA_KEY])).toHaveLength(1);
  });

  test("handles edited and swiped handoffs with independent event keys", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    await host.assistantHandoff(engine, "edited-1", "edited <inject-prewritten-content />");
    const edited = await engine.handleHandoff({
      chatId: "chat",
      eventKey: "chat:message:edited-1",
      content: "edited <inject-prewritten-content />",
    });
    await host.assistantHandoff(engine, "swiped-2", "swiped <inject-prewritten-content />");
    const swiped = await engine.handleHandoff({
      chatId: "chat",
      eventKey: "chat:message:swiped-2",
      content: "swiped <inject-prewritten-content />",
    });
    expect(edited.advanced).toBe(true);
    expect(swiped.advanced).toBe(true);
    expect(host.messages.filter((message) => message.metadata).map((message) => message.content)).toEqual(["Greeting 2", "Greeting 3"]);
  });

  test("rolls back state when insertion fails without touching existing messages", async () => {
    const host = new FakeLumiverse();
    host.failAppend = true;
    const engine = new WaypointEngine(host.api);
    const result = await engine.force("chat");
    expect(result.advanced).toBe(false);
    expect(host.messages).toHaveLength(0);
    expect(host.state().journal).toBeNull();
    expect(host.state().active).toEqual({ characterId: "a", greetingIndex: 0 });
    expect(host.state().upcoming).toEqual({ characterId: "a", greetingIndex: 1 });
  });

  test("reconciles a restart journal against its stamped greeting before more work", async () => {
    const host = new FakeLumiverse();
    host.variables.set("chat:lumiverse_waypoints.state.v1", JSON.stringify({
      version: 1,
      active: { characterId: "a", greetingIndex: 0 },
      upcoming: { characterId: "a", greetingIndex: 1 },
      groupEnabledByCharacter: {},
      pendingHandoffs: [],
      recentTransitionKeys: [],
      journal: {
        id: "restart-journal",
        eventKey: "chat:generation:restart",
        target: { characterId: "a", greetingIndex: 1 },
        previousActive: { characterId: "a", greetingIndex: 0 },
        previousUpcoming: { characterId: "a", greetingIndex: 1 },
        createdAt: 1,
        phase: "prepared",
      },
    }));
    host.messages.push({
      id: "written-before-restart",
      role: "assistant",
      content: "Greeting 2",
      metadata: {
        [INSERTED_GREETING_METADATA_KEY]: {
          kind: "inserted-greeting",
          version: 1,
          journalId: "restart-journal",
          eventKey: "chat:generation:restart",
          target: { characterId: "a", greetingIndex: 1 },
          previousActive: { characterId: "a", greetingIndex: 0 },
          previousUpcoming: { characterId: "a", greetingIndex: 1 },
          contentHash: "any",
          insertedAt: 1,
        },
      },
    });
    const restarted = new WaypointEngine(host.api);
    const view = await restarted.view("chat");
    expect(view.active?.greetingIndex).toBe(1);
    expect(view.upcoming?.greetingIndex).toBe(2);
    expect(host.state().journal).toBeNull();
    expect(host.messages).toHaveLength(1);
  });

  test("undo deletes only Waypoints metadata, never an unrelated same-text user message", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    host.messages.push({ id: "user-copy", role: "user", content: "Greeting 2" });
    const noMetadataUndo = await engine.undo("chat");
    expect(noMetadataUndo.advanced).toBe(false);
    expect(host.messages.map((message) => message.id)).toEqual(["user-copy"]);

    const forced = await engine.force("chat");
    expect(forced.advanced).toBe(true);
    host.messages.push({ id: "later-user", role: "user", content: "Greeting 2" });
    const undone = await engine.undo("chat");
    expect(undone.advanced).toBe(true);
    expect(host.messages.map((message) => message.id)).toEqual(["user-copy", "later-user"]);
    expect(host.state().active).toEqual({ characterId: "a", greetingIndex: 0 });
    expect(host.state().upcoming).toEqual({ characterId: "a", greetingIndex: 1 });
  });

  test.each(["generation-first", "edit-first"])("deduplicates raw and stripped notifications for a reply (%s)", async (order) => {
    const host = new FakeLumiverse(4);
    const engine = new WaypointEngine(host.api);
    const raw = "Continue.\n<inject-prewritten-content />";
    const message = await host.assistantHandoff(engine, "reply", raw);
    const generation = handoffSignal("GENERATION_ENDED", { chatId: "chat", generationId: "gen", messageId: message.id, content: raw })!;
    const edited = handoffSignal("MESSAGE_EDITED", { chatId: "chat", message })!;
    const signals = order === "generation-first" ? [generation, edited] : [edited, generation];
    expect((await engine.handleHandoff(signals[0])).advanced).toBe(true);
    expect((await engine.handleHandoff(signals[1])).advanced).toBe(false);
    // Returning to a chat, refreshing its view, or restarting must not append again.
    const restarted = new WaypointEngine(host.api);
    for (const event of ["CHAT_SWITCHED", "CHARACTER_MESSAGE_RENDERED", "CHAT_CHANGED"]) {
      expect(handoffSignal(event, { chatId: "chat", message })).toBeNull();
      await restarted.view("chat");
    }
    expect((await restarted.handleHandoff(edited)).advanced).toBe(false);
    expect(host.messages.filter((entry) => entry.metadata)).toHaveLength(1);
    expect(host.state().active?.greetingIndex).toBe(1);
    expect(host.state().upcoming?.greetingIndex).toBe(2);
  });

  test("undo restores the exact pair and delayed notifications cannot advance it again", async () => {
    const host = new FakeLumiverse(6);
    const engine = new WaypointEngine(host.api);
    await engine.setActive("chat", { characterId: "a", greetingIndex: 1 });
    await engine.setUpcoming("chat", { characterId: "a", greetingIndex: 4 });
    const message = await host.assistantHandoff(engine, "source");
    const signal = handoffSignal("MESSAGE_EDITED", { chatId: "chat", message })!;
    await engine.handleHandoff(signal);
    expect(host.state().active?.greetingIndex).toBe(4);
    expect(host.state().upcoming?.greetingIndex).toBe(5);
    const delayed: Array<Promise<unknown>> = [];
    host.onDelete = () => { delayed.push(engine.handleHandoff({ ...signal, eventKey: "late-other-event" })); };
    const undone = await engine.undo("chat");
    await Promise.all(delayed);
    expect(undone.advanced).toBe(true);
    expect(host.messages.map((entry) => entry.id)).toEqual(["source"]);
    expect(host.state().active?.greetingIndex).toBe(1);
    expect(host.state().upcoming?.greetingIndex).toBe(4);
    const restarted = new WaypointEngine(host.api);
    expect((await restarted.handleHandoff(signal)).advanced).toBe(false);
    const view = await restarted.view("chat");
    expect(view.active?.greetingIndex).toBe(1);
    expect(view.upcoming?.greetingIndex).toBe(4);
    // Explicit Force remains available after Undo.
    expect((await restarted.force("chat")).advanced).toBe(true);
    expect(host.messages.at(-1)?.content).toBe("Greeting 5");
  });

  test("undo restores a group path across different characters", async () => {
    const host = new FakeLumiverse();
    host.characters.set("b", { id: "b", name: "Bryn", first_mes: "Bryn 1", alternate_greetings: ["Bryn 2"], extensions: {} });
    host.chatRecord.metadata = { character_ids: ["a", "b"] };
    const engine = new WaypointEngine(host.api);
    await engine.setActive("chat", { characterId: "a", greetingIndex: 2 });
    await engine.setUpcoming("chat", { characterId: "b", greetingIndex: 0 });
    await engine.force("chat");
    await engine.undo("chat");
    const view = await engine.view("chat");
    expect(view.active).toMatchObject({ characterId: "a", greetingIndex: 2 });
    expect(view.upcoming).toMatchObject({ characterId: "b", greetingIndex: 0 });
  });

  test.each([false, true])("undoing Force does not re-arm its source tag (legacy metadata: %s)", async (legacy) => {
    const host = new FakeLumiverse(4);
    const engine = new WaypointEngine(host.api);
    const source = await host.assistantHandoff(engine, "source");
    await engine.force("chat");
    const metadata = host.messages.at(-1)!.metadata![INSERTED_GREETING_METADATA_KEY] as Record<string, unknown>;
    if (legacy) {
      delete metadata.handoffKey;
      delete metadata.sourceMessageId;
      const state = host.state();
      state.recentTransitionKeys = [metadata.eventKey as string];
      host.variables.set("chat:lumiverse_waypoints.state.v1", JSON.stringify(state));
    } else {
      const late = handoffSignal("GENERATION_ENDED", { chatId: "chat", generationId: "late", messageId: source.id, content: source.content })!;
      expect((await engine.handleHandoff(late)).advanced).toBe(false);
    }
    await engine.undo("chat");
    const replay = handoffSignal("MESSAGE_EDITED", { chatId: "chat", message: source })!;
    expect((await new WaypointEngine(host.api).handleHandoff(replay)).advanced).toBe(false);
    expect(host.messages.map((entry) => entry.id)).toEqual(["source"]);
    expect(host.state().active?.greetingIndex).toBe(0);
    expect(host.state().upcoming?.greetingIndex).toBe(1);
  });

  test("the stamped insertion still prevents replay after its recent key has expired", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    const message = await host.assistantHandoff(engine, "source");
    const signal = handoffSignal("MESSAGE_EDITED", { chatId: "chat", message })!;
    await engine.handleHandoff(signal);
    const state = host.state();
    state.recentTransitionKeys = [];
    host.variables.set("chat:lumiverse_waypoints.state.v1", JSON.stringify(state));
    expect((await new WaypointEngine(host.api).handleHandoff(signal)).advanced).toBe(false);
    expect(host.messages.filter((entry) => entry.metadata)).toHaveLength(1);
  });

  test("a terminal event cannot find an old tag behind a newer untagged reply", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    await host.assistantHandoff(engine, "old-source");
    host.messages.push({ id: "new-source", role: "assistant", content: "No handoff here." });
    const result = await engine.handleHandoff({ chatId: "chat", eventKey: "stopped-new", content: "No handoff here." });
    expect(result.advanced).toBe(false);
    expect(host.messages).toHaveLength(2);
  });

  test("a stale handoff stamp does not trigger after its reply has changed", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    const message = await host.assistantHandoff(engine, "source");
    message.content = "Edited to remove the handoff.";
    const result = await engine.handleHandoff(handoffSignal("MESSAGE_EDITED", { chatId: "chat", message })!);
    expect(result.advanced).toBe(false);
    expect(host.messages).toHaveLength(1);
  });

  test("each newly generated swipe can hand off once, without processing user or inserted messages", async () => {
    const host = new FakeLumiverse(5);
    const engine = new WaypointEngine(host.api);
    const message = await host.assistantHandoff(engine, "source");
    const signal = handoffSignal("MESSAGE_EDITED", { chatId: "chat", message })!;
    expect((await engine.handleHandoff(signal)).advanced).toBe(true);
    message.swipeId = 1;
    expect((await engine.handleHandoff(signal)).advanced).toBe(true);
    expect((await engine.handleHandoff(signal)).advanced).toBe(false);
    const inserted = host.messages.at(-1)!;
    inserted.content += " <inject-prewritten-content />";
    expect((await engine.handleHandoff({ chatId: "chat", sourceMessageId: inserted.id, eventKey: "inserted", content: inserted.content })).advanced).toBe(false);
    host.messages.push({ id: "user", role: "user", content: "<inject-prewritten-content />" });
    expect((await engine.handleHandoff({ chatId: "chat", sourceMessageId: "user", eventKey: "user", content: "<inject-prewritten-content />" })).advanced).toBe(false);
    expect(await engine.processContent({ chatId: "chat", userId: "user", origin: "create", isUser: true, content: "<inject-prewritten-content />" })).toBeUndefined();
  });
});
