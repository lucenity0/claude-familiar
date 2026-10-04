// Renders assets/demo.svg: a made-up session, the familiar drawn with the mod's own frame code at half size.
// Run: node --experimental-strip-types assets/demo.mts
import { SPECIES, bandRows, compactCells, frame } from '../hooks/sprites.ts'
import { writeFileSync } from 'node:fs'

type Mood = 'idle' | 'working' | 'happy' | 'worried' | 'flinch' | 'proud' | 'sleepy'

const NAME = 'tofu'
const LEVEL = 3
const FRAME_S = 0.5
const sprite = SPECIES.cat

const bash = (dot: string) => `<tspan class="${dot}">●</tspan> <tspan class="b">Bash</tspan>(npm test)`
const tool = (name: string, arg: string) => `<tspan class="grn">●</tspan> <tspan class="b">${name}</tspan>(${arg})`
const said = (text: string) => `● ${text}`
const result = (text: string, cls = 'dim') => `<tspan class="${cls}">  ⎿  ${text}</tspan>`

/** What happens, in frames of half a second: transcript lines, the familiar's mood, and the turn ending. */
const LINES: { at: number; text: string; replaces?: true }[] = [
  { at: 0, text: '<tspan class="acc">&gt;</tspan> the date test fails on CI but passes locally. can you fix it?' },
  { at: 2, text: said("I'll run the tests to see the failure.") },
  { at: 3, text: bash('grn') },
  { at: 3, text: result('running…') },
  { at: 7, text: result('FAIL src/date.test.ts · 1 failed, 23 passed', 'red'), replaces: true },
  { at: 9, text: tool('Read', 'src/date.ts') },
  { at: 9, text: result('Read 48 lines') },
  { at: 11, text: tool('Read', 'src/date.test.ts') },
  { at: 11, text: result('Read 31 lines') },
  { at: 13, text: said('The test builds dates in local time, but CI runs in UTC.') },
  { at: 15, text: tool('Update', 'src/date.test.ts') },
  { at: 15, text: result('Updated with 2 additions and 1 removal') },
  { at: 17, text: bash('grn') },
  { at: 17, text: result('running…') },
  { at: 20, text: result('24 passed'), replaces: true },
  { at: 22, text: said('Fixed: the test now pins TZ=UTC, so it passes on any machine.') },
]
const MOODS: { at: number; mood: Mood; say: string }[] = [
  { at: 0, mood: 'working', say: 'on it.' },
  { at: 7, mood: 'worried', say: 'hm.' },
  { at: 15, mood: 'working', say: 'on it.' },
  { at: 20, mood: 'happy', say: 'tests green. nice.' },
  { at: 23, mood: 'proud', say: '2m14s. long one.' },
  { at: 33, mood: 'sleepy', say: 'zz.' },
]
const DONE_AT = 23
const TURN_SECONDS = 134
const TICKS = 48
const TOTAL = TICKS * FRAME_S

const CELL_W = 7
const CELL_H = 14
const WIDTH = 640
const LINE_H = 21
const VISIBLE = 8
const TRANSCRIPT_Y = 62
const { top, bottom } = bandRows(sprite)
const BAND_X = 24
const BAND_Y = TRANSCRIPT_Y + VISIBLE * LINE_H + 8
const BAND_ROWS = compactCells(frame(sprite, 'idle', 0, LEVEL), top, bottom).length
const WORDS_X = BAND_X + 20 * CELL_W + 14
const PROMPT_Y = BAND_Y + BAND_ROWS * CELL_H + 12
const STATUS_Y = PROMPT_Y + 58
const HEIGHT = STATUS_Y + 16

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const clock = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`)

const rules: string[] = []
/** A group shown from frame `from` up to frame `to` of every loop. */
function timed(body: string, from: number, to: number): string {
  const id = `k${rules.length}`
  rules.push(`@keyframes ${id} { 0% { opacity: 1 } ${(((to - from) / TICKS) * 100).toFixed(3)}% { opacity: 0 } 100% { opacity: 0 } }`)
  const delay = -((TICKS - from) % TICKS) * FRAME_S
  return `<g style="opacity:0;animation:${id} ${TOTAL}s step-end ${delay.toFixed(2)}s infinite">${body}</g>`
}

/** Draws what each tick shows, merging runs of identical ticks into one group. */
function track(draw: (tick: number) => string): string {
  const out: string[] = []
  let from = 0
  let last = draw(0)
  for (let tick = 1; tick <= TICKS; tick++) {
    const now = tick < TICKS ? draw(tick) : ''
    if (now !== last || tick === TICKS) {
      if (last !== '') out.push(timed(last, from, tick))
      from = tick
      last = now
    }
  }
  return out.join('\n')
}

function transcript(tick: number): string {
  const lines: string[] = []
  for (const line of LINES) {
    if (line.at > tick) break
    if (line.replaces) lines.pop()
    lines.push(line.text)
  }
  return lines
    .slice(-VISIBLE)
    .map((text, i) => `<text x="20" y="${TRANSCRIPT_Y + i * LINE_H}">${text}</text>`)
    .join('')
}

function moodAt(tick: number) {
  return [...MOODS].reverse().find(m => m.at <= tick)!
}

function sprite_(tick: number): string {
  const m = moodAt(tick)
  const cells = compactCells(frame(sprite, m.mood, tick, LEVEL, tick - m.at), top, bottom)
  const out: string[] = []
  const rect = (x: number, y: number, h: number, fill: string) =>
    out.push(`<rect x="${BAND_X + x * CELL_W}" y="${BAND_Y + y}" width="${CELL_W}" height="${h}" fill="${fill}"/>`)
  cells.forEach((row, y) =>
    row.forEach((cell, x) => {
      const py = y * CELL_H
      if (cell.bg !== null) rect(x, py, CELL_H, cell.bg)
      if (cell.fg === null || cell.glyph === ' ') return
      if (cell.glyph === '▀') rect(x, py, CELL_H / 2, cell.fg)
      else if (cell.glyph === '▄') rect(x, py + CELL_H / 2, CELL_H / 2, cell.fg)
      else if (cell.glyph === '━') rect(x, py + CELL_H / 2 - 1, 2, cell.fg)
      else out.push(`<text x="${BAND_X + x * CELL_W + CELL_W / 2}" y="${BAND_Y + py + CELL_H - 3}" text-anchor="middle" fill="${cell.fg}" class="glyph">${esc(cell.glyph)}</text>`)
    }),
  )
  return out.join('')
}

function words(tick: number): string {
  const m = moodAt(tick)
  const middle = BAND_Y + (BAND_ROWS * CELL_H) / 2
  return `<text x="${WORDS_X}" y="${middle - 3}">${esc(m.say)}</text><text x="${WORDS_X}" y="${middle + 15}" class="dim">${NAME} · ${m.mood} · lvl ${LEVEL}</text>`
}

function status(tick: number): string {
  if (tick >= DONE_AT) return `<text x="20" y="${STATUS_Y}" class="dim">✓ ${clock(TURN_SECONDS)} · 18.2k in · 2.1k out</text>`
  return `<text x="20" y="${STATUS_Y}" class="dim">running ${clock(Math.round((tick / DONE_AT) * TURN_SECONDS))}</text>`
}

const body = [track(transcript), `<g shape-rendering="crispEdges">\n${track(sprite_)}\n</g>`, track(words), track(status)].join('\n')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="A familiar above the Claude Code prompt reacting to a session: thinking dots while Claude works, a sweat drop when a test fails, a hop when it passes, sparkles after a long turn, and z's when it dozes off">
<style>
text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; fill: #e6e6e6; white-space: pre; }
.glyph { font-size: 11px; font-weight: 700; }
.dim { fill: #8b8b8b; } .acc { fill: #d97757; } .red { fill: #e5534b; } .grn { fill: #57ab5a; } .b { font-weight: 700; }
.title { font-size: 11px; fill: #9a9a9a; }
${rules.join('\n')}
</style>
<rect width="${WIDTH}" height="${HEIGHT}" rx="10" fill="#1b1b1d"/>
<rect width="${WIDTH}" height="32" rx="10" fill="#262628"/><rect y="22" width="${WIDTH}" height="10" fill="#262628"/>
<circle cx="20" cy="16" r="5.5" fill="#ff5f57"/><circle cx="38" cy="16" r="5.5" fill="#febc2e"/><circle cx="56" cy="16" r="5.5" fill="#28c840"/>
<text x="${WIDTH / 2}" y="20" text-anchor="middle" class="title">claude — ~/demo</text>
${body}
<rect x="12.5" y="${PROMPT_Y + 0.5}" width="${WIDTH - 25}" height="32" rx="6" fill="none" stroke="#3a3a3c"/>
<text x="24" y="${PROMPT_Y + 21}"><tspan class="acc">&gt;</tspan> <tspan class="dim">█</tspan></text>
</svg>
`
writeFileSync(new URL('./demo.svg', import.meta.url), svg)
console.log(`${rules.length} groups, ${TOTAL}s loop, ${WIDTH}x${HEIGHT}, ${Math.round(svg.length / 1024)} KB`)
