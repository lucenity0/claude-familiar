import type { ClientModule, ClientSurface } from 'claude-code'

import { HEIGHT, WIDTH } from './sprites'
import type { Grid } from './sprites'

/** What the hooks module hands the editor: the sprite to start from and the colors to paint with. */
export type DrawProps = { grid: Grid; swatches: string[] }

type DrawState = {
  grid: Grid
  /** The pixel the keyboard paints: column, row. */
  cursor: [number, number]
  /** Index into the swatches, or -1 for the eraser. */
  color: number
  isMirrored: boolean
  /** The color a held pointer paints with: a hex, `null` to erase, `undefined` when no button is down. */
  brush: string | null | undefined
}

/**
 * Each pixel is one square box, two columns wide and one row tall: one click
 * paints one pixel, and the band draws the saved sprite with the same boxes.
 */
const BOX_COLUMNS = 2
const BOX_ROWS = 1
const GRID_COLUMNS = WIDTH * BOX_COLUMNS
const GRID_ROWS = HEIGHT * BOX_ROWS
/** The swatches sit on the first row and the grid starts two rows down, whatever is drawn beside it. */
const SWATCH_ROW = 0
const GRID_TOP = 2
/** Each swatch is a digit and a two-column chip. */
const SWATCH_COLUMNS = 3
/** The grid with the help beside it. */
const WIDE_COLUMNS = GRID_COLUMNS + 3 + 24

function paint(state: DrawState, x: number, y: number, color: string | null): DrawState {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return state
  const grid = state.grid.map(row => row.slice())
  grid[y]![x] = color
  if (state.isMirrored) grid[y]![WIDTH - 1 - x] = color
  return { ...state, grid }
}

function current(state: DrawState, swatches: string[]): string | null {
  return state.color < 0 ? null : swatches[state.color] ?? null
}

function listen(surface: ClientSurface<DrawState>, swatches: () => string[]) {
  const set = (fn: (state: DrawState) => DrawState) => {
    if (surface.state !== undefined) surface.setState(fn(surface.state))
  }

  surface.onPointer(event => {
    const state = surface.state
    if (state === undefined) return
    const x = Math.floor(event.x / BOX_COLUMNS)
    const y = Math.floor((event.y - GRID_TOP) / BOX_ROWS)
    const isOnGrid = event.y >= GRID_TOP && event.y < GRID_TOP + GRID_ROWS && x < WIDTH

    if (event.type === 'down' && event.y === SWATCH_ROW) {
      const index = Math.floor(event.x / SWATCH_COLUMNS)
      const count = swatches().length
      if (index < count) set(s => ({ ...s, color: index }))
      else if (index === count) set(s => ({ ...s, color: -1 }))
      return
    }
    if (event.type === 'down' && isOnGrid) {
      const brush = event.button === 'right' ? null : current(state, swatches())
      set(s => ({ ...paint(s, x, y, brush), brush, cursor: [x, y] }))
      return
    }
    if (event.type === 'move' && state.brush !== undefined && isOnGrid) {
      const brush = state.brush
      set(s => paint(s, x, y, brush))
      return
    }
    if (event.type === 'up' || event.type === 'leave') set(s => ({ ...s, brush: undefined }))
  })

  surface.onKey(event => {
    const moves: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
    const move = moves[event.key]
    if (move !== undefined) {
      set(s => ({
        ...s,
        cursor: [
          Math.min(WIDTH - 1, Math.max(0, s.cursor[0] + move[0])),
          Math.min(HEIGHT - 1, Math.max(0, s.cursor[1] + move[1])),
        ],
      }))
    } else if (event.key === ' ' || event.key === 'return') {
      set(s => paint(s, s.cursor[0], s.cursor[1], current(s, swatches())))
    } else if (event.key === 'x' || event.key === 'backspace' || event.key === 'delete') {
      set(s => paint(s, s.cursor[0], s.cursor[1], null))
    } else if (event.key === 'm') {
      set(s => ({ ...s, isMirrored: !s.isMirrored }))
    } else if (event.key === '0') {
      set(s => ({ ...s, color: -1 }))
    } else if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1
      if (index < swatches().length) set(s => ({ ...s, color: index }))
    }
  })
}

const Draw: ClientModule<DrawProps, DrawState> = (props, surface) => {
  const { Box, Text, Button } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ grid: props.grid.map(row => row.slice()), cursor: [7, 6], color: 0, isMirrored: false, brush: undefined })
    listen(surface, () => props.swatches)
    return <Text dimColor>loading the grid...</Text>
  }

  const state = surface.state
  const [cx, cy] = state.cursor
  const columns = surface.columns

  const cancel = <Button key="cancel" label="Cancel" role="dismiss" onPress={() => surface.post({ type: 'cancel' })} />

  if (columns > 0 && columns < GRID_COLUMNS) {
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text dimColor>Widen this pane to at least {GRID_COLUMNS} columns to draw. Your strokes are kept.</Text>
        <Box>{cancel}</Box>
      </Box>
    )
  }
  const isWide = columns === 0 || columns >= WIDE_COLUMNS

  const boxes = state.grid.map((row, y) => (
    <Text>
      {row.map((color, x) => {
        const mark = x === cx && y === cy ? '[]' : null
        if (color === null) return <Text dimColor>{mark ?? '· '}</Text>
        return (
          <Text backgroundColor={color} color="#000000">
            {mark ?? '  '}
          </Text>
        )
      })}
    </Text>
  ))

  const swatches = (
    <Text wrap="truncate-end">
      {props.swatches.map((color, i) => (
        <Text>
          <Text bold={state.color === i} dimColor={state.color !== i}>
            {String(i + 1)}
          </Text>
          <Text backgroundColor={color}>{'  '}</Text>
        </Text>
      ))}
      <Text bold={state.color < 0} dimColor={state.color >= 0}>
        0··
      </Text>
    </Text>
  )

  const mirror = state.isMirrored ? 'on' : 'off'

  return (
    <Box flexDirection="column">
      {swatches}
      <Text> </Text>
      <Box flexDirection="row" columnGap={3}>
        <Box flexDirection="column" flexShrink={0}>
          {boxes}
        </Box>
        {isWide && (
          <Box flexDirection="column" rowGap={1}>
            <Text dimColor>one box is one pixel</Text>
            <Box flexDirection="column">
              <Text dimColor>click or drag to paint</Text>
              <Text dimColor>right-click erases</Text>
              <Text dimColor>arrows + space, x erases</Text>
              <Text dimColor>1-9 color, 0 eraser</Text>
              <Text dimColor>m mirror: {mirror}</Text>
            </Box>
          </Box>
        )}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        <Button key="save" label="Save" variant="primary" onPress={() => surface.post({ type: 'save', grid: state.grid })} />
        <Button key="mirror" label={`Mirror ${mirror}`} onPress={() => surface.setState({ ...state, isMirrored: !state.isMirrored })} />
        <Button
          key="clear"
          label="Clear"
          onPress={() => surface.setState({ ...state, grid: Array.from({ length: HEIGHT }, () => Array<string | null>(WIDTH).fill(null)) })}
        />
        {cancel}
      </Box>
      {!isWide && (
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            drag to paint, right-click erases, 1-9 color, m mirror
          </Text>
        </Box>
      )}
    </Box>
  )
}

export default Draw
