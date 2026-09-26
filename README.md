# Waypoints

Waypoints turns a character card's greetings into intentional story destinations. It privately shows the next greeting to the model as scene-shaping guidance, waits for the model to emit a configurable handoff tag, removes that tag before the response is stored or displayed, and then inserts the selected greeting as the next assistant message.

It is a clean Lumiverse extension, not a migration layer for Greeting Inspector. It never reads or imports `GreetingInspector*` chat variables.

## Install

Waypoints requires Lumiverse 1.2.0 or newer and Bun.

1. Disable the old **Greeting Inspector** LumiScript before enabling Waypoints. Leaving both active can cause two handoff handlers to react to one tag.
2. From this repository, run:

   ```powershell
   bun install
   bun run build
   ```

3. Install the repository folder as `lumiverse_waypoints` in Lumiverse's extensions directory (or install it with the Lumiverse extension UI). Its root must contain `spindle.json` and the built `dist/backend.js` and `dist/frontend.js`.
4. Enable Waypoints in Lumiverse and grant:
   - `characters`
   - `chats`
   - `chat_mutation`
   - `interceptor`
   - `generation`
   - `ui_panels`

The drawer works without `ui_panels`; that grant only enables the optional floating controls. If a grant needed for automatic transitions is absent, the drawer reports exactly which grants are missing.

## Using Waypoints

Open the **Waypoints** drawer tab.

- Pick an active greeting and an upcoming greeting.
- In a solo chat, the ON/OFF switch is stored in that character's `lumiverse_waypoints` extension data.
- In a group chat, every member has its own per-chat ON/OFF override. New members default to ON, and the greeting pickers can select any member's greeting.
- Turn on **Auto-prompt** when you want the rendered scene direction added to every generation. It is off by default, so you can inspect the prompt first.
- Use **Force** to insert the currently selected upcoming greeting immediately.
- Use **Undo** to remove the latest message that Waypoints itself inserted and restore its previous current and next greeting selections. The original handoff stays consumed; use **Force** if you intentionally want to insert that greeting again.

By default the model should emit:

```text
<inject-prewritten-content />
```

The tag may also be paired, such as `<inject-prewritten-content>...</inject-prewritten-content>`. Waypoints removes the entire tag construct before it reaches the visible/stored message, stamps the processed message with extension metadata, and advances once.

The default user override marker is:

```text
--o--
```

The scene-shaping prompt tells the model to make a best-effort transition when that marker appears in the user's latest reply.

## Settings

The drawer's **Settings** tab keeps an editable draft. Changes do not affect a live generation while you type; Waypoints validates the complete draft and saves one settings object only after you select **Save settings**.

### Prompt

The default full scene-shaping template is editable. It supports:

| Placeholder | Meaning |
| --- | --- |
| `{{scene_excerpt}}` | The next greeting after exclusion filtering and the configured character limit. Required. |
| `{{handoff_tag}}` | The current self-closing handoff tag. Required. |
| `{{override_tag}}` | The current `--name--` user override marker. Recommended; Waypoints warns if omitted. |

The exclusion regex runs before the excerpt is truncated. It accepts JavaScript-style literals such as `/private note/gi` and the old LumiScript-style `x` flag, which ignores unescaped whitespace and `#` comments outside character classes.

You can also configure the prompt role, insertion depth (`0` is the newest edge), and whether automatic prompt insertion is enabled.

### Loom preset injection

If you prefer Loom to place the guidance, leave **Auto-prompt** off and put this in the appropriate Loom prompt block:

```text
{{if::{{waypoints_active}}}}
{{waypoints_content}}
{{/if}}
```

`{{waypoints_active}}` returns `true` only when the selected Waypoints path is enabled and has a renderable upcoming scene. `{{waypoints_content}}` returns that same rendered scene prompt. These are Waypoints extension macros, not local variables, so use them without a leading `.`. The Loom block controls placement and role; Waypoints' automatic-insertion role and depth apply only when **Auto-prompt** is on. Do not enable both paths unless you intentionally want the guidance twice.

Pre-run council tools can also use `{{altMessage1}}`, `{{altMessage2}}`, and higher indices for the active character's alternate greetings. `{{altMessages}}` returns those alternate greetings as a JSON array; the character's standard `{{firstMessage}}` is not included. When switching to a character with fewer alternate greetings, the higher indexed macros are unregistered.

`{{nextMessages}}` returns the greetings offered by Waypoints' **Next greeting** picker as a JSON array. In solo chats, that means only greetings after the current greeting; in group chats, it matches the picker by including the other members' greetings and excluding the current selection. `{{currentMessage}}` and `{{nextMessage}}` return the configured current and upcoming greeting text, respectively.

### Handoff and advanced behavior

The handoff tag name and override marker are validated before save. Advanced settings expose interceptor/content-processor priority, chat and handoff-read retries, retry delay, pending-handoff and dedupe-journal limits, and diagnostic retention.

The optional floating ON / Undo / Force control is enabled by default. Lumiverse owns its drag position and reset behavior; Waypoints does not persist a competing position.

The **Interface** section also has a chat-switch reminder, enabled by default. It asks whether to use Waypoints in the selected chat in a small floating widget. New chats get 10 seconds and existing chats get 5 seconds; the bar and second counter show the time left. **Yes** enables Waypoints for that chat and **No** pauses it. The timeout answer defaults to **Yes** and can be changed to **No** in Settings. A chat's choice is stored with that chat and can be changed later with **Use Waypoints in this chat** in the drawer. The reminder needs `ui_panels` permission and appears only when switching chats, not when the extension first loads. Lumiverse remembers where you drag the reminder and restores that position for later chats, separately from the floating controls.

The **Interface** section also controls two input-bar surfaces, both enabled by default:

- **Compass button** mounts a compact Waypoints compass beside Lumiverse's native action-bar buttons above the input. Its themed menu contains the chat-level Toggle, Choose current greeting, Choose next greeting, Force, Undo, and Open Waypoints drawer.
- **Extras actions** adds the chat-level Toggle, Choose current greeting, Choose next greeting, Undo, and Force entries to Lumiverse's native **Extras** popover under the Waypoints extension heading.

The two greeting-choice actions open a full-size picker modeled on Greeting Inspector: choose from the available greetings, inspect a large scrollable preview, then confirm with **Use current greeting** or **Use next greeting**. In solo chats, next-greeting choices stay later in the active character's greeting sequence. In group chats, next-greeting choices include every member's greeting except the current one.

These surfaces are independent of the floating widget. They do not require another permission; the actions still report missing `characters`, `chats`, or `chat_mutation` grants when an operation needs them. The host owns the Quick Replies, Tools, and Extras categories, so Waypoints cannot add native entries directly to Quick Replies or Tools or create another host category.

## Safety and recovery

Before appending a greeting, Waypoints stores a persistent per-chat journal. The inserted assistant message is stamped with journal and selection metadata. On duplicate lifecycle events or a worker restart, Waypoints checks for that stamped message before it inserts again. This avoids double advancement while retaining recovery after an append succeeds just before the worker is interrupted.

Handoffs are tied to a specific saved assistant reply and swipe, using the content after tag removal. Generation and edit notifications for that same reply share a duplicate check. Switching chats, rendering history, and navigating existing swipes never trigger an insertion. A stopped generation without a message ID can inspect only the current reply, so an old handoff elsewhere in the chat cannot trigger the next greeting.

Undo is intentionally narrow: it only deletes the most recent assistant message carrying Waypoints' own insertion metadata. It never decides from matching text, proximity, or a user message, so it will not remove an unrelated user-authored message.

## Known boundaries

- Waypoints does not import prior Greeting Inspector state. Start by selecting the active and upcoming greetings in its drawer.
- Handoff tags are control signals, not a general scene-end marker. A tag has to be emitted for an automatic insertion; a stopped generation can still advance only if its partial content contains the tag.
- If a greeting is edited or removed from a character card, Waypoints reconciles stale selections to the next valid greeting. Check the drawer after card edits.
- The prompt is private guidance, not a copy mechanism. The default template explicitly tells the model not to quote or reproduce the upcoming greeting before handoff.
- A paired handoff tag and all of its contents are stripped, matching the original Greeting Inspector behavior.

## Development

```powershell
bun run typecheck
bun test
bun run build
```

The test suite covers configuration/prompt/tag/selection behavior, transition journaling and recovery, duplicate lifecycle notifications, Undo selection restoration, and frontend navigation, picker, and control behavior.
