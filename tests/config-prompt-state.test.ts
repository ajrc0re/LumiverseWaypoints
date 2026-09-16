import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  SettingsValidationError,
  compileExcludeRegex,
  validateSettings,
} from "../src/config";
import {
  applyPromptExcludeRegex,
  insertAtDepth,
  renderPrompt,
  stripHandoffTags,
} from "../src/prompt";
import {
  buildGreetingContext,
  defaultSelections,
  emptyChatState,
  nextGreetingForSelection,
  reconcileChatState,
} from "../src/state";

describe("configuration and prompt rendering", () => {
  test("validates the required prompt placeholders and tag names", () => {
    expect(validateSettings(DEFAULT_SETTINGS).settings.handoffTagName).toBe("inject-prewritten-content");
    expect(() => validateSettings({
      ...DEFAULT_SETTINGS,
      promptTemplate: "Only {{handoff_tag}}",
    })).toThrow(SettingsValidationError);
    expect(() => validateSettings({
      ...DEFAULT_SETTINGS,
      handoffTagName: "not valid",
    })).toThrow(SettingsValidationError);
  });

  test("supports LumiScript x-style regex literals", () => {
    const expression = compileExcludeRegex("/ D E L E T E - M E # private marker\n /x");
    expect(expression?.test("DELETE-ME")).toBe(true);
    expect(applyPromptExcludeRegex("before DELETE-ME after", "/ D E L E T E - M E # private marker\n /x"))
      .toBe("before  after");
  });

  test("filters a scene before truncating and renders dynamic tags", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      promptTemplate: "{{scene_excerpt}} | {{handoff_tag}} | {{override_tag}}",
      prewrittenSceneCharLimit: 5,
      promptExcludeRegex: "/CUT/g",
      handoffTagName: "scene-hop",
      overrideTagName: "jump",
    };
    const rendered = renderPrompt(settings, "CUT123456789");
    expect(rendered.filteredScene).toBe("123456789");
    expect(rendered.sceneExcerpt).toBe("12345");
    expect(rendered.content).toBe("12345 | <scene-hop /> | --jump--");
  });

  test("parses and strips both dynamic self-closing and paired handoff tags", () => {
    const result = stripHandoffTags(
      "Before <scene-hop /> after <scene-hop>hidden scene</scene-hop> end",
      "scene-hop",
    );
    expect(result.hasHandoff).toBe(true);
    expect(result.tagCount).toBe(2);
    expect(result.content).toBe("Before after end");
  });

  test("places an interceptor insertion at the configured depth", () => {
    expect(insertAtDepth(["old", "new"], "waypoint", 0)).toEqual(["old", "new", "waypoint"]);
    expect(insertAtDepth(["old", "new"], "waypoint", 1)).toEqual(["old", "waypoint", "new"]);
    expect(insertAtDepth(["old", "new"], "waypoint", 99)).toEqual(["waypoint", "old", "new"]);
  });
});

describe("greeting and group state", () => {
  const characters = [
    {
      id: "a",
      name: "Ada",
      first_mes: "Ada greeting one",
      alternate_greetings: ["Ada greeting two", "Ada greeting three"],
      extensions: {},
    },
    {
      id: "b",
      name: "Bryn",
      first_mes: "Bryn greeting one",
      alternate_greetings: ["Bryn greeting two"],
      extensions: {},
    },
  ];

  test("defaults a solo chat to the first and next greeting", () => {
    const context = buildGreetingContext({ id: "solo", character_id: "a", metadata: {} }, characters);
    const defaults = defaultSelections(context);
    expect(defaults.active).toEqual({ characterId: "a", greetingIndex: 0 });
    expect(defaults.upcoming).toEqual({ characterId: "a", greetingIndex: 1 });
    expect(nextGreetingForSelection(context.greetings, defaults.upcoming)).toEqual({
      characterId: "a",
      greetingIndex: 2,
    });
  });

  test("keeps group pickers broad and per-member overrides chat-local", () => {
    const context = buildGreetingContext({
      id: "group",
      character_id: "a",
      metadata: { character_ids: ["a", "b"] },
    }, characters);
    expect(context.isGroupChat).toBe(true);
    expect(context.greetings.map((greeting) => greeting.characterId)).toEqual(["a", "a", "a", "b", "b"]);

    const state = emptyChatState();
    state.groupEnabledByCharacter.b = false;
    const reconciled = reconcileChatState(state, context);
    expect(reconciled.groupEnabledByCharacter).toEqual({ b: false });
    expect(reconciled.active).toEqual({ characterId: "a", greetingIndex: 0 });
    expect(reconciled.upcoming).toEqual({ characterId: "a", greetingIndex: 1 });
  });
});
