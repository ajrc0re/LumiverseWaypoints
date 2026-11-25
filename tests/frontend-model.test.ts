import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/config";
import {
  canShowHud,
  cloneSettingsDraft,
  draftValidation,
  approximatePromptTokenCount,
  formatPromptCount,
  greetingPickerOptions,
  GENERAL_SETTING_KEYS,
  PROMPT_SETTING_KEYS,
  nextDrawerPage,
  reminderPhase,
  reminderTimeline,
  resetDraftFields,
  resetSettingsDraft,
  shouldRefreshDrawer,
  shouldShowReminder,
} from "../src/frontend-model";
import type { Greeting, WaypointsView } from "../src/types";

describe("drawer model", () => {
  test("formats exact and approximate rendered prompt counts", () => {
    expect(formatPromptCount(1234, 5678, false)).toBe("1234 Tokens / 5678 Characters");
    expect(formatPromptCount(1234, 5678, true)).toBe("~1234 Tokens / 5678 Characters");
    expect(approximatePromptTokenCount(5678)).toBe(1420);
  });

  test("cycles through the Waypoints, Storyline, Prompts, and Settings tabs", () => {
    expect(nextDrawerPage("waypoints", "next")).toBe("storyline");
    expect(nextDrawerPage("storyline", "next")).toBe("prompts");
    expect(nextDrawerPage("prompts", "next")).toBe("settings");
    expect(nextDrawerPage("settings", "next")).toBe("waypoints");
    expect(nextDrawerPage("settings", "previous")).toBe("prompts");
    expect(nextDrawerPage("waypoints", "previous")).toBe("settings");
  });

  test("splits settings between the Prompts and Settings tabs and resets each on its own", () => {
    expect(GENERAL_SETTING_KEYS.some((key) => (PROMPT_SETTING_KEYS as readonly string[]).includes(key))).toBe(false);
    expect(GENERAL_SETTING_KEYS).toContain("reminderShowOn");
    expect(GENERAL_SETTING_KEYS).not.toContain("storylineConnectionId");
    const draft = { ...DEFAULT_SETTINGS, promptTemplate: "custom", reminderDurationSeconds: 9, storylineModel: "m" };
    expect(resetDraftFields(draft, PROMPT_SETTING_KEYS)).toEqual({ ...DEFAULT_SETTINGS, reminderDurationSeconds: 9, storylineModel: "m" });
    expect(resetDraftFields(draft, GENERAL_SETTING_KEYS)).toEqual({ ...DEFAULT_SETTINGS, promptTemplate: "custom", storylineModel: "m" });
  });

  test("decides which chats show the reminder", () => {
    const greetings = [0, 1].map((greetingIndex) => ({ characterId: "a", characterName: "Ada", greetingIndex, text: "" }));
    const view = (chatEnabled: boolean, changes: Partial<WaypointsView["settings"]> = {}, reminderHidden = false) => ({
      chatId: "chat", chatEnabled, greetings, grantedPermissions: ["ui_panels"], reminderHidden,
      settings: { ...DEFAULT_SETTINGS, ...changes },
    });
    expect(shouldShowReminder(view(true))).toBe(true);
    expect(shouldShowReminder(view(false))).toBe(false);
    expect(shouldShowReminder(view(false, { reminderShowOn: "disabled" }))).toBe(true);
    expect(shouldShowReminder(view(true, { reminderShowOn: "disabled" }))).toBe(false);
    expect(shouldShowReminder(view(false, { reminderShowOn: "all" }))).toBe(true);
    expect(shouldShowReminder(view(true, { reminderToast: false }))).toBe(false);
    expect(shouldShowReminder(view(true, {}, true))).toBe(false);
    // Hidden chats come back as soon as the option is off.
    expect(shouldShowReminder(view(true, { reminderNeverAgain: false }, true))).toBe(true);
    expect(shouldShowReminder({ ...view(true), greetings: greetings.slice(0, 1) })).toBe(false);
    expect(shouldShowReminder({ ...view(true), grantedPermissions: [] })).toBe(false);
  });

  test("times the reminder's delay, duration, and fade", () => {
    const timeline = reminderTimeline(DEFAULT_SETTINGS, 0);
    expect(timeline).toEqual({ showAt: 1_000, hideAt: 6_000, goneAt: 11_000 });
    expect(reminderPhase(timeline, 500)).toEqual({ phase: "waiting" });
    expect(reminderPhase(timeline, 3_500)).toEqual({ phase: "showing", remaining: 0.5 });
    expect(reminderPhase(timeline, 8_500)).toEqual({ phase: "fading", opacity: 0.5 });
    expect(reminderPhase(timeline, 11_000)).toEqual({ phase: "gone" });
    const plain = { ...DEFAULT_SETTINGS, reminderDelay: false, reminderFadeOut: false, reminderDurationSeconds: 2.5 };
    expect(reminderTimeline(plain, 100)).toEqual({ showAt: 100, hideAt: 2_600, goneAt: 2_600 });
    // A restart after a click skips the delay.
    expect(reminderTimeline(DEFAULT_SETTINGS, 0, false).showAt).toBe(0);
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
