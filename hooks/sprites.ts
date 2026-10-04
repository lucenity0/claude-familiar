import type { Mood, Species, Sprite } from '../types'

/**
 * A sprite is 16 by 12 square pixels. The band draws it one of two ways:
 *
 * - `full`: each pixel is two cells side by side, painted as background color,
 *   exactly as the editor shows it. A background fills the whole cell, line
 *   and letter spacing included, so nothing shows between pixels.
 * - `compact`: two pixel rows fold into one terminal row of half blocks, half
 *   the size. Block glyphs do not stretch into extra line or letter spacing,
 *   so a terminal with either set above 1 shows thin gaps.
 */
export const WIDTH = 16
export const HEIGHT = 12

export type SpriteSize = 'full' | 'compact'

export const SPECIES: Record<Exclude<Species, 'custom'>, Sprite> = {
  // Claude Code's own mascot as its welcome screen draws it, each of its cells two pixels tall.
  clawd: {
    palette: { C: '#d77757', e: '#1f1f1f' },
    rows: [
      '..CCCCCCCCCCCC..',
      '..CCCCCCCCCCCC..',
      '..CCeCCCCCCeCC..',
      '..CCeCCCCCCeCC..',
      'CCCCCCCCCCCCCCCC',
      'CCCCCCCCCCCCCCCC',
      '..CCCCCCCCCCCC..',
      '..CCCCCCCCCCCC..',
      '...C.C....C.C...',
      '...C.C....C.C...',
      '................',
      '................',
    ],
  },
  sprout: {
    palette: { L: '#8fc46a', l: '#5a9a3e', s: '#5a9a3e', R: '#d97757', r: '#b65c3f', P: '#c96a4b', p: '#a5523a', e: '#2b2b2b', k: '#f0a08a' },
    rows: [
      '................',
      '..LLL......LLL..',
      '.LLLLl....lLLLL.',
      '..lLLLl..lLLLl..',
      '....lllsslll....',
      '.......ss.......',
      '...RRRRRRRRRR...',
      '...rRRRRRRRRr...',
      '....PPPPPPPP....',
      '....PePPPPeP....',
      '....PkPPPPkP....',
      '.....pppppp.....',
    ],
  },
  owl: {
    palette: { o: '#4a3a2e', b: '#8b6a4e', w: '#efe4d0', e: '#2b2b2b', y: '#e0a040', c: '#6e523b' },
    rows: [
      '..o..........o..',
      '..oo........oo..',
      '..obbbbbbbbbbo..',
      '.obwwwbbbbwwwbo.',
      '.obweewbbweewbo.',
      '.obwwwbyybwwwbo.',
      '.obcbcbbbbcbcbo.',
      '.obbcbcbbcbcbbo.',
      '..obbbbbbbbbbo..',
      '...obbbbbbbbo...',
      '....yy....yy....',
      '................',
    ],
  },
  blob: {
    palette: { g: '#9b8cf2', G: '#7464c8', h: '#d4ccff', e: '#2b2b2b', k: '#f0a0c0' },
    rows: [
      '................',
      '................',
      '......gggg......',
      '....gghhgggg....',
      '...ghhggggggg...',
      '..gggggggggggg..',
      '.ggggeggggegggg.',
      '.ggggeggggegggg.',
      '.gggkggggggkggg.',
      '.GggggggggggggG.',
      '..GGGGGGGGGGGG..',
      '................',
    ],
  },
}

/** One color per pixel, `null` where the terminal shows through. */
export type Grid = (string | null)[][]

/** One pixel of a frame: a color, nothing, or a shut eye drawn as a flat line over its lid. */
export type Pixel = { color: string | null; lash?: string }

/** What one terminal cell draws: a glyph over a background. */
export type Cell = { glyph: string; fg: string | null; bg: string | null }

const SPARKLE = '#f2d27a'

function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const channels = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v * (1 - amount)))
  return `#${channels.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

export function toGrid(sprite: Sprite): Grid {
  return sprite.rows.map(row => [...row].map(key => (key === '.' ? null : sprite.palette[key] ?? null)))
}

/** The pixel rows the sprite uses, so the band draws no empty ones. */
export function usedRows(sprite: Sprite): { top: number; bottom: number } {
  const used = sprite.rows.map((row, y) => (/[^.]/.test(row) ? y : -1)).filter(y => y >= 0)
  return used.length === 0 ? { top: 0, bottom: 0 } : { top: used[0]!, bottom: used[used.length - 1]! }
}

/**
 * The sprite at this moment, pixel by pixel. Moods live in the eyes (the
 * palette's `e` key): a glance aside, a look down or up, or shut as a flat
 * line over the lid. A flinch shakes sideways, sleep dims it all, and levels
 * 5 and 10 each add a sparkle beside the sprite's top row.
 */
export function frame(sprite: Sprite, mood: Mood, tick: number, level: number): Pixel[][] {
  let grid = toGrid(sprite)
  const eye = sprite.palette.e
  const eyes: [number, number][] = []
  sprite.rows.forEach((row, y) => [...row].forEach((key, x) => key === 'e' && eyes.push([x, y])))
  const isEye = (x: number, y: number) => sprite.rows[y]?.[x] === 'e'
  const lidAt = (x: number, y: number) => {
    let side = x - 1
    while (side >= 0 && isEye(side, y)) side -= 1
    return grid[y]?.[side] ?? grid[y]?.[x + 1] ?? null
  }

  const look = (dx: number, dy: number) => {
    if (eye === undefined || (dx === 0 && dy === 0)) return
    const moved = grid.map((row, y) => row.map((color, x) => (isEye(x, y) ? lidAt(x, y) : color)))
    for (const [x, y] of eyes) {
      const to = moved[y + dy]?.[x + dx]
      if (to === undefined || to === null) moved[y]![x] = eye
      else moved[y + dy]![x + dx] = eye
    }
    grid = moved
  }

  const isShut =
    mood === 'happy' || mood === 'flinch' || mood === 'sleepy' || (mood === 'idle' && tick % 10 === 9) || (mood === 'worried' && tick % 8 === 7)
  if (!isShut && mood === 'working') look([0, 1, 0, -1][Math.floor(tick / 2) % 4]!, 0)
  if (!isShut && mood === 'proud') look(0, -1)
  if (!isShut && mood === 'worried') look(0, 1)

  const dim = (color: string | null) => (color === null || mood !== 'sleepy' ? color : darken(color, 0.35))
  let pixels: Pixel[][] = grid.map((row, y) =>
    row.map((color, x) => {
      if (!isShut || eye === undefined || !isEye(x, y)) return { color: dim(color) }
      // A tall eye shuts to its lowest row; the rows above become lid.
      return isEye(x, y + 1) ? { color: dim(lidAt(x, y)) } : { color: dim(lidAt(x, y)), lash: dim(eye)! }
    }),
  )

  if (mood === 'flinch') {
    const blank: Pixel = { color: null }
    pixels = pixels.map(row => (tick % 2 === 0 ? [blank, ...row.slice(0, WIDTH - 1)] : [...row.slice(1), blank]))
  }

  const { top } = usedRows(sprite)
  const sparkles = level >= 10 ? 2 : level >= 5 ? 1 : 0
  const spots: [number, number][] = [[WIDTH - 1, top], [0, top]]
  for (const [x, y] of spots.slice(0, sparkles)) {
    const pixel = pixels[y]?.[x]
    if (pixel !== undefined && pixel.color === null && tick % 4 !== 3) pixels[y]![x] = { color: null, lash: SPARKLE }
  }

  return pixels
}

/** Plain pixels for a grid, for drawings that have no mood. */
export function still(grid: Grid): Pixel[][] {
  return grid.map(row => row.map(color => ({ color })))
}

/** Rows `top` to `bottom` of a frame as terminal cells, two per pixel, nothing between them. */
export function fullCells(pixels: Pixel[][], top = 0, bottom = pixels.length - 1): Cell[][] {
  return pixels.slice(top, bottom + 1).map(row =>
    row.flatMap((pixel): Cell[] => {
      if (pixel.lash !== undefined) {
        const glyph = pixel.color === null ? '+' : '━'
        const cell = { glyph, fg: pixel.lash, bg: pixel.color }
        return pixel.color === null ? [cell, { glyph: ' ', fg: null, bg: null }] : [cell, cell]
      }
      const cell = { glyph: ' ', fg: null, bg: pixel.color }
      return [cell, cell]
    }),
  )
}

/** Rows `top` to `bottom` of a frame folded into half-block cells, one per pixel column. */
export function compactCells(pixels: Pixel[][], top = 0, bottom = pixels.length - 1): Cell[][] {
  const start = top - (top % 2)
  const rows: Cell[][] = []
  for (let y = start; y <= bottom; y += 2) {
    const row: Cell[] = []
    for (let x = 0; x < WIDTH; x += 1) {
      const upper = pixels[y]?.[x] ?? { color: null }
      const lower = pixels[y + 1]?.[x] ?? { color: null }
      const lashed = upper.lash !== undefined ? upper : lower.lash !== undefined ? lower : undefined
      if (lashed !== undefined) {
        const glyph = lashed.color === null ? '+' : '━'
        row.push({ glyph, fg: lashed.lash!, bg: lashed.color })
      } else if (upper.color === null && lower.color === null) row.push({ glyph: ' ', fg: null, bg: null })
      else if (upper.color === lower.color) row.push({ glyph: ' ', fg: null, bg: upper.color })
      else if (lower.color === null) row.push({ glyph: '▀', fg: upper.color, bg: null })
      else if (upper.color === null) row.push({ glyph: '▄', fg: lower.color, bg: null })
      else row.push({ glyph: '▀', fg: upper.color, bg: lower.color })
    }
    rows.push(row)
  }
  return rows
}

const DEFAULT_COLOR = 0x01000000

/** Cells packed for a `Raster`, as RasterProps asks. */
export function rasterCells(cells: Cell[][]): string {
  const flat = cells.flat()
  const words = new Uint32Array(flat.length * 3)
  const color = (hex: string | null) => (hex === null ? DEFAULT_COLOR : parseInt(hex.slice(1), 16))
  flat.forEach((cell, i) => {
    words[i * 3] = cell.glyph.codePointAt(0) ?? 0x20
    words[i * 3 + 1] = color(cell.fg)
    words[i * 3 + 2] = color(cell.bg)
  })
  let binary = ''
  for (const byte of new Uint8Array(words.buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Checks a sprite someone drew or pasted; returns the reason it is not one. */
export function checkSprite(value: unknown): Sprite | string {
  if (typeof value !== 'object' || value === null) return 'expected an object with palette and rows'
  const { palette, rows } = value as Partial<Sprite>
  if (typeof palette !== 'object' || palette === null) return 'palette is missing'
  if (!Array.isArray(rows) || rows.length !== HEIGHT) return `rows must be ${HEIGHT} strings`
  for (const [key, color] of Object.entries(palette)) {
    if (key.length !== 1 || key === '.') return `palette key "${key}" must be one character other than "."`
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return `palette color for "${key}" must look like #a1b2c3`
  }
  for (const [y, row] of rows.entries()) {
    if (typeof row !== 'string' || [...row].length !== WIDTH) return `row ${y + 1} must be ${WIDTH} characters`
    for (const key of row) if (key !== '.' && !(key in palette)) return `row ${y + 1} uses "${key}", which is not in the palette`
  }
  return { palette: { ...palette }, rows: [...rows] }
}

/** A 16 by 6 sprite, saved while the canvas briefly had six rows, stretched back to 16 by 12. */
export function unfold(sprite: Sprite): Sprite {
  if (sprite.rows.length !== HEIGHT / 2) return sprite
  return { palette: sprite.palette, rows: sprite.rows.flatMap(row => [row, row]) }
}

/** A grid back to palette keys: `e` stays the eye color, the rest get letters in order. */
export function fromGrid(grid: Grid, eye: string | null): Sprite {
  const palette: Record<string, string> = {}
  const keyOf = new Map<string, string>()
  const letters = 'abcdfghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let next = 0
  if (eye !== null) {
    palette.e = eye
    keyOf.set(eye, 'e')
  }
  const rows = grid.map(row =>
    row
      .map(color => {
        if (color === null) return '.'
        let key = keyOf.get(color)
        if (key === undefined) {
          key = letters[next] ?? 'z'
          next += 1
          keyOf.set(color, key)
          palette[key] = color
        }
        return key
      })
      .join(''),
  )
  return { palette, rows }
}
