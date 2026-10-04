import type { Mind, Mood, Species, View } from '../types'

export const IDLE: View = { mood: 'idle', line: '', holdUntil: 0 }

/** How long a passing mood (happy, flinch, proud, a pet) holds, in ms. */
export const HOLD_MS = 6_000
/** Quiet this long and it dozes off. */
export const SLEEP_AFTER_MS = 10 * 60_000
/** A main-loop turn at least this long earns a proud line. */
export const LONG_TURN_MS = 120_000
/** A rate-limit window this full makes it sleepy. */
export const LOW_JUICE_PERCENT = 90

const TEST_COMMAND = /\b((npm|pnpm|yarn|bun)( run)? test|pytest|go test|cargo test|vitest|jest|rspec|mix test|claude plugin test)\b/

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command)
}

/** What happened, as the hooks module saw it. */
export type Signal =
  | { kind: 'turn-start' }
  | { kind: 'tool'; command?: string; isError: boolean; deny?: string }
  | { kind: 'turn-complete'; durationMs: number; isAborted: boolean }
  | { kind: 'limits'; percentUsed: number; resetsAt?: string }
  | { kind: 'pet' }
  | { kind: 'tick' }

export const FRESH: Mind = { view: IDLE, isWorking: false, errorStreak: 0, testsFailing: false, lastActiveAt: 0 }

const PET_LINES: Record<Species, string[]> = {
  clawd: ['*happy wiggle*', 'back to it.', 'pinch of thanks.'],
  sprout: ['*rustles*', 'a little sun, thanks.', 'leaning toward you.'],
  owl: ['hoo.', '*ruffles feathers*', 'noted.'],
  blob: ['*squish*', 'boing.', 'jiggly thanks.'],
  custom: ['hi.', '*happy noise*', 'again.'],
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

function clockTime(iso: string): string {
  const at = new Date(iso)
  return `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** XP needed grows with the square of the level: 5 xp for lvl 2, 80 for lvl 5, 405 for lvl 10. */
export function levelFor(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 5)) + 1
}

/**
 * One signal in, the next mind out, plus any xp earned. Pure: the hooks module
 * owns the clock and passes `now`, and picks `petLine` so tests stay stable.
 */
export function react(
  mind: Mind,
  signal: Signal,
  now: number,
  species: Species,
  petLine = 0,
): { mind: Mind; xp: number } {
  const base: Mood = mind.isWorking ? 'working' : 'idle'
  const show = (mood: Mood, line: string, hold = false): View => ({ mood, line, holdUntil: hold ? now + HOLD_MS : 0 })
  const active = { ...mind, lastActiveAt: now }

  switch (signal.kind) {
    case 'turn-start':
      return { mind: { ...active, isWorking: true, view: show('working', 'on it.') }, xp: 0 }

    case 'tool': {
      if (signal.deny !== undefined) {
        const isSeatbelt = signal.deny.startsWith('seatbelt:')
        return { mind: { ...active, view: isSeatbelt ? show('flinch', 'close one.', true) : show(base, 'denied. fair.') }, xp: 0 }
      }
      const isTest = signal.command !== undefined && isTestCommand(signal.command)
      if (signal.isError) {
        const errorStreak = mind.errorStreak + 1
        const line = isTest ? 'tests failing.' : errorStreak >= 3 ? 'rough patch.' : errorStreak === 2 ? "that's two fails." : 'hm.'
        return { mind: { ...active, errorStreak, testsFailing: mind.testsFailing || isTest, view: show('worried', line) }, xp: 0 }
      }
      if (isTest && mind.testsFailing) {
        return { mind: { ...active, errorStreak: 0, testsFailing: false, view: show('happy', 'tests green. nice.', true) }, xp: 5 }
      }
      const view = mind.view.mood === 'worried' ? show(base, mind.view.line) : mind.view
      return { mind: { ...active, errorStreak: 0, view }, xp: 0 }
    }

    case 'turn-complete': {
      const settled = { ...active, isWorking: false }
      if (signal.isAborted) return { mind: { ...settled, view: show('idle', 'stopped.') }, xp: 0 }
      if (signal.durationMs >= LONG_TURN_MS) {
        return { mind: { ...settled, view: show('proud', `${formatDuration(signal.durationMs)}. long one.`, true) }, xp: 1 }
      }
      const keep = mind.view.mood === 'worried' || mind.view.holdUntil > now
      return { mind: { ...settled, view: keep ? mind.view : show('idle', mind.view.line) }, xp: 1 }
    }

    case 'limits': {
      if (signal.percentUsed < LOW_JUICE_PERCENT) {
        return { mind: mind.view.mood === 'sleepy' ? { ...mind, view: show(base, '') } : mind, xp: 0 }
      }
      const resets = signal.resetsAt === undefined ? '' : ` resets ${clockTime(signal.resetsAt)}.`
      return { mind: { ...mind, view: show('sleepy', `low on juice.${resets}`) }, xp: 0 }
    }

    case 'pet': {
      const lines = PET_LINES[species]
      return { mind: { ...active, view: show('happy', lines[petLine % lines.length] ?? 'hi.', true) }, xp: 0 }
    }

    case 'tick': {
      const { view } = mind
      if (view.holdUntil > 0 && view.holdUntil <= now) return { mind: { ...mind, view: show(base, view.line) }, xp: 0 }
      const isQuiet = !mind.isWorking && mind.lastActiveAt > 0 && now - mind.lastActiveAt >= SLEEP_AFTER_MS
      if (isQuiet && view.mood !== 'sleepy') return { mind: { ...mind, view: show('sleepy', 'zz.') }, xp: 0 }
      return { mind, xp: 0 }
    }
  }
}

/** A quip from the model, cut down to the band's voice: one short lowercase line, plain characters. */
export function cleanQuip(text: string): string | undefined {
  const line = text
    .split('\n')
    .map(part => part.trim())
    .find(part => part.length > 0)
  if (line === undefined) return undefined
  const plain = line
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/^["'`*\s]+|["'`*\s]+$/g, '')
    .toLowerCase()
    .trim()
  if (plain.length === 0) return undefined
  return plain.length > 48 ? `${plain.slice(0, 47).trimEnd()}.` : plain
}
