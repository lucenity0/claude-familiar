// Renders the README's two animations with the mod's own frame code:
// demo.svg, a made-up session with a familiar above the prompt, and moods.svg,
// every built-in familiar acting out each mood together.
// Run: node --experimental-strip-types assets/demo.mts
import { SPECIES, bandRows, compactCells, frame } from '../hooks/sprites.ts'
import type { Pixel } from '../hooks/sprites.ts'
import { writeFileSync } from 'node:fs'

type Mood = 'idle' | 'working' | 'happy' | 'worried' | 'flinch' | 'proud' | 'sleepy'

const FRAME_S = 0.5
const LEVEL = 3
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const clock = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`)

/**
 * One looping animation: each part draws what a tick shows, runs of identical
 * ticks merge, and each run becomes a group a CSS step animation shows in turn.
 */
function animation(ticks: number) {
  const rules: string[] = []
  const total = ticks * FRAME_S
  const timed = (body: string, from: number, to: number) => {
    const id = `k${rules.length}`
    rules.push(`@keyframes ${id} { 0% { opacity: 1 } ${(((to - from) / ticks) * 100).toFixed(3)}% { opacity: 0 } 100% { opacity: 0 } }`)
    const delay = -((ticks - from) % ticks) * FRAME_S
    return `<g style="opacity:0;animation:${id} ${total}s step-end ${delay.toFixed(2)}s infinite">${body}</g>`
  }
  const track = (draw: (tick: number) => string) => {
    const out: string[] = []
    let from = 0
    let last = draw(0)
    for (let tick = 1; tick <= ticks; tick++) {
      const now = tick < ticks ? draw(tick) : ''
      if (now !== last || tick === ticks) {
        if (last !== '') out.push(timed(last, from, tick))
        from = tick
        last = now
      }
    }
    return out.join('\n')
  }
  return { track, rules }
}

function svg(width: number, height: number, label: string, rules: string[], body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
<style>
text { font-family: ${FONT}; font-size: 12px; fill: #e6e6e6; white-space: pre; }
.glyph { font-size: 11px; font-weight: 700; }
.dim { fill: #8b8b8b; } .acc { fill: #d97757; } .red { fill: #e5534b; } .grn { fill: #57ab5a; } .b { font-weight: 700; }
.title { font-size: 11px; fill: #9a9a9a; }
${rules.join('\n')}
</style>
<rect width="${width}" height="${height}" rx="10" fill="#1b1b1d"/>
${body}
</svg>
`
}

// ---------- demo.svg: a session ----------

function demo(): string {
  const sprite = SPECIES.cat
  const bash = (dot: string) => `<tspan class="${dot}">●</tspan> <tspan class="b">Bash</tspan>(npm test)`
  const tool = (name: string, arg: string) => `<tspan class="grn">●</tspan> <tspan class="b">${name}</tspan>(${arg})`
  const said = (text: string) => `● ${text}`
  const result = (text: string, cls = 'dim') => `<tspan class="${cls}">  ⎿  ${text}</tspan>`

  // What happens, in frames of half a second.
  const lines: { at: number; text: string; replaces?: true }[] = [
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
  const moods: { at: number; mood: Mood; say: string }[] = [
    { at: 0, mood: 'working', say: 'on it.' },
    { at: 7, mood: 'worried', say: 'hm.' },
    { at: 15, mood: 'working', say: 'on it.' },
    { at: 20, mood: 'happy', say: 'tests green. nice.' },
    { at: 23, mood: 'proud', say: '2m14s. long one.' },
    { at: 33, mood: 'sleepy', say: 'zz.' },
  ]
  const doneAt = 23
  const turnSeconds = 134
  const ticks = 48

  // Every block sits the same distance from the next: title bar, transcript, familiar, prompt, status line.
  const width = 640
  const pad = 20
  const gap = 18
  const cellW = 7
  const cellH = 14
  const lineH = 21
  const visible = 8
  const x = 20
  const { top, bottom } = bandRows(sprite)
  const bandHeight = compactCells(frame(sprite, 'idle', 0, LEVEL), top, bottom).length
  const titleH = 32
  const transcriptY = titleH + pad + 9
  const transcriptEnd = transcriptY + (visible - 1) * lineH + 4
  // The band's first row is headroom for a hop or a rising z, so it may sit in the gap.
  const bandY = transcriptEnd + gap - cellH
  const bandEnd = bandY + bandHeight * cellH
  const promptY = bandEnd + gap
  const statusY = promptY + 32 + gap + 9
  const height = statusY + 4 + pad
  const wordsX = x + 20 * cellW + cellW

  const { track, rules } = animation(ticks)
  const moodAt = (tick: number) => [...moods].reverse().find(m => m.at <= tick)!

  const transcript = (tick: number) => {
    const shown: string[] = []
    for (const line of lines) {
      if (line.at > tick) break
      if (line.replaces) shown.pop()
      shown.push(line.text)
    }
    return shown
      .slice(-visible)
      .map((text, i) => `<text x="${x}" y="${transcriptY + i * lineH}">${text}</text>`)
      .join('')
  }

  const familiar = (tick: number) => {
    const m = moodAt(tick)
    const cells = compactCells(frame(sprite, m.mood, tick, LEVEL, tick - m.at), top, bottom)
    const out: string[] = []
    const rect = (cx: number, y: number, h: number, fill: string) =>
      out.push(`<rect x="${x + cx * cellW}" y="${bandY + y}" width="${cellW}" height="${h}" fill="${fill}"/>`)
    cells.forEach((row, cy) =>
      row.forEach((cell, cx) => {
        const y = cy * cellH
        if (cell.bg !== null) rect(cx, y, cellH, cell.bg)
        if (cell.fg === null || cell.glyph === ' ') return
        if (cell.glyph === '▀') rect(cx, y, cellH / 2, cell.fg)
        else if (cell.glyph === '▄') rect(cx, y + cellH / 2, cellH / 2, cell.fg)
        else if (cell.glyph === '━') rect(cx, y + cellH / 2 - 1, 2, cell.fg)
        else out.push(`<text x="${x + cx * cellW + cellW / 2}" y="${bandY + y + cellH - 3}" text-anchor="middle" fill="${cell.fg}" class="glyph">${esc(cell.glyph)}</text>`)
      }),
    )
    return out.join('')
  }

  const words = (tick: number) => {
    const m = moodAt(tick)
    const middle = bandY + cellH + ((bandHeight - 1) * cellH) / 2
    return `<text x="${wordsX}" y="${middle - 3}">${esc(m.say)}</text><text x="${wordsX}" y="${middle + 15}" class="dim">tofu · ${m.mood} · lvl ${LEVEL}</text>`
  }

  const status = (tick: number) =>
    tick >= doneAt
      ? `<text x="${x}" y="${statusY}" class="dim">✓ ${clock(turnSeconds)} · 18.2k in · 2.1k out</text>`
      : `<text x="${x}" y="${statusY}" class="dim">running ${clock(Math.round((tick / doneAt) * turnSeconds))}</text>`

  const body = `<rect width="${width}" height="${titleH}" rx="10" fill="#262628"/><rect y="${titleH - 10}" width="${width}" height="10" fill="#262628"/>
<circle cx="20" cy="16" r="5.5" fill="#ff5f57"/><circle cx="38" cy="16" r="5.5" fill="#febc2e"/><circle cx="56" cy="16" r="5.5" fill="#28c840"/>
<text x="${width / 2}" y="20" text-anchor="middle" class="title">claude — ~/demo</text>
${track(transcript)}
<g shape-rendering="crispEdges">
${track(familiar)}
</g>
${track(words)}
<rect x="12.5" y="${promptY + 0.5}" width="${width - 25}" height="32" rx="6" fill="none" stroke="#3a3a3c"/>
<text x="${x + 4}" y="${promptY + 21}"><tspan class="acc">&gt;</tspan> <tspan class="dim">█</tspan></text>
${track(status)}`
  return svg(width, height, "A familiar above the Claude Code prompt reacting to a session: thinking dots while Claude works, a sweat drop when a test fails, a hop when it passes, sparkles after a long turn, and z's when it dozes off", rules, body)
}

// ---------- moods.svg: every familiar, every mood ----------

function moods(): string {
  const scenes: { mood: Mood; caption: string; ticks: number }[] = [
    { mood: 'working', caption: 'working · while Claude runs', ticks: 8 },
    { mood: 'worried', caption: 'worried · a command failed', ticks: 8 },
    { mood: 'happy', caption: 'happy · failing tests pass again', ticks: 6 },
    { mood: 'proud', caption: 'proud · a turn over two minutes ends', ticks: 8 },
    { mood: 'flinch', caption: 'flinch · seatbelt blocked something', ticks: 6 },
    { mood: 'sleepy', caption: 'sleepy · near a rate limit, or ten quiet minutes', ticks: 10 },
  ]
  const ticks = scenes.reduce((n, s) => n + s.ticks, 0)
  const sceneAt = (tick: number) => {
    let start = 0
    for (const scene of scenes) {
      if (tick < start + scene.ticks) return { scene, age: tick - start }
      start += scene.ticks
    }
    return { scene: scenes[0]!, age: 0 }
  }

  const species = Object.entries(SPECIES)
  const px = 4
  const canvasW = 20 * px
  const canvasH = 14 * px
  const gap = 20
  const pad = 30
  const width = pad * 2 + species.length * canvasW + (species.length - 1) * gap
  const spriteY = pad
  const nameY = spriteY + canvasH + 20
  const captionY = nameY + 34
  const height = captionY + pad - 6

  const { track, rules } = animation(ticks)

  // One path per color keeps a frame small: each run of pixels is a short move and three lines.
  const draw = (pixels: Pixel[][], ox: number) => {
    const out: string[] = []
    const runs = new Map<string, string[]>()
    pixels.forEach((row, y) => {
      let x = 0
      while (x < row.length) {
        const color = row[x]!.color
        if (color === null) { x++; continue }
        const start = x
        while (x < row.length && row[x]!.color === color) x++
        const list = runs.get(color) ?? []
        list.push(`M${ox + start * px} ${spriteY + y * px}h${(x - start) * px}v${px}h${-(x - start) * px}z`)
        runs.set(color, list)
      }
    })
    for (const [color, list] of runs) out.push(`<path fill="${color}" d="${list.join('')}"/>`)
    pixels.forEach((row, y) => {
      row.forEach((p, cx) => {
        if (p.mark === undefined) return
        if (p.mark.glyph === '━') out.push(`<rect x="${ox + cx * px}" y="${spriteY + y * px + 2}" width="${px}" height="1.5" fill="${p.mark.fg}"/>`)
        else out.push(`<text x="${ox + cx * px + px / 2}" y="${spriteY + y * px + px}" text-anchor="middle" fill="${p.mark.fg}" class="glyph" style="font-size:9px">${esc(p.mark.glyph)}</text>`)
      })
    })
    return out.join('')
  }

  const lineup = (tick: number) => {
    const { scene, age } = sceneAt(tick)
    return species.map(([, sprite], i) => draw(frame(sprite, scene.mood, tick, LEVEL, age), pad + i * (canvasW + gap))).join('')
  }
  const names = species
    .map(([name], i) => `<text x="${pad + i * (canvasW + gap) + (16 * px) / 2}" y="${nameY}" text-anchor="middle" class="dim">${name}</text>`)
    .join('')
  const caption = (tick: number) => `<text x="${width / 2}" y="${captionY}" text-anchor="middle">${esc(sceneAt(tick).scene.caption)}</text>`

  const body = `<g shape-rendering="crispEdges">
${track(lineup)}
</g>
${names}
${track(caption)}`
  return svg(width, height, `The built-in familiars, ${species.map(([name]) => name).join(', ')}, acting out each mood together: working, worried, happy, proud, flinch and sleepy`, rules, body)
}

for (const [file, content] of [['demo.svg', demo()], ['moods.svg', moods()]] as const) {
  writeFileSync(new URL(`./${file}`, import.meta.url), content)
  console.log(`${file}: ${Math.round(content.length / 1024)} KB`)
}
