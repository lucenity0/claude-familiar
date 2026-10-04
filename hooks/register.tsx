import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { Mood, Profile, Species, Sprite } from '../types'
import { FRESH, HOLD_MS, cleanQuip, formatDuration, levelFor, react } from './mood'
import type { Signal } from './mood'
import { MARGIN_TOP, SPECIES, WIDTH, bandRows, checkSprite, compactCells, frame, fromGrid, fullCells, rasterCells, toGrid, unfold, usedRows } from './sprites'
import type { Cell, Grid, SpriteSize } from './sprites'

const mind = atom({ plugin: 'familiar', key: 'mind' } as const, FRESH)
const tick = atom({ plugin: 'familiar', key: 'tick' } as const, 0)
const isHidden = atom({ plugin: 'familiar', key: 'isHidden' } as const, false)
const profile = atom({ plugin: 'familiar', key: 'profile' } as const, null)

const DRAW_PANE = 'familiar-draw'
const PICK_PANE = 'familiar-pick'
const FRAME_MS = 500
/** How long the z's drift once it falls asleep. */
const DRIFT_MS = 2 * 60_000
/** Below this many terminal rows, the band stays half size. */
const TALL_ROWS = 30
const BUILT_IN: Exclude<Species, 'custom'>[] = ['clawd', 'cat', 'calico', 'sprout', 'owl', 'blob']
const NAMES: Record<Exclude<Species, 'custom'>, string[]> = {
  clawd: ['clawd'],
  cat: ['tofu', 'miso', 'pixel'],
  calico: ['patches', 'maple', 'pip'],
  sprout: ['fern', 'basil', 'moss'],
  owl: ['hoot', 'sage', 'ink'],
  blob: ['mochi', 'gloop', 'bean'],
}
const EXTRA_SWATCHES = ['#2b2b2b', '#f3ead8', '#d97757', '#f2c46d', '#8fc46a', '#6aa5c4', '#9b8cf2', '#f0a0c0', '#8b6a4e']
const FACES: Record<Mood, string> = {
  idle: '(o.o)',
  working: '(o.o)~',
  happy: '(^.^)',
  worried: '(o.o;)',
  flinch: '(>.<)',
  proud: '(^-^)',
  sleepy: '(-.-)',
}
const USAGE = [
  '/familiar                 show or hide it',
  '/familiar pet             say hi',
  '/familiar rename <name>   give it a new name',
  '/familiar species         pick a look from the lineup',
  '/familiar species <name>  clawd, cat, calico, sprout, owl, blob or custom',
  '/familiar draw            paint your own in a pane',
  '/familiar export          print the sprite as JSON',
  '/familiar import <json>   load a sprite someone shared',
  '/familiar ask [question]  ask its opinion (uses tokens)',
].join('\n')

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!

function spriteOf(p: Profile): Sprite {
  if (p.species === 'custom' && p.custom !== null) return p.custom
  return SPECIES[p.species === 'custom' ? 'clawd' : p.species] ?? SPECIES.clawd
}

function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<Profile>
  return typeof p.name === 'string' && typeof p.species === 'string' && typeof p.xp === 'number' && typeof p.hatchedAt === 'string'
}

function swatchesFor(sprite: Sprite): string[] {
  const own = [...new Set(Object.values(sprite.palette))]
  return [...new Set([...own, ...EXTRA_SWATCHES])].slice(0, 9)
}

/** What the module keeps between hooks; it starts over on a reload, which is fine for all of it. */
const runtime = {
  ticker: undefined as { cancel: () => void } | undefined,
  lastQuipAt: 0,
  turnTools: 0,
  turnErrors: 0,
  petCount: 0,
}

/** A sprite at rest, trimmed to the rows it uses: how the lineup shows each look. */
function preview(sprite: Sprite, size: SpriteSize): Cell[][] {
  const { top, bottom } = usedRows(sprite)
  const pixels = frame(sprite, 'idle', 0, 1)
  return size === 'full'
    ? fullCells(pixels, top + MARGIN_TOP, bottom + MARGIN_TOP).map(row => row.slice(0, WIDTH * 2))
    : compactCells(pixels, top + MARGIN_TOP, bottom + MARGIN_TOP).map(row => row.slice(0, WIDTH))
}

/** Cells drawn as a Raster on the terminal, and as colored text everywhere else. */
function picture($: EngineInterface, e: ResolveInput, key: string, cells: Cell[][]) {
  if (e.surface === 'terminal') {
    const { Raster } = $.ui.resolve(e)
    return <Raster key={key} columns={cells[0]?.length ?? 0} rows={cells.length} cells={rasterCells(cells)} />
  }
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box key={key} flexDirection="column">
      {cells.map(row => (
        <Text>
          {row.map(cell =>
            cell.bg === null ? (
              <Text {...(cell.fg === null ? {} : { color: cell.fg })}>{cell.glyph}</Text>
            ) : (
              <Text color={cell.fg ?? '#000000'} backgroundColor={cell.bg}>
                {cell.glyph}
              </Text>
            ),
          )}
        </Text>
      ))}
    </Box>
  )
}

async function saveProfile($: EngineInterface, fn: (p: Profile) => Profile): Promise<Profile | null> {
  let saved: Profile | null = null
  await update($, profile, p => {
    saved = p === null ? null : fn(p)
    return saved
  })
  if (saved !== null) await $.store.set('profile', saved)
  return saved
}

async function say($: EngineInterface, mood: Mood, line: string) {
  const now = await $.clock.now()
  await update($, mind, m => ({ ...m, lastActiveAt: now, view: { mood, line, holdUntil: now + HOLD_MS, since: now } }))
  wake($)
}

async function feel($: EngineInterface, signal: Signal) {
  const now = await $.clock.now()
  const p = await read($, profile)
  let xp = 0
  await update($, mind, m => {
    const next = react(m, signal, now, p?.species ?? 'blob', runtime.petCount)
    xp = next.xp
    return next.mind
  })
  if (xp > 0 && p !== null) {
    const before = levelFor(p.xp)
    const after = await saveProfile($, current => ({ ...current, xp: current.xp + xp }))
    if (after !== null && levelFor(after.xp) > before) await say($, 'happy', `grew to lvl ${levelFor(after.xp)}.`)
  }
  if (signal.kind !== 'tick') wake($)
}

/** Starts the frame clock if it is stopped; it stops itself once the familiar is asleep or hidden. */
function wake($: EngineInterface) {
  if (runtime.ticker !== undefined) return
  runtime.ticker = $.clock.every(FRAME_MS, () => {
    void advance($)
  })
}

async function advance($: EngineInterface) {
  if (await read($, isHidden)) return sleep()
  await update($, tick, n => (n + 1) % 1_000_000)
  await feel($, { kind: 'tick' })
  // Asleep, it lets the z's drift for a couple of minutes, then stops the clock until something wakes it.
  const { view, isWorking } = await read($, mind)
  if (view.mood === 'sleepy' && !isWorking && (await $.clock.now()) - view.since > DRIFT_MS) sleep()
}

function sleep() {
  runtime.ticker?.cancel()
  runtime.ticker = undefined
}

async function quip($: EngineInterface, p: Profile, durationMs: number) {
  const reply = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 40,
    timeoutMs: 8_000,
    system: `You are ${p.name}, a tiny pixel-art ${p.species === 'custom' ? 'creature' : p.species} who sits above a developer's terminal prompt while Claude works. Reply with one reaction of at most eight words: lowercase, dry and warm, no emojis, no quotes.`,
    prompt: `The turn just ended. It took ${formatDuration(durationMs)}, ran ${runtime.turnTools} tools, and ${runtime.turnErrors} of them failed.`,
  })
  const line = reply.isAnswered ? cleanQuip(reply.text) : undefined
  if (line !== undefined) await update($, mind, m => ({ ...m, view: { ...m.view, line } }))
}

export const register: Register = (on, options) => {
  const hasQuips = options.quips === true
  const quipEveryMs = Math.max(1, Number(options.quipMinutes ?? 10)) * 60_000
  const size: SpriteSize | 'auto' = options.size === 'compact' || options.size === 'full' ? options.size : 'auto'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'familiar', description: 'Your pixel companion: pet, rename, draw, import, ask' })

    const stored = await $.store.get('profile')
    let p: Profile
    if (isProfile(stored)) {
      const custom = stored.custom ? checkSprite(unfold(stored.custom)) : null
      p = { ...stored, custom: typeof custom === 'string' ? null : custom }
      if (p.species === 'custom' && p.custom === null) p = { ...p, species: 'clawd' }
      if (JSON.stringify(p) !== JSON.stringify(stored)) await $.store.set('profile', p)
    } else {
      const species = 'clawd'
      p = { name: pick(NAMES[species]), species, xp: 0, hatchedAt: new Date(await $.clock.now()).toISOString(), custom: null }
      await $.store.set('profile', p)
    }
    await update($, profile, () => p)
    if ((await read($, mind)).lastActiveAt === 0) {
      const now = await $.clock.now()
      const greeting = isProfile(stored) ? 'hi again.' : `hatched. i'm ${p.name}.`
      await update($, mind, m => ({ ...m, lastActiveAt: now, view: { mood: 'happy' as const, line: greeting, holdUntil: now + 6_000, since: now } }))
    }
    wake($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    runtime.turnTools = 0
    runtime.turnErrors = 0
    await feel($, { kind: 'turn-start' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    runtime.turnTools += 1
    if (ran.isError === true || ran.deny !== undefined) runtime.turnErrors += 1
    await feel($, {
      kind: 'tool',
      isError: ran.isError === true,
      ...(e.tool === 'Bash' ? { command: e.command } : {}),
      ...(ran.deny === undefined ? {} : { deny: ran.deny }),
    })
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await feel($, { kind: 'turn-complete', durationMs: e.durationMs, isAborted: e.isAborted })
      const now = await $.clock.now()
      const p = await read($, profile)
      if (hasQuips && p !== null && !e.isAborted && now - runtime.lastQuipAt >= quipEveryMs) {
        runtime.lastQuipAt = now
        void quip($, p, e.durationMs).catch(() => undefined)
      }
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      const fullest = e.rateLimits.reduce((a, b) => (b.percentUsed > a.percentUsed ? b : a))
      await feel($, {
        kind: 'limits',
        percentUsed: fullest.percentUsed,
        ...(fullest.resetsAt === undefined ? {} : { resetsAt: fullest.resetsAt }),
      })
    }
    return next(e)
  })

  on('command.run', { command: 'familiar' }, async ($, e) => {
    const args = e.args.trim()
    const sub = args.split(/\s+/)[0] ?? ''
    const rest = args.slice(sub.length).trim()
    const p = await read($, profile)
    if (p === null) return { text: 'Your familiar has not hatched yet. Try again in a moment.' }

    if (sub === '') {
      const hidden = await read($, isHidden)
      await update($, isHidden, () => !hidden)
      if (hidden) wake($)
      return { text: hidden ? `${p.name} is back.` : `${p.name} is hidden. /familiar brings it back.` }
    }

    if (sub === 'pet') {
      runtime.petCount += 1
      await feel($, { kind: 'pet' })
      return { text: `You pet ${p.name}.` }
    }

    if (sub === 'rename') {
      const name = rest.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 16)
      if (name === '') return { text: 'Usage: /familiar rename <name>' }
      await saveProfile($, current => ({ ...current, name }))
      await say($, 'happy', `${name}. i like it.`)
      return { text: `${p.name} is now ${name}.` }
    }

    if (sub === 'species' && rest === '') {
      await $.ui.open({ id: PICK_PANE, title: `Pick a look for ${p.name}`, focus: true, closeOnEscape: true })
      return { text: 'Press a number or click a look. Esc closes the lineup.' }
    }

    if (sub === 'species') {
      const species = rest as Species
      if (species === 'custom' && p.custom === null) return { text: 'No custom sprite yet. Make one with /familiar draw or /familiar import.' }
      if (![...BUILT_IN, 'custom'].includes(species)) return { text: 'Pick one of: clawd, cat, calico, sprout, owl, blob, custom. Or /familiar species alone for the lineup.' }
      await saveProfile($, current => ({ ...current, species }))
      await say($, 'happy', 'how do i look?')
      return { text: `${p.name} is a ${species} now.` }
    }

    if (sub === 'draw') {
      await $.ui.open({ id: DRAW_PANE, title: `Draw ${p.name}` })
      return { text: `Drawing ${p.name}. Paint in the pane, then press Save.` }
    }

    if (sub === 'export') {
      return { text: JSON.stringify(spriteOf(p)) }
    }

    if (sub === 'import') {
      let parsed: unknown
      try {
        parsed = JSON.parse(rest)
      } catch {
        return { text: 'That is not JSON. Paste the sprite exactly as /familiar export or the lookbook printed it.' }
      }
      const sprite = checkSprite(parsed)
      if (typeof sprite === 'string') return { text: `That sprite does not fit: ${sprite}.` }
      await saveProfile($, current => ({ ...current, species: 'custom', custom: sprite }))
      await say($, 'happy', 'new look.')
      return { text: `${p.name} wears the imported sprite now. /familiar species to switch back.` }
    }

    if (sub === 'ask') {
      const question = rest === '' ? 'What do you make of what just happened in this session?' : rest
      const reply = await $.model.fork({
        prompt: `This aside is not from the user. It is from ${p.name}, the user's tiny pixel-art familiar that sits above the prompt. Answer as ${p.name}, in one or two short lowercase sentences, dry and warm, no emojis, no tools: ${question}`,
      })
      if (!reply.isAnswered) return { text: `${p.name} has nothing to say right now (${reply.reason}).` }
      const line = cleanQuip(reply.text)
      if (line !== undefined) await say($, 'happy', line)
      return { text: `${p.name}: ${reply.text.trim()}` }
    }

    return { text: USAGE }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, profile)
    if (p === null || e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const { view } = await read($, mind)
    const level = levelFor(p.xp)
    const footer = `${p.name} · ${view.mood} · lvl ${level}`
    const { Box, Text } = $.ui.resolve(e)

    const sprite = spriteOf(p)
    const { top, bottom } = bandRows(sprite)
    const age = Math.max(0, Math.floor(((await $.clock.now()) - view.since) / FRAME_MS))
    const pixels = frame(sprite, view.mood, await read($, tick), level, age)
    // Full size while you read or type; half size while Claude's output streams or the window is short.
    const isRoomy = !e.props.isWorking && (e.viewport?.rows ?? TALL_ROWS) >= TALL_ROWS
    const wanted: SpriteSize = size === 'auto' ? (isRoomy ? 'full' : 'compact') : size
    const fits = (cells: Cell[][]) => e.props.bodyColumns >= (cells[0]?.length ?? 0) + 24 && e.props.maxRows >= cells.length + 1
    const full = wanted === 'full' ? fullCells(pixels, top, bottom) : null
    const cells = full !== null && fits(full) ? full : compactCells(pixels, top, bottom)
    if (!fits(cells)) {
      return (
        <Box marginTop={1} paddingLeft={1}>
          <Text>
            {FACES[view.mood]} <Text dimColor>{p.name}</Text>
            {view.line === '' ? '' : `  ${view.line}`}
          </Text>
        </Box>
      )
    }

    const words = (
      <Box flexDirection="column" justifyContent="center">
        <Text>{view.line === '' ? ' ' : view.line}</Text>
        <Text dimColor>{footer}</Text>
      </Box>
    )

    return (
      <Box flexDirection="row" columnGap={2} paddingLeft={1} marginTop={1}>
        {picture($, e, 'sprite', cells)}
        {words}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PICK_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const p = await read($, profile)
    if (p === null) return <Text dimColor>No familiar yet.</Text>

    const looks: { species: Species; sprite: Sprite }[] = [
      ...BUILT_IN.map(species => ({ species, sprite: SPECIES[species] })),
      ...(p.custom === null ? [] : [{ species: 'custom' as const, sprite: p.custom }]),
    ]
    // Full size has no seams in any terminal; the lineup drops to half size only when it would not fit.
    const perRow = Math.max(1, Math.floor((e.props.bodyColumns + 3) / (WIDTH * 2 + 3)))
    const tallest = Math.max(...looks.map(look => usedRows(look.sprite).bottom - usedRows(look.sprite).top + 1))
    const needed = Math.ceil(looks.length / perRow) * (tallest + 3) + 1
    const size: SpriteSize = needed <= e.props.scroll.bodyRows ? 'full' : 'compact'
    const choose = async (species: Species) => {
      await saveProfile($, current => ({ ...current, species }))
      await $.ui.close({ id: PICK_PANE })
      await say($, 'happy', 'how do i look?')
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={1}>
          {looks.map(({ species, sprite }, i) => (
            <Box key={species} flexDirection="column" alignItems="center" rowGap={1}>
              {picture($, e, `look-${species}`, preview(sprite, size))}
              <Button
                key={`pick-${species}`}
                label={species}
                hotkey={String(i + 1)}
                {...(species === p.species ? { variant: 'primary' as const } : { dimColor: true })}
                onPress={() => choose(species)}
              />
            </Box>
          ))}
        </Box>
        <Text dimColor>
          {p.custom === null ? 'draw your own with /familiar draw. ' : ''}esc closes
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: DRAW_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const p = await read($, profile)
    if (p === null) return <Text dimColor>No familiar yet.</Text>
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return <Text dimColor>Drawing needs the terminal or the desktop app.</Text>

    const { Client } = $.ui.resolve(e)
    const sprite = spriteOf(p)
    return (
      <Box flexDirection="column">
        <Client key="editor" module="./draw.tsx" width="100%" props={{ grid: toGrid(sprite), swatches: swatchesFor(sprite) }} />
      </Box>
    )
  })

  on('ui.message', { element: 'editor' }, async ($, e) => {
    const data = e.data as { type?: string; grid?: Grid }
    if (data.type === 'cancel') {
      await $.ui.close({ id: DRAW_PANE })
      return {}
    }
    if (data.type !== 'save' || !Array.isArray(data.grid)) return {}

    const p = await read($, profile)
    const eye = p === null ? null : spriteOf(p).palette.e ?? null
    const sprite = checkSprite(fromGrid(data.grid, eye))
    if (typeof sprite === 'string') {
      $.ui.toast(`Could not save: ${sprite}`)
      return {}
    }
    await saveProfile($, current => ({ ...current, species: 'custom', custom: sprite }))
    await $.ui.close({ id: DRAW_PANE })
    await say($, 'happy', 'new look. thanks.')
    $.ui.toast('Saved. /familiar export prints it to share.')
    return {}
  })
}
