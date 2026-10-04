export type Mood = 'idle' | 'working' | 'happy' | 'worried' | 'flinch' | 'proud' | 'sleepy'

export type Species = 'clawd' | 'sprout' | 'owl' | 'blob' | 'custom'

/** A sprite: 12 rows of 16 palette keys, `.` for a see-through pixel. */
export type Sprite = { palette: Record<string, string>; rows: string[] }

/** What survives across sessions, kept in `$.store` under `profile`. */
export type Profile = {
  name: string
  species: Species
  xp: number
  hatchedAt: string
  custom: Sprite | null
}

/** What the band draws right now. */
export type View = {
  mood: Mood
  line: string
  /** Until when (epoch ms) a passing mood holds before settling back. */
  holdUntil: number
  /** When (epoch ms) this mood began, so an animation can play once from its start. */
  since: number
}

/** What the band shows plus what the session remembers between signals. */
export type Mind = {
  view: View
  isWorking: boolean
  errorStreak: number
  testsFailing: boolean
  lastActiveAt: number
}

declare module 'claude-code' {
  interface PluginState {
    familiar: {
      mind: Mind
      tick: number
      isHidden: boolean
      profile: Profile | null
    }
  }
}
