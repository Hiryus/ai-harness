// The session mode, shared by the server (`index.ts`) and TUI (`tui.ts`) plugins.
// It lives in the metadata of the root session: the TUI writes it, the server reads it.

export const MODE_KEY = "harness.mode"
export const MODES = ["manual", "edit", "auto"]

// A session that records no mode - or a name that no mode answers to - runs in manual mode.
export function modeOf(metadata: Readonly<Record<string, unknown>> | undefined): string {
  const mode = metadata?.[MODE_KEY]
  return typeof mode === "string" && MODES.includes(mode) ? mode : "manual"
}
