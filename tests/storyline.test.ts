import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, settingsFromStorage, validateSettings } from "../src/config";
import {
  moveStorylineStop,
  reconcileStorylineDraft,
  resetStorylineOrder,
  storylineDraftDirty,
  storylineDraftFromSaved,
  storylineDraftRoute,
  toggleStorylineStop,
} from "../src/frontend-model";
import { insertAtDepths } from "../src/prompt";
import { buildGreetingContext, chatRoutes, nextGreetingChoices, nextGreetingForSelection, parseChatState, reconcileChatState } from "../src/state";
import {
  describePosition,
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
  storylinePath,
  storylinePosition,
} from "../src/storyline";
import type { CharacterStoryline, Greeting, StorylineCharacterView } from "../src/types";

function greetings(texts: string[], characterId = "a"): Greeting[] {
  return texts.map((text, greetingIndex) => ({ characterId, characterName: "Ada", greetingIndex, text }));
}

function storyline(route: number[], cards: Greeting[], extra: Partial<CharacterStoryline> = {}): CharacterStoryline {
  return { ...emptyStoryline("a"), route: routeEntries(route, cards, "a"), ...extra };
}

describe("storyline routes", () => {
  const cards = greetings(["Tavern", "Road", "Castle", "Siege"]);

  test("resolves a saved route and follows greetings that moved on the card", () => {
    const saved = storyline([3, 1, 2], cards);
    expect(resolveRoute(saved, cards)).toEqual([3, 1, 2]);
    // "Tavern" was removed from the front of the card: every index shifts down.
    const shifted = greetings(["Road", "Castle", "Siege"]);
    expect(resolveRoute(saved, shifted)).toEqual([2, 0, 1]);
    // A stop edited in place keeps its position; a removed last greeting drops out.
    const edited = greetings(["Tavern", "Road (revised)", "Castle"]);
    expect(resolveRoute(saved, edited)).toEqual([1, 2]);
  });

  test("an empty route means every greeting in card order", () => {
    expect(resolveRoute(emptyStoryline("a"), cards)).toEqual([]);
    expect(effectiveRoute(emptyStoryline("a"), cards, "a")).toEqual([0, 1, 2, 3]);
    expect(effectiveRoute(undefined, cards, "a")).toEqual([0, 1, 2, 3]);
  });

  test("flags a generated overview as stale when the route or its text changes", () => {
    const route = [0, 2, 3];
    const saved = storyline(route, cards, { overview: "Journey", overviewSignature: routeSignature(route, cards, "a") });
    expect(isOverviewStale(saved, cards)).toBe(false);
    expect(isOverviewStale({ ...saved, route: routeEntries([0, 3], cards, "a") }, cards)).toBe(true);
    expect(isOverviewStale(saved, greetings(["Tavern", "Road", "Castle at night", "Siege"]))).toBe(true);
    // A hand-written overview has no signature to compare against.
    expect(isOverviewStale({ ...saved, overviewSignature: "" }, greetings(["x", "y"]))).toBe(false);
  });

  test("parses stored storylines defensively", () => {
    expect(parseStoryline(null, "a")).toBeNull();
    expect(parseStoryline({ version: 1, characterId: "b" }, "a")).toBeNull();
    const parsed = parseStoryline({
      version: 1, characterId: "a", route: [{ greetingIndex: 2, hash: "x" }, { greetingIndex: 2, hash: "y" }, { greetingIndex: -1 }],
      notes: 5, overview: "Overview", generatedAt: "soon",
    }, "a");
    expect(parsed).toMatchObject({ route: [{ greetingIndex: 2, hash: "x" }], notes: "", overview: "Overview", generatedAt: null });
    expect(storylinePath("../x")).toBe("storylines/..%2Fx.json");
  });

  test("next greetings follow the route in chats that enable it", () => {
    const routes = { a: [0, 3, 1] };
    expect(nextGreetingForSelection(cards, { characterId: "a", greetingIndex: 0 }, routes)).toEqual({ characterId: "a", greetingIndex: 3 });
    expect(nextGreetingForSelection(cards, { characterId: "a", greetingIndex: 3 }, routes)).toEqual({ characterId: "a", greetingIndex: 1 });
    expect(nextGreetingForSelection(cards, { characterId: "a", greetingIndex: 1 }, routes)).toBeNull();
    // Off the route, the next greeting is the start of the route.
    expect(nextGreetingForSelection(cards, { characterId: "a", greetingIndex: 2 }, routes)).toEqual({ characterId: "a", greetingIndex: 0 });
    expect(nextGreetingChoices(cards, cards[3], false, routes).map((greeting) => greeting.greetingIndex)).toEqual([1]);
    expect(nextGreetingChoices(cards, cards[0], false).map((greeting) => greeting.greetingIndex)).toEqual([1, 2, 3]);

    const chat = { id: "chat", character_id: "a" };
    const character = { id: "a", name: "Ada", first_mes: "Tavern", alternate_greetings: ["Road", "Castle", "Siege"] };
    const context = { ...buildGreetingContext(chat, [character]), storylines: { a: storyline([0, 2], cards) } };
    const state = parseChatState(null);
    expect(chatRoutes(context, state)).toEqual({ a: [0, 2] });
    expect(reconcileChatState(state, context).upcoming).toEqual({ characterId: "a", greetingIndex: 2 });
    const off = { ...state, storyRoute: false };
    expect(chatRoutes(context, off)).toEqual({});
    expect(reconcileChatState(off, context).upcoming).toEqual({ characterId: "a", greetingIndex: 1 });
  });
});

describe("storyline prompts", () => {
  test("describes story progress in prewritten scenes only", () => {
    expect(describePosition(storylinePosition([0, 2, 3, 5], 2, 3))).toBe(
      "Story progress: the story is currently in prewritten scene 2 of 4. "
      + "Prewritten scene 1 has already happened. "
      + "The next prewritten scene is 3 of 4; steer toward it gradually. "
      + "Prewritten scene 4 is an upcoming story beat after that.",
    );
    expect(describePosition(storylinePosition([0, 1, 2, 3, 4], 3, 4))).toContain("Prewritten scenes 1 to 3 have already happened.");
    expect(describePosition(storylinePosition([0, 1, 2, 3, 4], 0, 1))).toContain("Prewritten scenes 3 to 5 are upcoming story beats after that.");
    expect(describePosition(storylinePosition([0, 2, 3], 3, null))).toContain("This is the final prewritten scene.");
    expect(describePosition(storylinePosition([0, 2, 3], 1, 0))).toBe(
      "Story progress: the story is currently between planned prewritten scenes. "
      + "The next prewritten scene is 1 of 3; steer toward it gradually. "
      + "Prewritten scenes 2 and 3 are upcoming story beats after that.",
    );
    expect(describePosition(storylinePosition([0, 2], 2, 1))).toContain("Another prewritten scene comes next");
    expect(describePosition(storylinePosition([], 0, 1))).toBe("");
    // The roleplay model never sees greetings or card numbers.
    for (const [active, upcoming] of [[2, 3], [1, 0], [3, null], [2, 1]] as const) {
      expect(describePosition(storylinePosition([0, 2, 3], active, upcoming))).not.toMatch(/greeting|card/i);
    }
  });

  test("renders the overview template without re-expanding placeholders inside values", () => {
    const content = renderStorylinePrompt(DEFAULT_SETTINGS, "Uses {{storyline_position}} literally.", storylinePosition([0, 1], 0, 1), "Ada");
    expect(content).toContain("narrative journey for Ada");
    expect(content).toContain("Uses {{storyline_position}} literally.");
    expect(content).toContain("prewritten scene 1 of 2");
    expect(renderStorylinePrompt(DEFAULT_SETTINGS, "Overview", storylinePosition([0, 1, 2], 1, 2), "Ada")).not.toMatch(/greeting|waypoint/i);
  });

  test("builds generator instructions from the route, filtering and clipping each greeting", () => {
    const prompt = renderGeneratorPrompt({ ...DEFAULT_SETTINGS, storylineWaypointCharLimit: 100 }, {
      character: { name: "Ada", description: "A knight", scenario: "" },
      route: [greetings(["<div>Hidden</div>Tavern"])[0], { ...greetings(["", "x".repeat(300)])[1] }],
      notes: "Slow burn",
    });
    expect(prompt).toContain("### Prewritten scene 1 of 2\nHiddenTavern");
    expect(prompt).not.toContain("<div>");
    expect(prompt).toContain("### Prewritten scene 2 of 2\n");
    expect(prompt).not.toMatch(/greeting/i);
    expect(prompt).toContain("[…truncated]");
    expect(prompt).toContain("Author guidance: Slow burn");
    expect(prompt).toContain("Scenario: (none)");
  });

  test("reads generated text from response objects and strips reasoning blocks", () => {
    expect(generatedText({ content: "<think>plan</think>\n Overview \r\n" })).toBe("Overview");
    expect(generatedText("Plain")).toBe("Plain");
    expect(generatedText({ response: { content: "Nested" } })).toBe("Nested");
    expect(generatedText(undefined)).toBe("");
  });

  test("inserts several prompts at independent depths of the original messages", () => {
    expect(insertAtDepths(["a", "b", "c"], [{ value: "story", depth: 0 }, { value: "scene", depth: 0 }])).toEqual(["a", "b", "c", "story", "scene"]);
    expect(insertAtDepths(["a", "b", "c"], [{ value: "story", depth: 99 }, { value: "scene", depth: 1 }])).toEqual(["story", "a", "b", "scene", "c"]);
  });

  test("validates the storyline templates and repairs only bad stored fields", () => {
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, storylineTemplate: "no placeholder" })).toThrow("{{storyline_overview}}");
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, storylineGeneratorTemplate: "none" })).toThrow("{{waypoints}}");
    const repaired = settingsFromStorage({ ...DEFAULT_SETTINGS, promptTemplate: DEFAULT_SETTINGS.promptTemplate + "\nCustom", insertionDepth: -4 });
    expect(repaired.promptTemplate).toEndWith("Custom");
    expect(repaired.insertionDepth).toBe(DEFAULT_SETTINGS.insertionDepth);
    // Copies of an earlier built-in storyline template follow the current default.
    const legacy = DEFAULT_SETTINGS.storylineTemplate
      .replace("a sequence of prewritten scenes.", "a sequence of prewritten waypoint scenes.")
      .replace("Use the story progress below", "Use the journey position below")
      .replace("story beats planned for later prewritten scenes", "events planned for later waypoints");
    expect(legacy).not.toBe(DEFAULT_SETTINGS.storylineTemplate);
    expect(settingsFromStorage({ ...DEFAULT_SETTINGS, storylineTemplate: legacy }).storylineTemplate).toBe(DEFAULT_SETTINGS.storylineTemplate);
    expect(settingsFromStorage({ ...DEFAULT_SETTINGS, storylineTemplate: legacy + " edited" }).storylineTemplate).toEndWith(" edited");
  });
});

describe("storyline drafts", () => {
  const cards = greetings(["Tavern", "Road", "Castle", "Siege"]);
  const saved: StorylineCharacterView = {
    characterId: "a", route: [2, 0], effectiveRoute: [2, 0], notes: "", overview: "", generatedAt: null,
    stale: false, updatedAt: 1, generating: false,
  };

  test("edits route order and inclusion, normalizing card order to the default", () => {
    const draft = storylineDraftFromSaved(saved, cards);
    expect(draft.order).toEqual([2, 0, 1, 3]);
    expect(draft.excluded).toEqual([1, 3]);
    expect(storylineDraftDirty(draft, saved, cards)).toBe(false);
    const moved = moveStorylineStop(toggleStorylineStop(draft, 3, true), 3, -1);
    expect(storylineDraftRoute(moved, cards)).toEqual([2, 0, 3]);
    expect(storylineDraftDirty(moved, saved, cards)).toBe(true);
    expect(storylineDraftRoute(resetStorylineOrder(moved, cards), cards)).toEqual([]);
  });

  test("keeps local edits across refreshes but follows remote saves when untouched", () => {
    const untouched = storylineDraftFromSaved(saved, cards);
    const remote = { ...saved, route: [3, 2], notes: "remote" };
    expect(reconcileStorylineDraft(untouched, remote, cards).notes).toBe("remote");
    const edited = { ...untouched, notes: "mine" };
    const kept = reconcileStorylineDraft(edited, remote, [...cards, ...greetings(["", "", "", "", "Epilogue"]).slice(4)]);
    expect(kept.notes).toBe("mine");
    expect(kept.order).toEqual([2, 0, 1, 3, 4]);
    expect(kept.excluded).toEqual([1, 3, 4]);
  });
});
