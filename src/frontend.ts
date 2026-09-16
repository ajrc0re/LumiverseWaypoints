import type {
  SpindleFloatWidgetHandle,
  SpindleFrontendContext,
} from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS } from "./config";
import { canShowHud, cloneSettingsDraft, draftValidation, shouldRefreshDrawer } from "./frontend-model";
import { handoffTag, overrideTag } from "./prompt";
import { waypointStyles } from "./styles";
import type { Greeting, GreetingSelection, WaypointSettings, WaypointsView } from "./types";

type ComponentHandle = { destroy(): void };

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asView(value: unknown): WaypointsView | null {
  if (!isRecord(value) || !isRecord(value.settings) || !Array.isArray(value.greetings)) return null;
  return value as unknown as WaypointsView;
}

function selectionValue(greeting: Greeting | null): string {
  return greeting
    ? JSON.stringify({ characterId: greeting.characterId, greetingIndex: greeting.greetingIndex })
    : "";
}

function parseSelection(value: string): GreetingSelection | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.characterId !== "string" || !Number.isInteger(parsed.greetingIndex)) return null;
    return { characterId: parsed.characterId, greetingIndex: Number(parsed.greetingIndex) };
  } catch {
    return null;
  }
}

function greetingLabel(greeting: Greeting): string {
  const firstLine = greeting.text.replace(/\s+/g, " ").slice(0, 86);
  return greeting.characterName + " — greeting " + String(greeting.greetingIndex + 1) + (firstLine ? ": " + firstLine : "");
}

function compactPreview(value: string, limit = 580): string {
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}

export function setup(ctx: SpindleFrontendContext): () => void {
  const tab = ctx.ui.registerDrawerTab({
    id: "waypoints",
    title: "Waypoints",
    shortName: "Waypoints",
    headerTitle: "Waypoints",
    description: "Guide a chat through character greetings as story waypoints",
    keywords: ["greetings", "handoff", "scene", "prompt", "waypoints"],
    iconSvg: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><path d=\"M5 19V5m0 0 11 3-3 5 6 2-3 5-11-3\"/><circle cx=\"5\" cy=\"5\" r=\"1.5\"/></svg>",
  });
  tab.root.classList.add("wp-mount");
  const root = element("div", "wp-root");
  tab.root.append(root);
  const removeStyle = ctx.dom.addStyle(waypointStyles);

  let page: "waypoints" | "settings" = "waypoints";
  let view: WaypointsView | null = null;
  let draft = cloneSettingsDraft(DEFAULT_SETTINGS);
  let draftInitialized = false;
  let destroyed = false;
  let busy = false;
  let notice = "";
  let noticeError = false;
  let sequence = 0;
  let hud: SpindleFloatWidgetHandle | undefined;
  const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let componentHandles: ComponentHandle[] = [];
  const disposers: Array<() => void> = [];

  function clearComponents(): void {
    for (const handle of componentHandles) handle.destroy();
    componentHandles = [];
  }

  function rpc<T = unknown>(action: string, input: unknown = {}): Promise<T> {
    if (destroyed) return Promise.reject(new Error("Waypoints is closed."));
    const requestId = "wp-" + String(++sequence) + "-" + Date.now().toString(36);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Waypoints did not respond in time."));
      }, 30_000);
      pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timer });
      ctx.sendToBackend({ type: "waypoints:request", requestId, action, input });
    });
  }

  function setNotice(message: string, error = false): void {
    notice = message;
    noticeError = error;
  }

  function currentChatId(): string | undefined {
    return view?.chatId ?? ctx.getActiveChat().chatId ?? undefined;
  }

  function updateDraftValidation(target: HTMLElement): void {
    const result = draftValidation(draft);
    target.className = "wp-validation " + (result.valid ? "good" : "bad");
    target.textContent = result.valid
      ? (result.messages.length ? result.messages.join(" ") : "Draft is ready to save.")
      : result.messages.join(" ");
  }

  function addField(
    parent: HTMLElement,
    label: string,
    help: string,
    mount: (target: HTMLElement) => ComponentHandle,
  ): void {
    const wrap = element("div", "wp-field");
    wrap.append(element("label", "wp-label", label));
    if (help) wrap.append(element("p", "wp-help", help));
    const target = element("div", "wp-native");
    wrap.append(target);
    parent.append(wrap);
    componentHandles.push(mount(target));
  }

  async function load(): Promise<void> {
    const loaded = asView(await rpc("refresh", { chatId: currentChatId() }));
    if (!loaded) throw new Error("Waypoints returned an invalid status.");
    view = loaded;
    if (!draftInitialized) {
      draft = cloneSettingsDraft(loaded.settings);
      draftInitialized = true;
    }
    render();
    syncHud();
  }

  async function safely(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    render();
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error), true);
    } finally {
      busy = false;
      render();
      syncHud();
    }
  }

  function button(
    label: string,
    action: () => Promise<void> | void,
    className = "",
    disabled = false,
  ): HTMLButtonElement {
    const node = element("button", "wp-button" + (className ? " " + className : ""), label);
    node.type = "button";
    node.disabled = disabled || busy;
    node.onclick = () => { void action(); };
    return node;
  }

  function renderNotice(parent: HTMLElement): void {
    if (!notice) return;
    parent.append(element("div", "wp-notice" + (noticeError ? " error" : ""), notice));
  }

  function renderTabs(parent: HTMLElement): void {
    const tabs = element("div", "wp-tabs");
    tabs.setAttribute("role", "tablist");
    for (const descriptor of [
      ["waypoints", "Waypoints"],
      ["settings", "Settings"],
    ] as const) {
      const targetPage = descriptor[0];
      const node = element("button", "wp-tab", descriptor[1]);
      node.type = "button";
      node.setAttribute("role", "tab");
      node.setAttribute("aria-selected", String(page === targetPage));
      node.onclick = () => {
        page = targetPage;
        render();
      };
      tabs.append(node);
    }
    parent.append(tabs);
  }

  function renderPicker(
    parent: HTMLElement,
    label: string,
    selectedGreeting: Greeting | null,
    allowClear: boolean,
    changed: (selection: GreetingSelection | null) => Promise<void>,
  ): void {
    const currentView = view;
    if (!currentView) return;
    addField(parent, label, currentView.isGroupChat ? "All group members' greetings are available here." : "", (target) =>
      ctx.components.mountSelect(target, {
        value: selectionValue(selectedGreeting),
        clearable: allowClear,
        clearLabel: "No upcoming greeting",
        placeholder: "Choose a greeting",
        options: currentView.greetings.map((greeting) => ({
          value: selectionValue(greeting),
          label: greetingLabel(greeting),
          group: greeting.characterName,
        })),
        onChange: (value) => {
          const selection = parseSelection(value);
          if (!selection && !allowClear) return;
          void safely(async () => {
            const chatId = currentChatId();
            if (!chatId) throw new Error("Open a chat first.");
            await changed(selection);
            await load();
          });
        },
      }),
    );
  }

  function renderDashboard(parent: HTMLElement): void {
    if (!view) {
      parent.append(element("div", "wp-card", "Loading Waypoints…"));
      return;
    }
    if (view.missingPermissions.length) {
      parent.append(element(
        "div",
        "wp-alert",
        "Automatic handoffs are unavailable until these permissions are granted: " + view.missingPermissions.join(", ") + ".",
      ));
    }
    const status = element("section", "wp-card");
    const heading = element("div", "wp-row between");
    const headingText = element("div");
    headingText.append(element("div", "wp-kicker", view.isGroupChat ? "Group chat" : "Character chat"));
    headingText.append(element("h3", "", "Status"));
    heading.append(headingText);
    heading.append(button("Refresh", () => safely(load)));
    status.append(heading, element("p", "wp-muted", view.status));
    parent.append(status);

    const selections = element("section", "wp-section");
    selections.append(element("h3", "", "Greeting path"));
    const grid = element("div", "wp-grid");
    selections.append(grid);
    renderPicker(grid, "Active greeting", view.active, false, async (selection) => {
      await rpc("set-active", { chatId: currentChatId(), selection });
    });
    renderPicker(grid, "Upcoming greeting", view.upcoming, true, async (selection) => {
      await rpc("set-upcoming", { chatId: currentChatId(), selection });
    });
    const previews = element("div", "wp-grid");
    const activePreview = element("div", "wp-field");
    activePreview.append(element("label", "wp-label", "Active preview"));
    activePreview.append(element("pre", "wp-preview", view.active ? compactPreview(view.active.text) : "No active greeting."));
    const upcomingPreview = element("div", "wp-field");
    upcomingPreview.append(element("label", "wp-label", "Upcoming preview"));
    upcomingPreview.append(element("pre", "wp-preview", view.upcoming ? compactPreview(view.upcoming.text) : "No upcoming greeting."));
    previews.append(activePreview, upcomingPreview);
    selections.append(previews);
    const actions = element("div", "wp-actions");
    actions.append(
      button("Force", () => safely(async () => {
        const result = await rpc("force", { chatId: currentChatId() });
        const transition = isRecord(result) ? safeTransitionText(result.transition) : "";
        if (transition) setNotice(transition);
        await load();
      }), "primary", !view.upcoming),
      button("Undo", () => safely(async () => {
        const result = await rpc("undo", { chatId: currentChatId() });
        const transition = isRecord(result) ? safeTransitionText(result.transition) : "";
        if (transition) setNotice(transition);
        await load();
      }), "", !view.canUndo),
    );
    selections.append(actions);
    parent.append(selections);

    const enabled = element("section", "wp-section");
    enabled.append(element("h3", "", view.isGroupChat ? "Group member switches" : "Character switch"));
    enabled.append(element("p", "wp-help", view.isGroupChat
      ? "Each group member has a per-chat override. New members default to ON."
      : "This character's Waypoints switch is stored on the character card."));
    for (const character of view.characters) {
      const row = element("div", "wp-character");
      const names = element("div");
      names.append(element("div", "wp-character-name", character.name || "Unnamed character"));
      names.append(element("div", "wp-help", character.enabled ? "ON" : "OFF"));
      const mount = element("div", "wp-native");
      row.append(names, mount);
      enabled.append(row);
      componentHandles.push(ctx.components.mountSwitch(mount, {
        checked: character.enabled,
        ariaLabel: "Enable Waypoints for " + character.name,
        onChange: (checked) => {
          void safely(async () => {
            await rpc("set-enabled", {
              chatId: currentChatId(),
              characterId: character.id,
              enabled: checked,
            });
            await load();
          });
        },
      }));
    }
    parent.append(enabled);

    const prompt = element("section", "wp-section");
    prompt.append(element("h3", "", "Rendered prompt status"));
    const promptText = view.prompt.ready
      ? (view.prompt.autoPrompt ? "Auto-prompt is ON." : "Auto-prompt is OFF; this is a preview only.")
      : (view.prompt.reason ?? "No prompt is available.");
    prompt.append(element(
      "p",
      "wp-muted",
      promptText + " Role: " + view.prompt.role + ". Depth: " + String(view.prompt.insertionDepth) + ".",
    ));
    if (view.prompt.content) {
      const details = element("details", "wp-diagnostics");
      details.append(element("summary", "", "Show rendered prompt"));
      details.append(element("pre", "wp-preview", view.prompt.content));
      prompt.append(details);
    }
    parent.append(prompt);

    const diagnostics = element("section", "wp-section");
    diagnostics.append(element("h3", "", "Diagnostics"));
    const diagActions = element("div", "wp-actions");
    diagActions.append(
      button("Copy diagnostics", () => safely(async () => {
        const text = view?.diagnostics.join("\n") ?? "";
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this Lumiverse window.");
        await navigator.clipboard.writeText(text);
        setNotice("Diagnostics copied.");
      })),
      button("Clear diagnostics", () => safely(async () => {
        const result = asView(await rpc("clear-diagnostics", { chatId: currentChatId() }));
        if (result) view = result;
        setNotice("Diagnostics cleared.");
      })),
    );
    diagnostics.append(diagActions);
    const details = element("details", "wp-diagnostics");
    details.append(element("summary", "", "Show " + String(view.diagnostics.length) + " recent lines"));
    details.append(element("pre", "wp-preview", view.diagnostics.join("\n") || "No diagnostic lines yet."));
    diagnostics.append(details);
    parent.append(diagnostics);

    if (view.settings.floatingControls && !canShowHud(true, view.grantedPermissions)) {
      parent.append(element("div", "wp-alert", "Floating controls are enabled in Settings, but ui_panels permission is not granted. The drawer still works."));
    }
  }

  function safeTransitionText(value: unknown): string {
    if (!isRecord(value) || typeof value.reason !== "string") return "";
    return value.reason;
  }

  function renderSettings(parent: HTMLElement): void {
    const settings = element("section", "wp-section");
    settings.append(element("h3", "", "Settings"));
    settings.append(element("p", "wp-help", "Edits stay in this draft until you select Save settings. Invalid drafts never change live behavior."));
    const validation = element("div", "wp-validation");
    updateDraftValidation(validation);
    settings.append(validation);

    settings.append(element("h4", "", "Prompt"));
    addField(settings, "Scene-shaping template", "Required placeholders: {{scene_excerpt}} and {{handoff_tag}}. {{override_tag}} is optional but recommended.", (target) =>
      ctx.components.mountTextArea(target, {
        value: draft.promptTemplate,
        rows: 16,
        ariaLabel: "Scene-shaping template",
        onChange: (value) => {
          draft.promptTemplate = value;
          updateDraftValidation(validation);
        },
      }),
    );
    const promptGrid = element("div", "wp-grid");
    settings.append(promptGrid);
    addField(promptGrid, "Prewritten-scene limit", "Characters retained after exclusion filtering.", (target) =>
      ctx.components.mountNumericInput(target, {
        value: draft.prewrittenSceneCharLimit,
        integer: true,
        min: 1,
        max: 100000,
        onChange: (value) => {
          if (value !== null) draft.prewrittenSceneCharLimit = value;
          updateDraftValidation(validation);
        },
      }),
    );
    addField(promptGrid, "Exclusion regex", "Accepts /pattern/flags. The LumiScript-style x flag removes spaces and # comments outside character classes.", (target) =>
      ctx.components.mountTextInput(target, {
        value: draft.promptExcludeRegex,
        placeholder: "/private block/gi",
        onChange: (value) => {
          draft.promptExcludeRegex = value;
          updateDraftValidation(validation);
        },
      }),
    );
    addField(promptGrid, "Prompt insertion depth", "0 is the newest edge of the assembled prompt.", (target) =>
      ctx.components.mountNumericInput(target, {
        value: draft.insertionDepth,
        integer: true,
        min: 0,
        max: 9999,
        onChange: (value) => {
          if (value !== null) draft.insertionDepth = value;
          updateDraftValidation(validation);
        },
      }),
    );
    addField(promptGrid, "Prompt role", "Use system unless your connection requires another role.", (target) =>
      ctx.components.mountSelect(target, {
        value: draft.promptRole,
        options: [
          { value: "system", label: "system" },
          { value: "user", label: "user" },
          { value: "assistant", label: "assistant" },
        ],
        onChange: (value) => {
          if (value === "system" || value === "user" || value === "assistant") draft.promptRole = value;
          updateDraftValidation(validation);
        },
      }),
    );
    const autoTarget = element("div", "wp-native");
    settings.append(autoTarget);
    componentHandles.push(ctx.components.mountCheckbox(autoTarget, {
      checked: draft.autoPrompt,
      label: "Automatically insert the rendered prompt before generation",
      hint: "Off by default. When off, Waypoints still shows the rendered prompt for review.",
      onChange: (checked) => {
        draft.autoPrompt = checked;
        updateDraftValidation(validation);
      },
    }));

    settings.append(element("div", "wp-divider"));
    settings.append(element("h4", "", "Handoff"));
    const handoffGrid = element("div", "wp-grid");
    settings.append(handoffGrid);
    let updateHandoffPreviews = () => {};
    addField(handoffGrid, "Handoff tag name", "Waypoints recognizes both self-closing and paired forms.", (target) =>
      ctx.components.mountTextInput(target, {
        value: draft.handoffTagName,
        onChange: (value) => {
          draft.handoffTagName = value;
          updateDraftValidation(validation);
          updateHandoffPreviews();
        },
      }),
    );
    addField(handoffGrid, "User override tag name", "A user can request the closest viable handoff with this marker.", (target) =>
      ctx.components.mountTextInput(target, {
        value: draft.overrideTagName,
        onChange: (value) => {
          draft.overrideTagName = value;
          updateDraftValidation(validation);
          updateHandoffPreviews();
        },
      }),
    );
    const previews = element("p", "wp-help");
    previews.append("Live previews: ");
    const handoffPreview = element("code", "wp-code", handoffTag(draft));
    const overridePreview = element("code", "wp-code", overrideTag(draft));
    previews.append(handoffPreview);
    previews.append(document.createTextNode(" and "));
    previews.append(overridePreview);
    settings.append(previews);
    updateHandoffPreviews = () => {
      handoffPreview.textContent = handoffTag(draft);
      overridePreview.textContent = overrideTag(draft);
    };

    settings.append(element("div", "wp-divider"));
    settings.append(element("h4", "", "Advanced"));
    const advancedGrid = element("div", "wp-grid");
    settings.append(advancedGrid);
    const numericFields: Array<[keyof WaypointSettings, string, string, number, number]> = [
      ["interceptorPriority", "Interceptor priority", "Lower priorities run first.", 0, 1000],
      ["contentProcessorPriority", "Content-processor priority", "Lower priorities run first.", 0, 1000],
      ["activeChatRetryAttempts", "Active-chat retries", "Attempts while a chat switch settles.", 1, 25],
      ["activeChatRetryDelayMs", "Active-chat retry delay (ms)", "Delay between active-chat retries.", 0, 2000],
      ["handoffReadRetryAttempts", "Handoff-read retries", "Attempts while a handoff message settles.", 1, 25],
      ["handoffReadRetryDelayMs", "Handoff-read retry delay (ms)", "Delay between handoff-read retries.", 0, 2000],
      ["pendingHandoffLimit", "Pending-handoff limit", "Recent handoff observations retained in chat state.", 1, 500],
      ["recentTransitionLimit", "Recent-transition limit", "Dedupe keys retained in chat state.", 1, 500],
      ["diagnosticLineLimit", "Diagnostic line limit", "Runtime diagnostic lines retained in the drawer.", 10, 500],
    ];
    for (const descriptor of numericFields) {
      const field = descriptor[0];
      addField(advancedGrid, descriptor[1], descriptor[2], (target) =>
        ctx.components.mountNumericInput(target, {
          value: draft[field] as number,
          integer: true,
          min: descriptor[3],
          max: descriptor[4],
          onChange: (value) => {
            if (value !== null) (draft[field] as number) = value;
            updateDraftValidation(validation);
          },
        }),
      );
    }
    const diagnosticsTarget = element("div", "wp-native");
    settings.append(diagnosticsTarget);
    componentHandles.push(ctx.components.mountCheckbox(diagnosticsTarget, {
      checked: draft.diagnosticLogging,
      label: "Keep diagnostic logging",
      hint: "When off, new runtime diagnostic lines are not added.",
      onChange: (checked) => {
        draft.diagnosticLogging = checked;
        updateDraftValidation(validation);
      },
    }));

    settings.append(element("div", "wp-divider"));
    settings.append(element("h4", "", "Interface"));
    const hudTarget = element("div", "wp-native");
    settings.append(hudTarget);
    componentHandles.push(ctx.components.mountCheckbox(hudTarget, {
      checked: draft.floatingControls,
      label: "Show floating ON / Undo / Force controls",
      hint: "Enabled by default. Lumiverse owns its drag position and reset behavior.",
      onChange: (checked) => {
        draft.floatingControls = checked;
        updateDraftValidation(validation);
      },
    }));

    const actions = element("div", "wp-actions");
    actions.append(
      button("Save settings", () => safely(async () => {
        const validationResult = draftValidation(draft);
        if (!validationResult.valid) throw new Error(validationResult.messages.join(" "));
        const result = safeRecord(await rpc("save-settings", { settings: draft }));
        const saved = isRecord(result.settings) ? result.settings as unknown as WaypointSettings : null;
        if (saved) {
          draft = cloneSettingsDraft(saved);
          draftInitialized = true;
          const warnings = Array.isArray(result.warnings) ? result.warnings.filter((item: unknown): item is string => typeof item === "string") : [];
          setNotice(warnings.length ? "Settings saved. " + warnings.join(" ") : "Settings saved.");
        }
        await load();
      }), "primary"),
      button("Discard draft", () => {
        if (view) draft = cloneSettingsDraft(view.settings);
        render();
      }),
      button("Reset defaults", () => safely(async () => {
        const result = safeRecord(await rpc("reset-settings"));
        const saved = isRecord(result.settings) ? result.settings as unknown as WaypointSettings : null;
        if (saved) {
          draft = cloneSettingsDraft(saved);
          draftInitialized = true;
        }
        setNotice("Settings reset to defaults.");
        await load();
      }), "danger"),
    );
    settings.append(actions);
    parent.append(settings);
  }

  function syncHud(): void {
    const visible = Boolean(view && canShowHud(view.settings.floatingControls, view.grantedPermissions));
    if (!visible) {
      hud?.destroy();
      hud = undefined;
      return;
    }
    if (!hud) {
      try {
        hud = ctx.ui.createFloatWidget({
          width: 245,
          height: 44,
          snapToEdge: true,
          tooltip: "Waypoints controls",
          chromeless: true,
        });
      } catch {
        return;
      }
    }
    renderHud();
  }

  function renderHud(): void {
    if (!hud || !view) return;
    const root = hud.root;
    root.replaceChildren();
    root.className = "wp-hud";
    root.append(element("span", "wp-hud-label", "Waypoints"));
    const selectedGreeting = view.upcoming ?? view.active;
    const character = selectedGreeting
      ? view.characters.find((entry) => entry.id === selectedGreeting.characterId)
      : undefined;
    const enabled = character?.enabled ?? false;
    root.append(button(enabled ? "ON" : "OFF", () => safely(async () => {
      if (!character) throw new Error("Choose an upcoming greeting first.");
      await rpc("set-enabled", {
        chatId: currentChatId(),
        characterId: character.id,
        enabled: !enabled,
      });
      await load();
    }), "", !character));
    root.append(button("Undo", () => safely(async () => {
      await rpc("undo", { chatId: currentChatId() });
      await load();
    }), "", !view.canUndo));
    root.append(button("Force", () => safely(async () => {
      await rpc("force", { chatId: currentChatId() });
      await load();
    }), "primary", !view.upcoming));
  }

  function render(): void {
    clearComponents();
    root.replaceChildren();
    const header = element("header", "wp-header");
    const intro = element("div");
    intro.append(element("h2", "", "Waypoints"));
    intro.append(element("p", "wp-muted", "Guide a chat through the next greeting without exposing its contents."));
    header.append(intro);
    header.append(button("Refresh", () => safely(load)));
    root.append(header);
    renderNotice(root);
    renderTabs(root);
    const pageRoot = element("div", "wp-page");
    pageRoot.setAttribute("role", "tabpanel");
    root.append(pageRoot);
    if (page === "waypoints") renderDashboard(pageRoot);
    else renderSettings(pageRoot);
  }

  disposers.push(ctx.onBackendMessage((payload) => {
    const message = safeRecord(payload);
    if (message.type === "waypoints:reply" && typeof message.requestId === "string") {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      clearTimeout(request.timer);
      if (typeof message.error === "string" && message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
      return;
    }
    if (message.type === "waypoints:permission-denied" || (typeof message.type === "string" && shouldRefreshDrawer(message.type))) {
      void safely(load);
    }
  }));
  disposers.push(tab.onActivate(() => { void safely(load); }));
  disposers.push(ctx.events.on("CHAT_SWITCHED", () => {
    if (shouldRefreshDrawer("CHAT_SWITCHED")) void safely(load);
  }));
  disposers.push(ctx.events.on("CHAT_CHANGED", () => {
    if (shouldRefreshDrawer("CHAT_CHANGED")) void safely(load);
  }));

  render();
  ctx.ready();
  void safely(load);

  return () => {
    destroyed = true;
    clearComponents();
    for (const dispose of disposers) dispose();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Waypoints closed."));
    }
    pending.clear();
    hud?.destroy();
    tab.destroy();
    removeStyle();
  };
}
