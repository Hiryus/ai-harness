import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SESSION = '6c194564-b08a-44dc-9661-8d05e07cb52d'
const FILE = `/home/user/.claude/sessions/${SESSION}.json`
const PRESENTATION = { isFullscreen: false, columns: 120 } as const
const NOTE = /now runs in (\w+) mode/

// ============================================================================
// Helpers
// ============================================================================

// The world beneath the plugin: one session, its state file in memory.
function world(on: On, contents?: string): Map<string, string> {
  const files = new Map<string, string>()
  if (contents !== undefined) {
    files.set(FILE, contents)
  }
  mock.env(on, { HOME: '/home/user' })
  on('session.id', () => ({ value: SESSION }))
  on('command.register', () => ({ value: { command: 'mode' } }))
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) {
      throw new Error(`ENOENT: ${e.path}`)
    }
    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  return files
}

function typed($: Engine, args: string, origin: 'composer' | 'sdk' = 'composer') {
  return $.command.run({ command: 'mode', args, origin: { kind: origin }, presentation: PRESENTATION })
}

function recorded(files: Map<string, string>): unknown {
  const text = files.get(FILE)
  return text === undefined ? undefined : JSON.parse(text)
}

// ============================================================================
// The command
// ============================================================================

test('switching records the mode and keeps the other keys', async ($, on) => {
  const files = world(on, '{"pid": 141269}')
  const { text } = await typed($, 'edit')
  expect(text).toBe('Mode is now EDIT for this session.')
  expect(recorded(files)).toEqual({ pid: 141269, mode: 'edit' })
})

test('switching creates a missing or corrupt file', async ($, on) => {
  const files = world(on, 'not json')
  await typed($, 'auto')
  expect(recorded(files)).toEqual({ mode: 'auto' })
})

test('only the user switches the mode', async ($, on) => {
  const files = world(on)
  const { text } = await typed($, 'auto', 'sdk')
  expect(text).toMatch(/only be switched by the user/)
  expect(recorded(files)).toBe(undefined)
})

test('an unknown mode is refused and records nothing', async ($, on) => {
  const files = world(on)
  const { text } = await typed($, 'config')
  expect(text).toMatch(/Unknown mode/)
  expect(recorded(files)).toBe(undefined)
})

test('reporting gives the mode and the session id', async ($, on) => {
  world(on, '{"mode": "edit"}')
  expect((await typed($, '')).text).toBe(`Mode is currently EDIT (session ${SESSION}).`)
  expect((await typed($, 'info')).text).toBe(`Mode is currently EDIT (session ${SESSION}).`)
})

test('reporting gives manual for an unknown recorded name', async ($, on) => {
  world(on, '{"mode": "config"}')
  expect((await typed($, 'info')).text).toMatch(/^Mode is currently MANUAL/)
})

test('on Windows the file is under USERPROFILE, as python resolves it', async ($, on) => {
  const files = new Map<string, string>()
  mock.env(on, { OS: 'Windows_NT', HOME: '/c/Users/user', USERPROFILE: 'C:\\Users\\user' })
  on('session.id', () => ({ value: SESSION }))
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  await typed($, 'edit')
  // The test host is not Windows: it reads `C:\...` as relative and prefixes its cwd.
  const written = [...files.keys()]
  expect(written.length).toBe(1)
  expect(written[0]?.endsWith(`C:\\Users\\user/.claude/sessions/${SESSION}.json`)).toBe(true)
})

// ============================================================================
// The announcement
// ============================================================================

test('a switch is announced once, beside the next tool result', async ($, on) => {
  world(on)
  await typed($, 'auto')
  const first = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(first.context?.join('\n')).toMatch(NOTE)
  const second = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(second.context).toBe(undefined)
})

test('a subagent call leaves the announcement to the main thread', async ($, on) => {
  world(on)
  await typed($, 'edit')
  const sub = await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  expect(sub.context).toBe(undefined)
  const main = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(main.context?.join('\n')).toMatch(NOTE)
})

test('a switch with no tool call is announced beside the next prompt', async ($, on) => {
  world(on)
  await typed($, 'edit')
  const entered = await $.prompt.submit({ text: 'carry on', wait: false, origin: { kind: 'composer' } })
  expect(entered.context?.join('\n')).toMatch(NOTE)
})

test('the default mode is never announced', async ($, on) => {
  world(on)
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(ran.context).toBe(undefined)
  const entered = await $.prompt.submit({ text: 'carry on', wait: false, origin: { kind: 'composer' } })
  expect(entered.context).toBe(undefined)
})

test('switching back to manual is announced too', async ($, on) => {
  world(on)
  await typed($, 'auto')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await typed($, 'manual')
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(ran.context?.join('\n')).toMatch(/manual mode/)
})
