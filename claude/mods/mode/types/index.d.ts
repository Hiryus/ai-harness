export type ModeName = 'manual' | 'edit' | 'auto'

declare module 'claude-code' {
  interface PluginState {
    'harness-mode': { announced: ModeName }
  }
}
