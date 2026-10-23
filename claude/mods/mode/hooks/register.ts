// The `/mode <manual|edit|auto>` command of the harness (cf. SECURITY.md, "Modes"):
// - declared `immediate`, so a switch typed mid-turn applies to the very next tool call,
// - recorded in `~/.claude/sessions/<session_id>.json`, the file the python tool hooks read,
// - announced to the model once per switch, beside the next tool result or the next prompt.

import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModeName } from '../types'

const MODES: readonly ModeName[] = ['manual', 'edit', 'auto']
const DEFAULT: ModeName = 'manual'
const REPORT = 'info' // `/mode info` and `/mode` alone both report rather than switch.
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/ // Same rule as `claude/utils/session.py`.

// The last mode the model was told about. Manual is the default: it needs no announcement.
const announced = atom({ plugin: 'harness-mode', key: 'announced' } as const, DEFAULT as ModeName)

// ============================================================================
// Session file
// ============================================================================

function modeOf(name: unknown): ModeName {
  // Same fallback as `Mode.of`: anything unknown is manual.
  return MODES.find(mode => mode === name) ?? DEFAULT
}

// The home python's `Path.home()` resolves, so both sides name the same file:
// `USERPROFILE` on Windows (even when a bash sets `HOME`), `HOME` elsewhere.
async function homeDir($: EngineInterface): Promise<string | undefined> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  return isWindows ? await $.env.get('USERPROFILE') : await $.env.get('HOME')
}

async function stateFile($: EngineInterface): Promise<string | undefined> {
  const id = await $.session.id()
  const home = await homeDir($)
  if (!home || !SESSION_ID.test(id)) {
    return undefined
  }
  return `${home}/.claude/sessions/${id}.json`
}

async function readState($: EngineInterface, path: string): Promise<Record<string, unknown>> {
  // Tolerant like `read_mode`: a missing or corrupt file reads as nothing recorded.
  try {
    const state: unknown = JSON.parse(await $.fs.read(path))
    return state !== null && typeof state === 'object' && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

async function currentMode($: EngineInterface): Promise<ModeName> {
  const path = await stateFile($)
  return path ? modeOf((await readState($, path)).mode) : DEFAULT
}

// ============================================================================
// Announcement
// ============================================================================

// The note for the model when the mode changed since it was last told, else undefined.
// Taken in one `update`, so two concurrent calls never both announce the same switch.
async function takeAnnouncement($: EngineInterface): Promise<string | undefined> {
  const mode = await currentMode($)
  let note: string | undefined
  await update($, announced, previous => {
    note = previous === mode ? undefined : `**The session now runs in ${mode} mode, as set by the user.**`
    return mode
  })
  return note
}

// ============================================================================
// Hooks
// ============================================================================

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Also runs on a reload and after a `/clear`: the model is told again about any non-default mode.
    await update($, announced, () => DEFAULT)
    await $.command.register({
      name: 'mode',
      description: 'Report or switch the autonomy mode of the current session.',
      argumentHint: 'info|manual|edit|auto',
      immediate: true,
    })
    return next(e)
  })

  // Answered here, without `next`: the command never reaches the model.
  on('command.run', { command: 'mode' }, async ($, e) => {
    // Only the user switches the mode: anything not typed at the prompt is refused.
    if (e.origin.kind !== 'composer') {
      return { text: 'The mode can only be switched by the user typing `/mode` at the prompt.' }
    }
    const name = e.args.trim().toLowerCase() || REPORT
    const path = await stateFile($)
    if (name === REPORT) {
      const mode = path ? modeOf((await readState($, path)).mode) : DEFAULT
      return { text: `Mode is currently ${mode.toUpperCase()} (session ${await $.session.id()}).` }
    }
    const mode = MODES.find(one => one === name)
    if (!mode) {
      return { text: `Unknown mode \`${name}\`: use manual, edit, or auto.` }
    }
    if (!path) {
      return { text: 'Cannot switch the mode: no usable session id or home directory.' }
    }
    // Merged like `write_mode`: the other keys of the file are kept.
    const state = await readState($, path)
    await $.fs.write(path, JSON.stringify({ ...state, mode }, null, 2))
    return { text: `Mode is now ${mode.toUpperCase()} for this session.` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // A subagent's result would swallow the note meant for the main thread.
    if (e.agentId !== undefined || ran.deny !== undefined) {
      return ran
    }
    const note = await takeAnnouncement($)
    return note ? { ...ran, context: [...(ran.context ?? []), note] } : ran
  }).catch(($, e, next) => next(e)) // The python hooks are the gate: a failure here only loses the note.

  on('prompt.submit', async ($, e, next) => {
    // A slash command is no prompt for the model: the note waits for the next real one.
    if (e.command !== undefined) {
      return next(e)
    }
    const note = await takeAnnouncement($)
    return next(note ? { ...e, context: [...(e.context ?? []), note] } : e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    // The summary may lose the announcement: the main thread is told again.
    if (e.agentId === undefined) {
      await update($, announced, () => DEFAULT)
    }
    return compacted
  }).catch(($, e, next) => next(e))
}
