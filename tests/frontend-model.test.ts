import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/config";
import {
  canShowHud,
  cloneSettingsDraft,
  draftValidation,
  approximatePromptTokenCount,
  formatPromptCount,
  greetingPickerOptions,
  nextDrawerPage,
  resetSettingsDraft,
  shouldRefreshDrawer,
} from "../src/frontend-model";
import type { Greeting, WaypointsView } from "../src/types";

describe("drawer model", () => {
  test("formats exact and approximate rendered prompt counts", () => {
    expect(formatPromptCount(1234, 5678, false)).toBe("1234 Tokens / 5678 Characters");
    expect(formatPromptCount(1234, 5678, true)).toBe("~1234 Tokens / 5678 Characters");
    expect(approximatePromptTokenCount(5678)).toBe(1420);
  });

  test("switches between Waypoints and Settings tabs", () => {
    expect(nextDrawerPage("waypoints", "next")).toBe("settings");
    expect(nextDrawerPage("settings", "previous")).toBe("waypoints");
  });

  test("keeps settings as a draft until it validates, and resets cleanly", () => {
    const draft = cloneSettingsDraft(DEFAULT_SETTINGS);
    draft.promptTemplate = "{{handoff_tag}}";
    expect(draftValidation(draft).valid).toBe(false);
    const reset = resetSettingsDraft();
    expect(reset).toEqual(DEFAULT_SETTINGS);
    expect(reset).not.toBe(DEFAULT_SETTINGS);
    expect(draftValidation(reset).valid).toBe(true);
  });

  test("refreshes drawer status on chat lifecycle changes", () => {
    expect(shouldRefreshDrawer("CHAT_SWITCHED")).toBe(true);
    expect(shouldRefreshDrawer("CHAT_CHANGED")).toBe(true);
    expect(shouldRefreshDrawer("waypoints:changed")).toBe(true);
    expect(shouldRefreshDrawer("MESSAGE_SENT")).toBe(false);
  });

  test("shows HUD only when both visibility and ui_panels permission allow it", () => {
    expect(canShowHud(true, ["ui_panels"])).toBe(true);
    expect(canShowHud(false, ["ui_panels"])).toBe(false);
    expect(canShowHud(true, ["characters"])).toBe(false);
  });

  test("keeps greeting picker options aligned with solo and group rules", () => {
    const greetings: Greeting[] = [
      { characterId: "a", characterName: "Ada", greetingIndex: 0, text: "Ada 1" },
      { characterId: "a", characterName: "Ada", greetingIndex: 1, text: "Ada 2" },
      { characterId: "b", characterName: "Bryn", greetingIndex: 0, text: "Bryn 1" },
    ];
    const solo = { isGroupChat: false, active: greetings[0], greetings } as WaypointsView;
    expect(greetingPickerOptions("current", solo)).toEqual(greetings);
    expect(greetingPickerOptions("next", solo)).toEqual([greetings[1]]);

    const group = { isGroupChat: true, active: greetings[0], greetings } as WaypointsView;
    expect(greetingPickerOptions("next", group)).toEqual([greetings[1], greetings[2]]);
  });
});
