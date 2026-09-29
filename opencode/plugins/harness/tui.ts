// Handles `/mode <manual|edit|auto>` in the TUI: the mode is recorded in the metadata of the root session, read by `index.ts`.
// The answer is a toast: a session message would be sent to the model with the next prompt.

import type { Plugin } from "@opencode/plugin/tui"
import { MODE_KEY, MODES, modeOf } from "./mode.ts"

// ============================================================================
// Session mode
// ============================================================================

// The raw input may still carry the command itself: only its last word is the mode.
function parseMode(input: string | undefined): string {
  const words = String(input ?? "").trim().toLowerCase().split(/\s+/)
  const name = words.at(-1) ?? ""
  return name.startsWith("/") ? "" : name
}

// The home screen has no session yet: opencode would create it with the first prompt, too late for that prompt to see the mode.
// The session is created here instead, with the mode in its metadata from the start, and opened.
async function openSession(ctx: Plugin.Context, mode: string) {
  const selected = ctx.ui.model.current()
  const session = await ctx.client.session.create({
    location: ctx.location ?? ctx.data.location.default(),
    model: selected ? { id: selected.modelID, providerID: selected.providerID, variant: selected.variant } : undefined,
    metadata: { [MODE_KEY]: mode },
  })
  ctx.ui.router.navigate({ type: "session", sessionID: session.id })
}

async function runMode(ctx: Plugin.Context, input: string | undefined) {
  const name = parseMode(input)
  const info = !name || name === "info"
  if (!info && !MODES.includes(name)) {
    ctx.ui.toast.show({ message: `Unknown mode \`${name}\`: use manual, edit, or auto.`, variant: "warning" })
    return
  }
  const route = ctx.ui.router.current()
  if (route.type !== "session") {
    if (info) {
      ctx.ui.toast.show({ message: "No session yet: it will run in MANUAL mode, or open one with `/mode <name>`.", variant: "info" })
    } else {
      await openSession(ctx, name)
      ctx.ui.toast.show({ message: `Mode is now ${name.toUpperCase()} for this new session.`, variant: "success" })
    }
    return
  }
  // The mode is set on the session the user talks to: subagent sessions inherit it from their root.
  const rootID = ctx.data.session.root(route.sessionID)
  await ctx.data.session.sync(rootID)
  const root = ctx.data.session.get(rootID)
  if (!root) {
    ctx.ui.toast.show({ message: "Cannot read or switch the mode: the session could not be resolved.", variant: "error" })
  } else if (info) {
    ctx.ui.toast.show({ message: `Mode is currently ${modeOf(root.metadata).toUpperCase()}.`, variant: "info" })
  } else {
    // The update may replace the whole metadata: the other keys are carried over.
    await ctx.client.session.update({ sessionID: rootID, metadata: { ...root.metadata, [MODE_KEY]: name } })
    ctx.ui.toast.show({ message: `Mode is now ${name.toUpperCase()} for this session.`, variant: "success" })
  }
}

// ============================================================================
// Plugin
// ============================================================================

export default {
  id: "harness",

  setup(ctx: Plugin.Context) {
    // A keymap layer belongs to a component: it is created in an empty one, rendered in the `app` slot.
    return ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          priority: 10,
          commands: [
            {
              id: "harness.mode",
              title: "Show or set the session mode: manual, edit or auto.",
              group: "harness",
              slash: { name: "mode", arguments: true },
              run: async (input?: string) => {
                try {
                  await runMode(ctx, input)
                } catch (err) {
                  ctx.ui.toast.show({ message: `Cannot read or switch the mode: ${err}`, variant: "error" })
                }
              },
            },
          ],
        }))
        return null
      },
    })
  },
} satisfies Plugin.Definition
