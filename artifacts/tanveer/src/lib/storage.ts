import type { GameMode, PlayerStats } from "./game";

const STATS_KEY = "tanveer-player-stats-v1";
const SOUND_KEY = "tanveer-sound";

const EMPTY_STATS: PlayerStats = {
  gamesPlayed: 0,
  levelsWon: 0,
  totalScore: 0,
  bestScore: 0,
  byMode: {
    slide: { wins: 0, bestScore: 0 },
    memory: { wins: 0, bestScore: 0 },
    cipher: { wins: 0, bestScore: 0 },
  },
  leaderboard: [],
};

function cloneStats(stats: PlayerStats): PlayerStats {
  return {
    ...stats,
    byMode: {
      slide: { ...stats.byMode.slide },
      memory: { ...stats.byMode.memory },
      cipher: { ...stats.byMode.cipher },
    },
    leaderboard: [...stats.leaderboard],
  };
}

export function loadPlayerStats(): PlayerStats {
  if (typeof window === "undefined") return cloneStats(EMPTY_STATS);
  try {
    const stored = window.localStorage.getItem(STATS_KEY);
    if (!stored) return cloneStats(EMPTY_STATS);
    const parsed = JSON.parse(stored) as Partial<PlayerStats>;
    return {
      ...cloneStats(EMPTY_STATS),
      ...parsed,
      byMode: {
        slide: { ...EMPTY_STATS.byMode.slide, ...parsed.byMode?.slide },
        memory: { ...EMPTY_STATS.byMode.memory, ...parsed.byMode?.memory },
        cipher: { ...EMPTY_STATS.byMode.cipher, ...parsed.byMode?.cipher },
      },
      leaderboard: Array.isArray(parsed.leaderboard)
        ? parsed.leaderboard.slice(0, 10)
        : [],
    };
  } catch {
    return cloneStats(EMPTY_STATS);
  }
}

export function savePlayerStats(stats: PlayerStats): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // The game remains playable if browser storage is unavailable or full.
  }
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
  } catch {
    // The sound setting is optional and can be changed again this session.
  }
}

export function defaultStatsForMode(mode: GameMode): PlayerStats["byMode"][GameMode] {
  return { ...EMPTY_STATS.byMode[mode] };
}
