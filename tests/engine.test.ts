import { describe, expect, test } from "bun:test";
import type {
  MessageContentProcessorCtxDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS } from "../src/config";
import { WaypointEngine } from "../src/engine";
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
            swipe_id: 0,
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
        },
      },
    } as unknown as SpindleAPI;
  }

  state(): ReturnType<typeof parseChatState> {
    return parseChatState(this.variables.get("chat:lumiverse_waypoints.state.v1"));
  }
}

describe("WaypointEngine prompt and processor", () => {
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
    expect(host.messages).toHaveLength(1);
  });

  test("handles edited and swiped handoffs with independent event keys", async () => {
    const host = new FakeLumiverse();
    const engine = new WaypointEngine(host.api);
    const edited = await engine.handleHandoff({
      chatId: "chat",
      eventKey: "chat:message:edited-1",
      content: "edited <inject-prewritten-content />",
    });
    const swiped = await engine.handleHandoff({
      chatId: "chat",
      eventKey: "chat:message:swiped-2",
      content: "swiped <inject-prewritten-content />",
    });
    expect(edited.advanced).toBe(true);
    expect(swiped.advanced).toBe(true);
    expect(host.messages.map((message) => message.content)).toEqual(["Greeting 2", "Greeting 3"]);
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
  });
});
