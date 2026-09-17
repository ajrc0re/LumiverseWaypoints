import { describe, expect, test } from "bun:test";
import { handoffSignal } from "../src/handoff-events";

describe("handoff event boundaries", () => {
  const message = { id: "reply", is_user: false, content: "<inject-prewritten-content />", swipe_id: 0 };
  test.each(["CHARACTER_MESSAGE_RENDERED", "CHAT_SWITCHED", "CHAT_CHANGED", "GENERATION_STARTED"])("%s is read-only", (event) => {
    expect(handoffSignal(event, { chatId: "chat", message })).toBeNull();
  });
  test("ignores swipe navigation and deletion", () => {
    for (const action of ["navigated", "deleted"]) {
      expect(handoffSignal("MESSAGE_SWIPED", { chatId: "chat", message, action, swipeId: 0 })).toBeNull();
    }
    expect(handoffSignal("MESSAGE_SWIPED", { chatId: "chat", message, action: "updated", swipeId: 1 })).toBeNull();
    expect(handoffSignal("MESSAGE_SWIPED", { chatId: "chat", message, action: "added", swipeId: 0 })?.sourceMessageId).toBe("reply");
  });
  test("empty, failed, and impersonated generations cannot reuse a historical tag", () => {
    for (const data of [{}, { error: "failed" }, { impersonateDraft: true }, { generationType: "impersonate" }]) {
      expect(handoffSignal("GENERATION_ENDED", { chatId: "chat", generationId: "generation", ...data })).toBeNull();
    }
    expect(handoffSignal("MESSAGE_EDITED", { chatId: "chat", message: { ...message, is_user: true } })).toBeNull();
  });
  test("preserves stopped-generation content and the saved source ID when available", () => {
    expect(handoffSignal("GENERATION_STOPPED", { chatId: "chat", generationId: "generation", content: message.content })).toMatchObject({
      chatId: "chat", eventKey: "chat:generation:generation", content: message.content,
    });
    expect(handoffSignal("GENERATION_ENDED", { chatId: "chat", generationId: "generation", messageId: "reply", content: message.content })?.sourceMessageId).toBe("reply");
  });
});
