import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  macroIdentity,
  registerWaypointsLoomMacros,
  WAYPOINTS_ALT_MESSAGES_MACRO,
  WAYPOINTS_ACTIVE_MACRO,
  WAYPOINTS_CONTENT_MACRO,
  WAYPOINTS_CURRENT_MESSAGE_MACRO,
  WAYPOINTS_NEXT_MESSAGE_MACRO,
  WAYPOINTS_NEXT_MESSAGES_MACRO,
} from "../src/loom-macros";

type RegisteredMacro = {
  name: string;
  volatile: boolean;
  handler: (context: unknown) => Promise<string>;
};

describe("Waypoints Loom macros", () => {
  test("uses the host chat and user context when it is available", () => {
    expect(macroIdentity({
      chatId: "top-level-chat",
      userId: "top-level-user",
      env: { chat: { id: "nested-chat" }, extra: { userId: "nested-user" } },
    })).toEqual({ chatId: "top-level-chat", userId: "top-level-user" });
    expect(macroIdentity({
      env: { chat: { id: "nested-chat" }, extra: { userId: "nested-user" } },
    })).toEqual({ chatId: "nested-chat", userId: "nested-user" });
  });

  test("resolves the current character's alternate greetings without carrying old values forward", async () => {
    const registered: RegisteredMacro[] = [];
    const api = {
      registerMacro(definition: unknown) {
        registered.push(definition as RegisteredMacro);
      },
      unregisterMacro(name: string) {
        const index = registered.findIndex((definition) => definition.name === name);
        if (index >= 0) registered.splice(index, 1);
      },
    } as unknown as SpindleAPI;

    let altMessages = Array.from({ length: 9 }, (_, index) => `Character A greeting ${index + 2}`);
    let nextMessages = Array.from({ length: 6 }, (_, index) => `Character A greeting ${index + 5}`);
    let currentMessage = "Character A greeting 4";
    let nextMessage = "Character A greeting 6";
    const ensureAlternateGreetingMacros = registerWaypointsLoomMacros(api, async ({ chatId, userId }) => ({
      active: chatId === "chat" && userId === "user",
      content: "Rendered scene prompt",
      altMessages,
      nextMessages,
      currentMessage,
      nextMessage,
    }));
    ensureAlternateGreetingMacros(altMessages.length);

    expect(registered.map((definition) => definition.name)).toEqual([
      WAYPOINTS_ACTIVE_MACRO,
      WAYPOINTS_CONTENT_MACRO,
      WAYPOINTS_ALT_MESSAGES_MACRO,
      WAYPOINTS_NEXT_MESSAGES_MACRO,
      WAYPOINTS_CURRENT_MESSAGE_MACRO,
      WAYPOINTS_NEXT_MESSAGE_MACRO,
      ...Array.from({ length: 9 }, (_, index) => `altMessage${index + 1}`),
    ]);
    expect(registered.every((definition) => definition.volatile)).toBe(true);
    const context = { chatId: "chat", env: { extra: { userId: "user" } } };
    const macro = (name: string) => registered.find((definition) => definition.name === name)!;
    expect(await macro(WAYPOINTS_ACTIVE_MACRO).handler(context)).toBe("true");
    expect(await macro(WAYPOINTS_CONTENT_MACRO).handler(context)).toBe("Rendered scene prompt");
    expect(await macro(WAYPOINTS_ALT_MESSAGES_MACRO).handler(context)).toBe(JSON.stringify(altMessages));
    expect(await macro(WAYPOINTS_NEXT_MESSAGES_MACRO).handler(context)).toBe(JSON.stringify(nextMessages));
    expect(await macro(WAYPOINTS_CURRENT_MESSAGE_MACRO).handler(context)).toBe(currentMessage);
    expect(await macro(WAYPOINTS_NEXT_MESSAGE_MACRO).handler(context)).toBe(nextMessage);
    expect(await macro("altMessage9").handler(context)).toBe("Character A greeting 10");

    // Switching to a character with two total greetings leaves one alternate.
    altMessages = ["Character B greeting 2"];
    nextMessages = [];
    currentMessage = "Character B greeting 2";
    nextMessage = "";
    ensureAlternateGreetingMacros(altMessages.length);
    expect(await macro("altMessage1").handler(context)).toBe("Character B greeting 2");
    expect(registered.some((definition) => definition.name === "altMessage2")).toBe(false);
    expect(registered.some((definition) => definition.name === "altMessage9")).toBe(false);
    expect(await macro(WAYPOINTS_ALT_MESSAGES_MACRO).handler(context)).toBe('["Character B greeting 2"]');
    expect(await macro(WAYPOINTS_NEXT_MESSAGES_MACRO).handler(context)).toBe("[]");
    expect(await macro(WAYPOINTS_CURRENT_MESSAGE_MACRO).handler(context)).toBe("Character B greeting 2");
    expect(await macro(WAYPOINTS_NEXT_MESSAGE_MACRO).handler(context)).toBe("");
    expect(await macro(WAYPOINTS_CONTENT_MACRO).handler({ chatId: "other" })).toBe("");
  });
});
