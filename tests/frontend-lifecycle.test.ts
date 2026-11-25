import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS } from "../src/config";
import { setup } from "../src/frontend";
import type { WaypointsView } from "../src/types";

type Selection = ReturnType<SpindleFrontendContext["getActiveChat"]>;
type Request = { requestId: string; action: string; input: Record<string, unknown> };

function status(chatId: string | null): WaypointsView {
  const characterId = chatId?.replace("chat-", "") ?? "";
  const name = characterId === "a" ? "Ada" : "Bryn";
  const greetings = chatId ? [0, 1, 2].map((greetingIndex) => ({
    characterId, characterName: name, greetingIndex, text: name + " greeting " + greetingIndex,
  })) : [];
  return {
    chatId, chatEnabled: true, isGroupChat: false, grantedPermissions: ["ui_panels"], missingPermissions: [],
    characters: chatId ? [{ id: characterId, name, enabled: true, cardData: false }] : [],
    greetings, active: greetings[0] ?? null, upcoming: greetings[1] ?? null, canUndo: Boolean(chatId),
    status: chatId ? "Ready: " + name : "Open a character or group chat to use Waypoints.",
    settings: structuredClone(DEFAULT_SETTINGS),
    prompt: { ready: Boolean(chatId), autoPrompt: false, role: "system", insertionDepth: 0, content: chatId ? name + " prompt" : "" },
    routes: {},
    storyline: {
      routeEnabled: true,
      overviewEnabled: true,
      characters: chatId ? [{
        characterId, route: [], effectiveRoute: [0, 1, 2], notes: "", includePersona: true, includeCharacter: true, overview: "", generatedAt: null,
        stale: false, updatedAt: null, generating: false,
      }] : [],
      prompt: { ready: false, content: "", characterId: chatId ? characterId : null, position: null, reason: "No narrative overview has been saved for this character." },
    },
    reminderHidden: false,
    diagnostics: [],
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const originalDocument = globalThis.document;
let host: FrontendHost | undefined;

afterEach(() => {
  host?.destroy();
  host?.dom.window.close();
  host = undefined;
  globalThis.document = originalDocument;
});

class FrontendHost {
  readonly dom = new JSDOM("<!doctype html><body></body>");
  readonly drawer = this.dom.window.document.createElement("div");
  readonly actionBar = this.dom.window.document.createElement("div");
  readonly extras = new Map<string, HTMLButtonElement>();
  readonly events = new Map<string, (payload?: unknown) => void>();
  readonly requests: Request[] = [];
  readonly answered = new Set<string>();
  selection: Selection = { chatId: "chat-a", characterId: "a" };
  stateListener?: () => void;
  backendListener?: (payload: unknown) => void;
  activate?: () => void;
  readonly comboboxes: Array<{ input: HTMLInputElement; options: Record<string, unknown> }> = [];
  menuChoice?: (result: { selectedKey: string | null }) => void;
  modal?: HTMLElement;
  hud?: HTMLElement;
  reminder?: HTMLElement;
  reminderHandle?: { moveTo(x: number, y: number): void; getPosition(): { x: number; y: number } };
  reminderGeometryKey?: string;
  readonly savedFloatPositions = new Map<string, { x: number; y: number }>();
  selectionReads = 0;
  teardown?: () => void;

  constructor(stateSubscription = true) {
    globalThis.document = this.dom.window.document;
    document.body.append(this.drawer, this.actionBar);
    const ctx = {
      getActiveChat: () => { this.selectionReads += 1; return { ...this.selection }; },
      sendToBackend: (request: Request) => this.requests.push(request),
      onBackendMessage: (handler: (payload: unknown) => void) => {
        this.backendListener = handler;
        return () => { this.backendListener = undefined; };
      },
      ready() {},
      dom: { addStyle: () => () => {} },
      events: { on: (event: string, handler: (payload?: unknown) => void) => {
        this.events.set(event, handler);
        return () => { this.events.delete(event); };
      } },
      state: stateSubscription ? { subscribe: (selector: string, handler: () => void) => {
        expect(selector).toBe("chat.active");
        this.stateListener = handler;
        return () => { this.stateListener = undefined; };
      } } : undefined,
      ui: {
        registerDrawerTab: () => ({
          root: this.drawer,
          destroy: () => this.drawer.remove(),
          activate: () => this.activate?.(),
          onActivate: (handler: () => void) => {
            this.activate = handler;
            return () => { this.activate = undefined; };
          },
        }),
        mount: () => this.actionBar,
        registerInputBarAction: (options: { id: string; label: string }) => {
          const button = document.createElement("button");
          button.textContent = options.label;
          this.extras.set(options.id, button);
          document.body.append(button);
          return {
            setEnabled: (enabled: boolean) => { button.disabled = !enabled; },
            setLabel: (label: string) => { button.textContent = label; },
            setSubtitle: (subtitle: string) => { button.title = subtitle; },
            onClick: (handler: () => void) => {
              button.onclick = handler;
              return () => { button.onclick = null; };
            },
            destroy: () => button.remove(),
          };
        },
        createFloatWidget: (options?: { tooltip?: string; persistGeometry?: string; initialPosition?: { x: number; y: number } }) => {
          const root = document.createElement("div");
          document.body.append(root);
          const key = options?.persistGeometry;
          let position = key && this.savedFloatPositions.get(key) || options?.initialPosition || { x: 0, y: 0 };
          const handle = {
            root,
            moveTo: (x: number, y: number) => {
              position = { x, y };
              if (key) this.savedFloatPositions.set(key, position);
            },
            getPosition: () => ({ ...position }),
            destroy: () => {
            root.remove();
            if (this.hud === root) this.hud = undefined;
            if (this.reminder === root) {
              this.reminder = undefined;
              this.reminderHandle = undefined;
            }
          },
          };
          if (options?.tooltip === "Waypoints chat reminder") {
            this.reminder = root;
            this.reminderHandle = handle;
            this.reminderGeometryKey = key;
          } else this.hud = root;
          return handle;
        },
        showModal: () => {
          const root = document.createElement("div");
          document.body.append(root);
          this.modal = root;
          let onDismiss: (() => void) | undefined;
          return {
            root,
            onDismiss: (handler: () => void) => { onDismiss = handler; return () => { onDismiss = undefined; }; },
            dismiss: () => { root.remove(); if (this.modal === root) this.modal = undefined; onDismiss?.(); },
          };
        },
        showContextMenu: () => new Promise<{ selectedKey: string | null }>((resolve) => { this.menuChoice = resolve; }),
      },
      components: {
        mountSelect: (target: HTMLElement, options: {
          value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void;
        }) => {
          const select = document.createElement("select");
          for (const option of options.options) {
            const node = document.createElement("option");
            node.value = option.value;
            node.textContent = option.label;
            select.append(node);
          }
          select.value = options.value;
          select.onchange = () => options.onChange(select.value);
          target.append(select);
          return { destroy: () => select.remove() };
        },
        mountTextInput: (target: HTMLElement, options: { value?: string; placeholder?: string; ariaLabel?: string; onChange?: (value: string) => void }) => {
          const input = document.createElement("input");
          input.value = options.value ?? "";
          input.placeholder = options.placeholder ?? "";
          if (options.ariaLabel) input.setAttribute("aria-label", options.ariaLabel);
          input.oninput = () => options.onChange?.(input.value);
          target.append(input);
          return { destroy: () => input.remove() };
        },
        mountNumericInput: (target: HTMLElement, options: { value?: number | null; onChange?: (value: number | null) => void }) => {
          const input = document.createElement("input");
          input.type = "number";
          input.value = options.value === null || options.value === undefined ? "" : String(options.value);
          input.oninput = () => options.onChange?.(input.value === "" ? null : Number(input.value));
          target.append(input);
          return { destroy: () => input.remove() };
        },
        mountModelCombobox: (target: HTMLElement, options: Record<string, unknown> & { value?: string; placeholder?: string; onChange?: (value: string) => void }) => {
          const input = document.createElement("input");
          input.value = options.value ?? "";
          input.placeholder = options.placeholder ?? "";
          input.setAttribute("data-model-combobox", "");
          input.oninput = () => options.onChange?.(input.value);
          target.append(input);
          const entry = { input, options: { ...options } };
          this.comboboxes.push(entry);
          return {
            update: (patch: Record<string, unknown>) => { Object.assign(entry.options, patch); },
            destroy: () => input.remove(),
          };
        },
        mountTextArea: (target: HTMLElement, options: { value?: string; disabled?: boolean; ariaLabel?: string; onChange?: (value: string) => void }) => {
          const area = document.createElement("textarea");
          area.value = options.value ?? "";
          area.disabled = Boolean(options.disabled);
          if (options.ariaLabel) area.setAttribute("aria-label", options.ariaLabel);
          area.oninput = () => options.onChange?.(area.value);
          target.append(area);
          return { destroy: () => area.remove() };
        },
        mountCheckbox: (target: HTMLElement, options: { checked?: boolean; label?: string; onChange?: (checked: boolean) => void }) => {
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = Boolean(options.checked);
          if (options.label) input.setAttribute("aria-label", options.label);
          input.onchange = () => options.onChange?.(input.checked);
          target.append(input);
          return { destroy: () => input.remove() };
        },
        mountSwitch: (target: HTMLElement, options: { checked: boolean; ariaLabel?: string; onChange: (checked: boolean) => void }) => {
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = options.checked;
          if (options.ariaLabel) input.setAttribute("aria-label", options.ariaLabel);
          input.onchange = () => options.onChange(input.checked);
          target.append(input);
          return { destroy: () => input.remove() };
        },
      },
    } as unknown as SpindleFrontendContext;
    this.teardown = setup(ctx);
  }

  destroy(): void { this.teardown?.(); this.teardown = undefined; }

  switchTo(chatId: string | null, characterId: string | null, notifyState = true): void {
    this.selection = { chatId, characterId };
    if (notifyState) this.stateListener?.();
  }

  request(action: string): Request {
    const request = [...this.requests].reverse().find((request) => request.action === action);
    if (!request) throw new Error("No request for " + action);
    return request;
  }

  reply(request: Request, result: unknown = status(request.input.chatId as string | null), error?: string): void {
    this.answered.add(request.requestId);
    this.backendListener?.({ type: "waypoints:reply", requestId: request.requestId, result, error });
  }

  async finishRefreshes(): Promise<void> {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      await flush();
      const requests = this.requests.filter((request) => request.action === "refresh" && !this.answered.has(request.requestId));
      if (!requests.length) return;
      for (const request of requests) this.reply(request);
    }
    throw new Error("Refreshes did not settle.");
  }

  /** Triggers a drawer refresh and answers it with the given view. */
  refreshNow(view: WaypointsView): void {
    this.activate?.();
    this.reply(this.request("refresh"), view);
  }

  button(label: string, root: HTMLElement = this.drawer): HTMLButtonElement {
    const button = [...root.querySelectorAll("button")].find((node) => node.textContent === label);
    if (!button) throw new Error("Missing button: " + label);
    return button;
  }
}

describe("frontend character switching", () => {
  test("Undo refreshes both greeting pickers to the restored selections", async () => {
    host = new FrontendHost();
    const progressed = status("chat-a");
    progressed.active = progressed.greetings[1];
    progressed.upcoming = progressed.greetings[2];
    host.reply(host.request("refresh"), progressed);
    await flush();
    const pickerValues = () => [...host!.drawer.querySelectorAll("select")].map((node) => JSON.parse(node.value).greetingIndex);
    expect(pickerValues()).toEqual([1, 2]);
    host.button("Undo").click();
    host.reply(host.request("undo"), { transition: { advanced: true, reason: "Restored the previous greetings." }, view: status("chat-a") });
    await host.finishRefreshes();
    expect(pickerValues()).toEqual([0, 1]);
    expect(host.button("Force").disabled).toBe(false);
  });

  test("switches the drawer and routes drawer, HUD, Extras, and compass actions to the new chat", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    expect(host.drawer.textContent).toContain("Ada");
    host.switchTo("chat-b", "b", false);
    host.events.get("CHAT_SWITCHED")?.();
    expect(host.request("refresh").input.chatId).toBe("chat-b");
    await host.finishRefreshes();
    expect(host.drawer.textContent).toContain("Bryn");
    expect(host.drawer.textContent).not.toContain("Ada");

    for (const [action, click] of [
      ["set-chat-enabled", () => host!.button("ON", host!.hud!).click()],
      ["force", () => host!.button("Force").click()],
      ["undo", () => host!.extras.get("undo-waypoints")!.click()],
    ] as const) {
      click();
      const request = host.request(action);
      expect(request.input.chatId).toBe("chat-b");
      if (action === "set-chat-enabled") expect(request.input.enabled).toBe(false);
      host.reply(request);
      await host.finishRefreshes();
      expect(host.button("Force").disabled).toBe(false);
    }

    host.actionBar.querySelector("button")!.click();
    host.menuChoice?.({ selectedKey: "force" });
    await flush();
    expect(host.request("force").input.chatId).toBe("chat-b");
    host.reply(host.request("force"));
    await host.finishRefreshes();
  });

  /** Runs a test against a controllable clock; the reminder ticks every 50 ms of real time. */
  async function withClock(run: (advance: (ms: number) => Promise<void>) => Promise<void>): Promise<void> {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
      await run(async (ms) => {
        now += ms;
        await Bun.sleep(70);
      });
    } finally {
      Date.now = originalNow;
    }
  }

  async function openChat(chatId: string, change: (view: WaypointsView) => void = () => {}): Promise<void> {
    host!.switchTo(chatId, chatId.replace("chat-", ""));
    const next = status(chatId);
    change(next);
    host!.reply(host!.request("refresh"), next);
    await flush();
  }

  const card = () => host!.reminder!.querySelector<HTMLElement>(".wp-reminder-card")!;

  test("waits for the delay, announces an enabled chat, then fades out and closes", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    await withClock(async (advance) => {
      await openChat("chat-b");
      await flush();
      // One-second delay by default.
      expect(host!.reminder).toBeUndefined();
      await advance(1_000);
      expect(host!.reminder?.textContent).toContain("Waypoints is ENABLED for this chat!");
      expect(host!.reminder?.textContent).toContain("click here to DISABLE");
      expect(host!.reminder?.textContent).toContain("Never remind me for this chat");
      expect(card().classList.contains("on")).toBe(true);
      const progress = host!.reminder!.querySelector<HTMLElement>(".wp-reminder-progress")!;
      await advance(2_500);
      expect(progress.style.transform).toBe("scaleX(0.5)");
      // Five seconds on screen, then a five-second fade.
      await advance(5_000);
      expect(host!.reminder?.style.opacity).toBe("0.5");
      await advance(2_500);
      expect(host!.reminder).toBeUndefined();
    });
    expect(host.requests.some((request) => request.action === "set-chat-enabled" || request.action === "set-reminder-hidden")).toBe(false);
  });

  test("clicking the reminder flips the chat and rewords it", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    await withClock(async (advance) => {
      await openChat("chat-b");
      await advance(1_000);
      await advance(4_000);
      card().click();
      expect(host!.request("set-chat-enabled").input).toEqual({ chatId: "chat-b", enabled: false });
      const off = status("chat-b");
      off.chatEnabled = false;
      host!.reply(host!.request("set-chat-enabled"), off);
      await flush();
      for (const request of host!.requests.filter((request) => request.action === "refresh" && !host!.answered.has(request.requestId))) host!.reply(request, off);
      await flush();
      expect(host!.reminder?.textContent).toContain("Waypoints is DISABLED for this chat!");
      expect(host!.reminder?.textContent).toContain("click here to ENABLE");
      expect(card().classList.contains("off")).toBe(true);
      // The new state gets a full duration on screen.
      await advance(4_000);
      expect(host!.reminder).toBeDefined();
      expect(host!.reminder?.style.opacity).toBe("");
    });
  });

  test("the Never remind me box hides a chat only when the reminder times out with it ticked", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    await withClock(async (advance) => {
      await openChat("chat-b");
      await advance(1_000);
      const box = host!.reminder!.querySelector<HTMLInputElement>(".wp-reminder-never input")!;
      box.click();
      expect(box.checked).toBe(true);
      // Ticking the box is not a click on the reminder.
      expect(host!.requests.some((request) => request.action === "set-chat-enabled")).toBe(false);
      // Switching chats before the timeout does not count.
      await openChat("chat-a");
      expect(host!.reminder).toBeUndefined();
      await flush();
      await advance(1_000);
      host!.reminder!.querySelector<HTMLInputElement>(".wp-reminder-never input")!.click();
      await advance(10_000);
      expect(host!.reminder).toBeUndefined();
      expect(host!.request("set-reminder-hidden").input).toEqual({ chatId: "chat-a", hidden: true });
      expect(host!.requests.filter((request) => request.action === "set-reminder-hidden")).toHaveLength(1);
      host!.reply(host!.request("set-reminder-hidden"), { hidden: true });

      await openChat("chat-b");
      await flush();
      await advance(1_000);
      expect(host!.reminder).toBeDefined();
      await openChat("chat-a", (view) => { view.reminderHidden = true; });
      await flush();
      await advance(1_000);
      expect(host!.reminder).toBeUndefined();
    });
  });

  test("shows on enabled, disabled, or all chats as configured", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    await withClock(async (advance) => {
      const visit = async (chatId: string, showOn: WaypointsView["settings"]["reminderShowOn"], enabled: boolean) => {
        await openChat(chatId, (view) => {
          view.chatEnabled = enabled;
          view.settings.reminderShowOn = showOn;
        });
        await flush();
        await advance(1_000);
        return host!.reminder?.textContent ?? null;
      };
      expect(await visit("chat-b", "enabled", false)).toBeNull();
      expect(await visit("chat-a", "disabled", true)).toBeNull();
      expect(await visit("chat-b", "disabled", false)).toContain("Waypoints is DISABLED for this chat!");
      expect(await visit("chat-a", "all", true)).toContain("ENABLED");
      expect(await visit("chat-b", "all", false)).toContain("DISABLED");
    });
  });

  test("without click, never-remind, delay, or fade options the reminder is plain and closes on time", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    await withClock(async (advance) => {
      await openChat("chat-b", (view) => {
        Object.assign(view.settings, { reminderClickToggle: false, reminderNeverAgain: false, reminderDelay: false, reminderFadeOut: false, reminderDurationSeconds: 2 });
      });
      await flush();
      expect(host!.reminder?.textContent).toBe("Waypoints is ENABLED for this chat!" + host!.reminder!.querySelector(".wp-reminder-hint")!.textContent);
      expect(host!.reminder!.querySelector<HTMLElement>(".wp-reminder-hint")!.hidden).toBe(true);
      expect(host!.reminder!.querySelector(".wp-reminder-never")).toBeNull();
      card().click();
      expect(host!.requests.some((request) => request.action === "set-chat-enabled")).toBe(false);
      await advance(1_900);
      expect(host!.reminder).toBeDefined();
      await advance(200);
      expect(host!.reminder).toBeUndefined();
    });
  });

  test("respects the reminder setting and cancels a pending reminder on chat switch", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    await withClock(async (advance) => {
      await openChat("chat-b", (view) => { view.settings.reminderToast = false; });
      await flush();
      await advance(1_000);
      expect(host!.reminder).toBeUndefined();
      // A switch during the delay cancels the old chat's reminder.
      await openChat("chat-a");
      await flush();
      await openChat("chat-b");
      await flush();
      await advance(1_000);
      const old = card();
      await openChat("chat-a");
      expect(host!.reminder).toBeUndefined();
      old.click();
      expect(host!.requests.some((request) => request.action === "set-chat-enabled")).toBe(false);
    });
  });

  test("does not remind in a chat with no alternate greetings", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    await withClock(async (advance) => {
      await openChat("chat-b", (view) => {
        view.greetings = view.greetings.slice(0, 1);
        view.chatEnabled = false;
        view.upcoming = null;
        view.settings.reminderShowOn = "all";
      });
      await flush();
      await advance(1_000);
      expect(host!.reminder).toBeUndefined();
    });
  });

  test("a store update for the same chat during the delay keeps its reminder", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    await withClock(async (advance) => {
      // A new chat starts OFF; the reminder is set to show on all chats.
      await openChat("chat-b", (view) => {
        view.chatEnabled = false;
        view.settings.reminderShowOn = "all";
      });
      // The store re-reports the same chat (its character hydrates) while the reminder waits.
      host!.switchTo("chat-b", "b2");
      const off = status("chat-b");
      off.chatEnabled = false;
      off.settings.reminderShowOn = "all";
      for (const request of host!.requests.filter((request) => request.action === "refresh" && !host!.answered.has(request.requestId))) host!.reply(request, off);
      await flush();
      await advance(1_000);
      expect(host!.reminder?.textContent).toContain("Waypoints is DISABLED for this chat!");
      expect(host!.reminder?.textContent).toContain("click here to ENABLE");
    });
  });

  test("restores the dragged reminder position on the next chat", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    await withClock(async (advance) => {
      await openChat("chat-b");
      await advance(1_000);
      expect(host!.reminderGeometryKey).toBe("chat-reminder-bar");
      host!.reminderHandle!.moveTo(192, 224);
      await openChat("chat-a");
      await advance(1_000);
      expect(host!.reminderHandle?.getPosition()).toEqual({ x: 192, y: 224 });
    });
  });

  test("tints the compass button by the chat's state when enabled", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    const compass = host.actionBar.querySelector("button")!;
    expect(compass.classList.contains("wp-status-on")).toBe(true);
    await openChat("chat-b", (view) => { view.chatEnabled = false; });
    await flush();
    expect(compass.classList.contains("wp-status-off")).toBe(true);
    expect(compass.classList.contains("wp-status-on")).toBe(false);
    await openChat("chat-a", (view) => { view.settings.actionBarStatusColor = false; });
    await flush();
    expect(compass.classList.contains("wp-status-on") || compass.classList.contains("wp-status-off")).toBe(false);
  });

  test("a switch during startup loads immediately and ignores a late reply from the previous chat", async () => {
    host = new FrontendHost();
    const initial = host.request("refresh");
    host.switchTo("chat-b", "b", false);
    host.events.get("CHAT_SWITCHED")?.();
    expect(host.request("refresh").input.chatId).toBe("chat-b");
    host.reply(host.request("refresh"));
    await flush();
    expect(host.drawer.textContent).toContain("Bryn");
    host.reply(initial, status("chat-a"));
    await flush();
    expect(host.drawer.textContent).not.toContain("Ada");
    expect(host.button("Force").disabled).toBe(false);
  });

  test("an old mutation cannot hold the new chat busy or release its in-flight action", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    host.button("Force").click();
    const oldForce = host.request("force");
    host.switchTo("chat-b", "b");
    await host.finishRefreshes();
    expect(host.button("Force").disabled).toBe(false);
    host.button("Force").click();
    const newForce = host.request("force");
    expect(newForce.input.chatId).toBe("chat-b");
    host.reply(oldForce, undefined, "Old chat failed");
    await flush();
    expect(host.button("Force").disabled).toBe(true);
    expect(host.drawer.textContent).not.toContain("Old chat failed");
    host.reply(newForce);
    await host.finishRefreshes();
    expect(host.button("Force").disabled).toBe(false);
  });

  test("queues lifecycle refreshes received during an in-flight read", async () => {
    host = new FrontendHost();
    const initial = host.request("refresh");
    host.events.get("CHAT_CHANGED")?.();
    host.backendListener?.({ type: "waypoints:changed" });
    expect(host.requests).toHaveLength(1);
    host.reply(initial);
    await flush();
    expect(host.requests).toHaveLength(2);
    const updated = status("chat-a");
    updated.status = "Latest greeting state";
    host.reply(host.request("refresh"), updated);
    await flush();
    expect(host.drawer.textContent).toContain("Latest greeting state");
    expect(host.button("Force").disabled).toBe(false);
  });

  test("follows delayed store hydration through an empty selection after the switch event", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    host.events.get("CHAT_SWITCHED")?.(); // Server event arrives before the frontend store changes.
    const oldRefresh = host.request("refresh");
    host.switchTo(null, null);
    expect(host.request("refresh").input.chatId).toBeNull();
    host.reply(host.request("refresh"));
    await flush();
    expect(host.drawer.textContent).toContain("Open a character or group chat");
    expect(host.button("Force").disabled).toBe(true);
    host.reply(oldRefresh);
    host.switchTo("chat-b", null);
    const unhydrated = host.request("refresh");
    host.switchTo("chat-b", "b");
    host.reply(unhydrated);
    host.reply(host.request("refresh"));
    await flush();
    expect(host.drawer.textContent).toContain("Bryn");
    expect(host.drawer.textContent).not.toContain("Ada");
    expect(host.button("Force").disabled).toBe(false);
  });

  test("closes old pickers, ignores old context menus, and keeps picker-confirmed controls responsive", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    host.extras.get("choose-next-waypoints")!.click();
    const oldModal = host.modal!;
    const staleConfirm = host.button("Use next greeting", oldModal);
    host.actionBar.querySelector("button")!.click();
    host.switchTo("chat-b", "b");
    expect(oldModal.isConnected).toBe(false);
    await host.finishRefreshes();
    const requestCount = host.requests.length;
    staleConfirm.click();
    host.menuChoice?.({ selectedKey: "force" });
    await flush();
    expect(host.requests).toHaveLength(requestCount);

    host.extras.get("choose-next-waypoints")!.click();
    expect(host.modal!.textContent).toContain("Bryn");
    host.button("Use next greeting", host.modal!).click();
    expect(host.request("set-upcoming").input).toEqual({ chatId: "chat-b", selection: { characterId: "b", greetingIndex: 1 } });
    host.reply(host.request("set-upcoming"));
    await host.finishRefreshes();
    expect(host.modal).toBeUndefined();
    expect(host.button("Force").disabled).toBe(false);
    expect(host.button("Force", host.hud!).disabled).toBe(false);
  });

  test("checks the live selection before acting even when no lifecycle notification has arrived", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    const staleForce = host.button("Force");
    host.switchTo("chat-b", "b", false);
    staleForce.click();
    expect(host.requests.some((request) => request.action === "force")).toBe(false);
    expect(host.request("refresh").input.chatId).toBe("chat-b");
    await host.finishRefreshes();
    staleForce.click();
    expect(host.requests.some((request) => request.action === "force")).toBe(false);
  });

  test("older hosts recover without another event and stop observing on teardown", async () => {
    host = new FrontendHost(false);
    await host.finishRefreshes();
    host.events.get("CHAT_SWITCHED")?.();
    await host.finishRefreshes();
    host.switchTo("chat-b", "b");
    await Bun.sleep(550);
    expect(host.request("refresh").input.chatId).toBe("chat-b");
    await host.finishRefreshes();
    expect(host.drawer.textContent).toContain("Bryn");
    host.events.get("CHAT_CHANGED")?.();
    const reply = host.backendListener!;
    const pending = host.request("refresh");
    host.destroy();
    const reads = host.selectionReads;
    const requests = host.requests.length;
    reply({ type: "waypoints:reply", requestId: pending.requestId, result: status("chat-b") });
    await Bun.sleep(550);
    expect(host.selectionReads).toBe(reads);
    expect(host.requests).toHaveLength(requests);
    expect(host.drawer.isConnected).toBe(false);
    expect(host.hud).toBeUndefined();
    expect(host.events.size).toBe(0);
  });
});

describe("frontend storyline designer", () => {
  test("reorders and excludes greetings, then saves the storyline for the character", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    host.button("Storyline").click();
    expect(host.drawer.textContent).toContain("Ada's storyline");
    const rows = () => [...host!.drawer.querySelectorAll(".wp-story-row")];
    expect(rows()).toHaveLength(3);
    expect(host.button("Save storyline").disabled).toBe(true);

    // Move greeting 3 to the top, and leave greeting 2 out.
    host.drawer.querySelector<HTMLButtonElement>("[aria-label='Move greeting 3 earlier']")!.click();
    host.drawer.querySelector<HTMLButtonElement>("[aria-label='Move greeting 3 earlier']")!.click();
    const skip = host.drawer.querySelector<HTMLInputElement>("[aria-label='Include greeting 2 in the storyline']")!;
    skip.checked = false;
    skip.onchange?.(new host.dom.window.Event("change"));
    expect(rows().map((row) => row.querySelector(".wp-story-step")!.textContent)).toEqual(["1", "2", "–"]);
    const notes = host.drawer.querySelector<HTMLTextAreaElement>("[aria-label='Author guidance']")!;
    notes.value = "Slow burn";
    notes.oninput?.(new host.dom.window.Event("input"));
    const persona = host.drawer.querySelector<HTMLInputElement>("[aria-label='Include the current user persona']")!;
    expect(persona.checked).toBe(true);
    persona.checked = false;
    persona.onchange?.(new host.dom.window.Event("change"));
    expect(host.drawer.textContent).toContain("Unsaved changes.");

    host.button("Save storyline").click();
    await flush();
    const request = host.request("save-storyline");
    expect(request.input).toEqual({
      chatId: "chat-a",
      characterId: "a",
      storyline: { route: [2, 0], notes: "Slow burn", includePersona: false, includeCharacter: true, overview: "" },
    });
    const saved = status("chat-a");
    saved.storyline.characters[0] = { ...saved.storyline.characters[0], route: [2, 0], effectiveRoute: [2, 0], notes: "Slow burn", updatedAt: 1 };
    host.reply(request, saved);
    await host.finishRefreshes();
  });

  test("generates an overview with a long timeout and shows Cancel while it runs", async () => {
    host = new FrontendHost();
    host.reply(host.request("refresh"), { ...status("chat-a"), grantedPermissions: ["ui_panels", "generation"] });
    await flush();
    host.button("Storyline").click();
    host.button("Generate overview").click();
    await flush();
    const request = host.request("generate-storyline");
    expect(request.input).toEqual({
      chatId: "chat-a", characterId: "a", storyline: { route: [], notes: "", includePersona: true, includeCharacter: true },
    });
    expect(host.drawer.textContent).toContain("Generating the narrative overview…");
    host.button("Cancel").click();
    expect(host.request("cancel-storyline").input).toEqual({ characterId: "a" });
    host.reply(request, undefined, "Narrative overview generation was cancelled.");
    await host.finishRefreshes();
    expect(host.drawer.textContent).toContain("Narrative overview generation was cancelled.");
    expect(host.button("Generate overview").disabled).toBe(false);
  });

  test("picks a generator connection and model override, saving them before generating", async () => {
    host = new FrontendHost();
    host.reply(host.request("refresh"), { ...status("chat-a"), grantedPermissions: ["ui_panels", "generation"] });
    await flush();
    host.button("Storyline").click();
    host.reply(host.request("list-connections"), [
      { id: "fast", name: "Fast", model: "small", isDefault: false },
      { id: "main", name: "Main", model: "big", isDefault: true },
    ]);
    await flush();

    // Blank means the connection's own model; the default connection is the one in play.
    let model = host.comboboxes.at(-1)!;
    expect(model.input.placeholder).toBe("Use connection default");
    expect(model.options.connection).toEqual({ kind: "llm", id: "main" });
    expect(host.drawer.textContent).toContain("Leave blank to use the connection's own model (big).");

    const select = [...host.drawer.querySelectorAll("select")].find((node) => [...node.options].some((option) => option.value === "fast"))!;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Default connection", "Fast — small", "Main — big (default)"]);
    select.value = "fast";
    select.dispatchEvent(new host.dom.window.Event("change"));
    expect(model.options.connection).toEqual({ kind: "llm", id: "fast" });
    expect(host.drawer.textContent).toContain("own model (small).");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const connectionSave = host.request("set-storyline-generator");
    expect(connectionSave.input).toEqual({ connectionId: "fast", model: "" });
    host.reply(connectionSave, { settings: { ...DEFAULT_SETTINGS, storylineConnectionId: "fast" }, warnings: [] });
    await flush();

    model = host.comboboxes.at(-1)!;
    model.input.value = "small-2";
    model.input.dispatchEvent(new host.dom.window.Event("input"));
    host.button("Generate overview").click();
    await flush();
    // The typed model is saved first, without waiting for the typing pause.
    const modelSave = host.request("set-storyline-generator");
    expect(modelSave.input).toEqual({ connectionId: "fast", model: "small-2" });
    expect(host.requests.some((request) => request.action === "generate-storyline")).toBe(false);
    host.reply(modelSave, { settings: { ...DEFAULT_SETTINGS, storylineConnectionId: "fast", storylineModel: "small-2" }, warnings: [] });
    await flush();
    await flush();
    expect(host.request("generate-storyline").input.characterId).toBe("a");

    // The Settings draft follows, so saving settings later keeps the choice.
    host.button("Settings").click();
    host.button("Save changes").click();
    await flush();
    expect(host.request("save-settings").input.settings).toMatchObject({ storylineConnectionId: "fast", storylineModel: "small-2" });
  });

  test("a failed generator save stops generation and explains why", async () => {
    host = new FrontendHost();
    host.reply(host.request("refresh"), { ...status("chat-a"), grantedPermissions: ["ui_panels", "generation"] });
    await flush();
    host.button("Storyline").click();
    host.reply(host.request("list-connections"), []);
    await flush();
    const model = host.comboboxes.at(-1)!;
    model.input.value = "x";
    model.input.dispatchEvent(new host.dom.window.Event("input"));
    host.button("Generate overview").click();
    await flush();
    host.reply(host.request("set-storyline-generator"), undefined, "storylineModel is too long.");
    await flush();
    await flush();
    expect(host.requests.some((request) => request.action === "generate-storyline")).toBe(false);
    expect(host.drawer.textContent).toContain("storylineModel is too long.");
  });
});

describe("frontend Prompts and Settings tabs", () => {
  test("hides the card switch until it is turned on and can clear card data", async () => {
    host = new FrontendHost();
    const withData = status("chat-a");
    withData.characters[0].cardData = true;
    host.reply(host.request("refresh"), withData);
    await flush();
    expect(host.drawer.querySelector("[aria-label='Enable Waypoints for Ada']")).toBeNull();
    expect(host.drawer.textContent).toContain("Waypoints never writes to character cards");
    host.button("Clear Waypoints data from character card").click();
    expect(host.request("clear-character-data").input).toEqual({ chatId: "chat-a", characterId: "a" });
    host.reply(host.request("clear-character-data"));
    await host.finishRefreshes();
    expect(host.button("Clear Waypoints data from character card").disabled).toBe(true);

    const on = status("chat-a");
    on.settings.characterCardSwitch = true;
    host.refreshNow(on);
    await flush();
    expect(host.drawer.textContent).toContain("Changing it writes Waypoints data to the card.");
    const toggle = host.drawer.querySelector<HTMLInputElement>("[aria-label='Enable Waypoints for Ada']")!;
    // Re-reporting the current value never writes to the card.
    toggle.dispatchEvent(new host.dom.window.Event("change"));
    expect(host.requests.some((request) => request.action === "set-enabled")).toBe(false);
    toggle.checked = false;
    toggle.dispatchEvent(new host.dom.window.Event("change"));
    expect(host.request("set-enabled").input).toMatchObject({ characterId: "a", enabled: false });
  });

  test("prompts live on their own tab and share one draft with Settings", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    host.button("Prompts").click();
    const template = host.drawer.querySelector<HTMLTextAreaElement>("[aria-label='Scene-shaping template']")!;
    expect(host.drawer.querySelector("[aria-label='Overview generator instructions']")).not.toBeNull();
    template.value = DEFAULT_SETTINGS.promptTemplate + "\nExtra";
    template.oninput?.(new host.dom.window.Event("input"));

    host.button("Settings").click();
    expect(host.drawer.querySelector("[aria-label='Scene-shaping template']")).toBeNull();
    const startState = [...host.drawer.querySelectorAll("select")].find((node) => [...node.options].some((option) => option.textContent === "Waypoints OFF for new chats"))!;
    startState.value = "off";
    startState.dispatchEvent(new host.dom.window.Event("change"));

    // Resetting settings leaves the prompt edit alone.
    host.button("Reset settings to defaults").click();
    host.button("Prompts").click();
    expect(host.drawer.querySelector<HTMLTextAreaElement>("[aria-label='Scene-shaping template']")!.value).toEndWith("Extra");
    host.button("Settings").click();
    const again = [...host.drawer.querySelectorAll("select")].find((node) => [...node.options].some((option) => option.textContent === "Waypoints OFF for new chats"))!;
    expect(again.value).toBe("on");
    again.value = "off";
    again.dispatchEvent(new host.dom.window.Event("change"));
    host.button("Save changes").click();
    await flush();
    expect(host.request("save-settings").input.settings).toMatchObject({ newChatsEnabled: false, promptTemplate: DEFAULT_SETTINGS.promptTemplate + "\nExtra" });
  });

  test("child options show only while their parent option is on", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    host.button("Settings").click();
    const box = (label: string) => host!.drawer.querySelector<HTMLInputElement>("[aria-label='" + label + "']")!;
    const shown = (label: string) => !box(label).closest(".wp-suboptions[hidden]");
    expect(shown("Fade out?")).toBe(true);
    expect(shown("Color the button by chat state")).toBe(true);
    box("Fade out?").click();
    expect(box("Fade out?").closest(".wp-suboptions")!.querySelector(".wp-suboptions")!.hasAttribute("hidden")).toBe(true);
    box("Show a reminder when a chat opens").click();
    expect(shown("Fade out?")).toBe(false);
    box("Show the compass button in the chat action bar").click();
    expect(shown("Color the button by chat state")).toBe(false);
  });
});
