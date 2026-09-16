import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  macroIdentity,
  registerWaypointsLoomMacros,
  WAYPOINTS_ACTIVE_MACRO,
  WAYPOINTS_CONTENT_MACRO,
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

  test("registers volatile active and content macros with safe inactive output", async () => {
    const registered: RegisteredMacro[] = [];
    const api = {
      registerMacro(definition: unknown) {
        registered.push(definition as RegisteredMacro);
      },
    } as unknown as SpindleAPI;

    registerWaypointsLoomMacros(api, async ({ chatId, userId }) => ({
      active: chatId === "chat" && userId === "user",
      content: "Rendered scene prompt",
    }));

    expect(registered.map((definition) => definition.name)).toEqual([
      WAYPOINTS_ACTIVE_MACRO,
      WAYPOINTS_CONTENT_MACRO,
    ]);
    expect(registered.every((definition) => definition.volatile)).toBe(true);
    const context = { chatId: "chat", env: { extra: { userId: "user" } } };
    expect(await registered[0].handler(context)).toBe("true");
    expect(await registered[1].handler(context)).toBe("Rendered scene prompt");
    expect(await registered[1].handler({ chatId: "other" })).toBe("");
  });
});
