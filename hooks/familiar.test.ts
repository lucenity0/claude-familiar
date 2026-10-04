import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Mind, Profile } from '../types'
import { FRESH, HOLD_MS, SLEEP_AFTER_MS, cleanQuip, isTestCommand, levelFor, react } from './mood'
import { MARGIN_RIGHT, MARGIN_TOP, SPECIES, WIDTH, bandRows, checkSprite, compactCells, frame, fromGrid, fullCells, rasterCells, toGrid, unfold, usedRows } from './sprites'
import type { Pixel } from './sprites'

const BAND = {
  plugin: 'familiar',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const DRAW = {
  plugin: 'familiar',
  component: 'Pane',
  requestId: 'familiar-draw',
  props: { title: 'Draw', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const OWL: Profile = { name: 'hoot', species: 'owl', xp: 0, hatchedAt: '2026-10-04T00:00:00.000Z', custom: null }

const run = (args: string) => ({
  command: 'familiar',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: true, columns: 160 },
})

const turn = (durationMs: number, isAborted = false) => ({
  answer: '',
  durationMs,
  isAborted,
  reason: isAborted ? ('aborted' as const) : ('answer' as const),
  turnId: 't',
})

/** The engine beneath the mod: a mocked clock, a store the test can look into, and quiet UI. */
function world(on: On, entries: Record<string, unknown> = { profile: OWL }) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store: Record<string, unknown> = { ...entries }
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  return { clock, store }
}

// ---------- sprites ----------

const solid = (cells: { glyph: string; fg: string | null }[][]) => cells.flat().every(cell => cell.glyph === ' ' && cell.fg === null)
const marks = (pixels: Pixel[][]) =>
  pixels.flatMap((row, y) => row.flatMap((p, x) => (p.mark === undefined ? [] : [`${p.mark.glyph}@${x},${y}`])))
// Clawd's head (its top four rows) ends at column 13, so things beside it start at column 14, row 2.
const RIGHT = 14
const HEAD = MARGIN_TOP

test('full size draws each pixel as two solid cells, exactly as painted', () => {
  const sprite = { palette: { a: '#ff0000' }, rows: ['a...............', '.a..............', ...Array<string>(10).fill('.'.repeat(16))] }
  const cells = fullCells(frame(sprite, 'idle', 0, 1), MARGIN_TOP, MARGIN_TOP + 1)
  expect(cells[0]!.length).toBe((WIDTH + MARGIN_RIGHT) * 2)
  expect(cells[0]!.slice(0, 4).map(cell => cell.bg)).toEqual(['#ff0000', '#ff0000', null, null])
  expect(cells[1]!.slice(0, 4).map(cell => cell.bg)).toEqual([null, null, '#ff0000', '#ff0000'])
  expect(solid(cells)).toBe(true)
})

test('the band draws the rows a sprite uses plus room above, at either size', () => {
  expect(bandRows(SPECIES.clawd)).toEqual({ top: 0, bottom: 11 })
  const pixels = frame(SPECIES.clawd, 'idle', 0, 1)
  const full = fullCells(pixels, 0, 11)
  expect([full.length, full[0]!.length]).toEqual([12, 40])
  expect(solid(full)).toBe(true)
  const compact = compactCells(pixels, 0, 11)
  expect([compact.length, compact[0]!.length]).toEqual([6, 20])
  expect(solid(compact)).toBe(true)
  expect(atob(rasterCells(full)).length).toBe(12 * 40 * 12)
})

test('compact folds a one-pixel edge into a half block', () => {
  const sprite = { palette: { a: '#ff0000' }, rows: ['a...............', ...Array<string>(11).fill('.'.repeat(16))] }
  expect(compactCells(frame(sprite, 'idle', 0, 1), MARGIN_TOP, MARGIN_TOP)[0]![0]).toEqual({ glyph: '▀', fg: '#ff0000', bg: null })
})

test('every built-in sprite is a valid sprite', () => {
  for (const sprite of Object.values(SPECIES)) expect(checkSprite(sprite)).toEqual(sprite)
})

test('only a happy hop moves the body, two pixels up and back', () => {
  // The owl's head ends at column 14; a sweat drop or dots appear from column 15 on.
  const body = (pixels: Pixel[][]) => pixels.map(row => row.slice(0, 15).map(p => p.color !== null))
  const rest = body(frame(SPECIES.owl, 'idle', 0, 1))
  for (const mood of ['idle', 'working', 'worried', 'proud', 'sleepy'] as const) {
    for (const tick of [0, 1, 2, 3, 9]) expect(body(frame(SPECIES.owl, mood, tick, 1, tick))).toEqual(rest)
  }
  expect(body(frame(SPECIES.owl, 'happy', 0, 1, 0))).toEqual([...rest.slice(2), rest[0]!, rest[0]!])
  expect(body(frame(SPECIES.owl, 'happy', 1, 1, 1))).toEqual(rest)
  expect(body(frame(SPECIES.owl, 'happy', 5, 1, 5))).toEqual(rest)
})

test('working builds thinking dots beside the head', () => {
  expect(marks(frame(SPECIES.clawd, 'working', 0, 1))).toEqual([])
  expect(marks(frame(SPECIES.clawd, 'working', 2, 1))).toEqual([`.@${RIGHT},${HEAD}`])
  expect(marks(frame(SPECIES.clawd, 'working', 6, 1))).toEqual([`.@${RIGHT},${HEAD}`, `.@${RIGHT + 1},${HEAD}`, `.@${RIGHT + 2},${HEAD}`])
})

test('sleepy shuts the eyes as a flat line and lets z s drift up', () => {
  const pixels = frame(SPECIES.clawd, 'sleepy', 9, 1)
  const full = fullCells(pixels, 0, 11)
  expect(full[MARGIN_TOP + 3]!.filter(cell => cell.glyph === '━').length).toBe(4)
  expect(marks(pixels).filter(mark => /^[zZ]@/.test(mark))).toEqual([`Z@${RIGHT + 2},${HEAD - 2}`, `z@${RIGHT + 1},${HEAD - 1}`, `z@${RIGHT},${HEAD + 1}`])
  expect(compactCells(pixels, 0, 11)[(MARGIN_TOP + 2) / 2]!.filter(cell => cell.glyph === '━').length).toBe(2)
})

test('worried slides a sweat drop down beside the head', () => {
  for (const age of [0, 1, 2, 3]) expect(frame(SPECIES.clawd, 'worried', age, 1, age)[HEAD + age]![RIGHT]!.color).toBe('#7fc4f0')
})

test('proud flashes sparkles for a few seconds, and levels earn a lasting one', () => {
  expect(marks(frame(SPECIES.clawd, 'proud', 0, 1, 0)).some(mark => mark.startsWith('+'))).toBe(true)
  expect(marks(frame(SPECIES.clawd, 'proud', 9, 1, 9))).toEqual([])
  expect(frame(SPECIES.blob, 'idle', 0, 5)[usedRows(SPECIES.blob).top + MARGIN_TOP + 6]![WIDTH + MARGIN_RIGHT - 1]!.mark?.glyph).toBe('+')
  expect(marks(frame(SPECIES.blob, 'idle', 0, 4))).toEqual([])
})

test('checkSprite explains what does not fit', () => {
  expect(checkSprite({ palette: {}, rows: [] })).toBe('rows must be 12 strings')
  const rows = [...SPECIES.blob.rows]
  rows[3] = 'zzzzzzzzzzzzzzzz'
  expect(checkSprite({ palette: SPECIES.blob.palette, rows })).toBe('row 4 uses "z", which is not in the palette')
  expect(checkSprite({ palette: { a: 'red' }, rows: SPECIES.blob.rows })).toBe('palette color for "a" must look like #a1b2c3')
})

test('a drawn grid turns back into the same sprite, and six-row sprites stretch to twelve', () => {
  const sprite = fromGrid(toGrid(SPECIES.owl), '#2b2b2b')
  expect(toGrid(sprite)).toEqual(toGrid(SPECIES.owl))
  expect(sprite.palette.e).toBe('#2b2b2b')
  const short = { palette: { a: '#ff0000' }, rows: ['a...............', ...Array<string>(5).fill('.'.repeat(16))] }
  const tall = unfold(short)
  expect(tall.rows.slice(0, 3)).toEqual(['a...............', 'a...............', '.'.repeat(16)])
  expect(typeof checkSprite(tall)).toBe('object')
})

// ---------- mood ----------

test('failing tests worry it, passing them again cheers it up', () => {
  let mind: Mind = FRESH
  mind = react(mind, { kind: 'turn-start' }, 0, 'owl').mind
  mind = react(mind, { kind: 'tool', command: 'npm test', isError: true }, 1, 'owl').mind
  expect(mind.view).toMatchObject({ mood: 'worried', line: 'tests failing.' })

  const passed = react(mind, { kind: 'tool', command: 'npm test', isError: false }, 2, 'owl')
  expect(passed.mind.view).toMatchObject({ mood: 'happy', line: 'tests green. nice.' })
  expect(passed.xp).toBe(5)
})

test('error streaks escalate and seatbelt makes it flinch', () => {
  let mind: Mind = FRESH
  for (const line of ['hm.', "that's two fails.", 'rough patch.']) {
    mind = react(mind, { kind: 'tool', isError: true }, 0, 'blob').mind
    expect(mind.view.line).toBe(line)
  }
  const flinch = react(FRESH, { kind: 'tool', isError: true, deny: 'seatbelt: blocked `rm -rf /`' }, 10, 'blob').mind
  expect(flinch.view).toMatchObject({ mood: 'flinch', line: 'close one.', holdUntil: 10 + HOLD_MS })
  expect(react(flinch, { kind: 'tick' }, 10 + HOLD_MS, 'blob').mind.view.mood).toBe('idle')
})

test('long turns, low limits and long quiet each have a mood', () => {
  const long = react(FRESH, { kind: 'turn-complete', durationMs: 134_000, isAborted: false }, 0, 'sprout')
  expect(long.mind.view).toMatchObject({ mood: 'proud', line: '2m14s. long one.' })
  expect(long.xp).toBe(1)

  const low = react(FRESH, { kind: 'limits', percentUsed: 93, resetsAt: '2026-10-04T16:10:00' }, 0, 'sprout').mind
  expect(low.view).toMatchObject({ mood: 'sleepy', line: 'low on juice. resets 16:10.' })

  const quiet = react({ ...FRESH, lastActiveAt: 1 }, { kind: 'tick' }, 1 + SLEEP_AFTER_MS, 'sprout').mind
  expect(quiet.view).toMatchObject({ mood: 'sleepy', line: 'zz.' })
})

test('levels, test commands and quips', () => {
  expect([0, 5, 80, 405].map(levelFor)).toEqual([1, 2, 5, 10])
  expect(isTestCommand('pnpm run test -- --watch=false')).toBe(true)
  expect(isTestCommand('cargo build')).toBe(false)
  expect(cleanQuip('"Nice Refactor! 🎉"\nmore')).toBe('nice refactor!')
  expect(cleanQuip('   ')).toBeUndefined()
})

// ---------- the mod in the engine ----------

test('it hatches once and remembers itself', async ($, on) => {
  const { store } = world(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const stored = store.profile as Profile
  expect(stored).toMatchObject({ species: 'clawd', name: 'clawd' })
  expect(stored.xp).toBe(0)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((store.profile as Profile).hatchedAt).toBe(stored.hatchedAt)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'sprite' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `hatched. i'm ${stored.name}.` })).toBeDefined()
  await ui.unmount()
})

test('it comes back from the store if its state is wiped mid-session', async ($, on) => {
  world(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: '' }))
  expect((await $.command.run(run('rename Pip'))).text).toBe('hoot is now Pip.')
})

test('the band reacts on every surface and folds up when narrow', async ($, on) => {
  world(on)
  on('tool.call', () => ({ deny: 'seatbelt: blocked `rm -rf ~`' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: 'close one.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'hoot · flinch · lvl 1' })).toBeDefined()
    await ui.unmount()
  }

  const narrow = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 30 } })
  expect(await narrow.find({ type: 'Text', text: /\(>\.<\) hoot\s+close one\./ })).toBeDefined()
  await narrow.unmount()
})

test('/familiar renames, hides, imports and exports', async ($, on) => {
  const { store } = world(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: '' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(run('rename Pip'))).text).toBe('hoot is now Pip.')
  expect((store.profile as Profile).name).toBe('Pip')

  expect((await $.command.run(run(''))).text).toContain('hidden')
  const hidden = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await hidden.find({ type: 'Raster' })).toBeUndefined()
  await hidden.unmount()
  await $.command.run(run(''))

  const blob = JSON.stringify(SPECIES.blob)
  expect((await $.command.run(run(`import ${blob}`))).text).toContain('wears the imported sprite')
  expect((await $.command.run(run('export'))).text).toBe(blob)
  expect((await $.command.run(run('import {"rows":[]}'))).text).toBe('That sprite does not fit: palette is missing.')
  expect((await $.command.run(run('species dragon'))).text).toContain('Pick one of: clawd, cat, calico, sprout, owl, blob, custom.')
})

test('quips stay off unless asked for, and then wait their turn', async ($, on) => {
  const { clock } = world(on)
  const asked: string[] = []
  on('model.complete', (_, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: 'Busy one.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(10_000))
  await clock.settle()
  expect(asked).toEqual([])
})

test('with quips on it speaks at most once per window', { options: { quips: true, quipMinutes: 5 } }, async ($, on) => {
  const { clock } = world(on)
  const asked: string[] = []
  on('model.complete', (_, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: 'Busy one.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(10_000))
  await clock.settle()
  await $.turn.complete(turn(10_000))
  await clock.settle()
  expect(asked.length).toBe(1)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'busy one.' })).toBeDefined()
  await ui.unmount()

  await clock.advance(5 * 60_000)
  await $.turn.complete(turn(10_000))
  await clock.settle()
  expect(asked.length).toBe(2)
})

test('every built-in sprite passes the same checks an import does', () => {
  for (const sprite of Object.values(SPECIES)) expect(checkSprite(sprite)).toEqual(sprite)
})

test('/familiar species alone opens the lineup, and a press switches the look', async ($, on) => {
  const { store } = world(on)
  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(run('species'))).text).toContain('Press a number')
  expect(opened).toEqual(['familiar-pick'])

  const ui = await $.ui.mount({ ...DRAW, requestId: 'familiar-pick', surface: 'terminal' })
  // A short pane gets half-size looks; a tall one gets full-size squares.
  expect((await ui.findAll({ type: 'Raster' })).length).toBe(6)
  expect((await ui.find({ type: 'Raster', key: 'look-cat' }))?.props.columns).toBe(16)
  await ui.unmount()

  const tall = await $.ui.mount({ ...DRAW, requestId: 'familiar-pick', surface: 'terminal', props: { ...DRAW.props, scroll: { offset: 0, bodyRows: 60 } } })
  expect((await tall.find({ type: 'Raster', key: 'look-cat' }))?.props.columns).toBe(32)
  await tall.press({ key: 'pick-cat' })
  await tall.unmount()

  expect((store.profile as Profile).species).toBe('cat')
  expect(closed).toEqual(['familiar-pick'])
})

test('/familiar draw paints a sprite and saves it', async ($, on) => {
  const { store } = world(on)
  const closed: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(run('draw'))).text).toContain('Paint in the pane')

  const ui = await $.ui.mount({ ...DRAW, surface: 'terminal' })
  await ui.press({ key: 'clear' })
  // Pick color 3 by clicking its swatch, which sits on the first row.
  await ui.pointer({ type: 'down', x: 6, y: 0, button: 'left' })
  await ui.pointer({ type: 'down', x: 0, y: 2, button: 'left' })
  await ui.pointer({ type: 'move', x: 2, y: 2, button: 'left' })
  // One row down is the next pixel down.
  await ui.pointer({ type: 'move', x: 3, y: 3, button: 'left' })
  await ui.pointer({ type: 'up', x: 3, y: 3, button: 'left' })
  await ui.key({ key: 'down', in: 'editor' })
  await ui.key({ key: 'x', in: 'editor' })
  await ui.press({ key: 'save' })
  await ui.unmount()

  const saved = store.profile as Profile
  expect(saved.species).toBe('custom')
  expect(saved.custom?.rows.slice(0, 2)).toEqual(['aa..............', '.a..............'])
  expect(saved.custom?.rows.slice(2).every(row => row === '.'.repeat(WIDTH))).toBe(true)
  expect(closed).toEqual(['familiar-draw'])
})

test('the draw pane folds its help under the grid when narrow and asks for room when too narrow', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...DRAW, surface: 'terminal' })
  await ui.resize({ columns: 80, rows: 30 })
  expect(await ui.find({ type: 'Text', text: 'arrows + space, x erases', in: 'editor' })).toBeDefined()

  await ui.resize({ columns: 40, rows: 30 })
  expect(await ui.find({ type: 'Text', text: 'arrows + space, x erases', in: 'editor' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /drag to paint, right-click erases/, in: 'editor' })).toBeDefined()

  await ui.resize({ columns: 20, rows: 30 })
  expect(await ui.find({ type: 'Text', text: /Widen this pane/, in: 'editor' })).toBeDefined()
  await ui.unmount()
})

const CLAWD = { profile: { ...OWL, species: 'clawd' } }

async function rasterSize($: Parameters<TestBody>[0], props: { isWorking?: boolean; maxRows?: number } = {}, rows = 47) {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, ...props }, viewport: { columns: 150, rows } })
  const raster = await ui.find({ type: 'Raster', key: 'sprite' })
  await ui.unmount()
  return raster === undefined ? undefined : [raster.props.columns, raster.props.rows]
}

test('auto size: full while you read, half size while Claude works or the window is short', async ($, on) => {
  world(on, CLAWD)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(await rasterSize($)).toEqual([40, 12])
  expect(await rasterSize($, { isWorking: true })).toEqual([20, 6])
  expect(await rasterSize($, {}, 24)).toEqual([20, 6])
  expect(await rasterSize($, { maxRows: 8 })).toEqual([20, 6])
  expect(await rasterSize($, { maxRows: 4 })).toBeUndefined()
})

for (const [size, columns, rows] of [['full', 40, 12], ['compact', 20, 6]] as const) {
  test(`size ${size} holds while Claude works`, { options: { size } }, async ($, on) => {
    world(on, CLAWD)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(await rasterSize($, { isWorking: true })).toEqual([columns, rows])
  })
}
