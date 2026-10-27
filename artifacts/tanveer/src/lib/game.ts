import { loadPlayerStats, savePlayerStats } from "./storage";

export type GameMode = "slide" | "memory" | "cipher";
export type Difficulty = "easy" | "medium" | "hard";
export type GameStatus = "playing" | "won" | "failed";

export interface CipherPuzzle {
  clue: string;
  encoded: string;
  answer: string;
  hint: string;
}

interface GameSnapshot {
  tiles: number[];
  playerSequence: number[];
  cipherInput: string;
  moves: number;
  score: number;
}

export interface GameSession {
  id: string;
  mode: GameMode;
  difficulty: Difficulty;
  level: number;
  size: number;
  moves: number;
  score: number;
  lastLevelScore: number;
  elapsedSeconds: number;
  timeLimitSeconds: number | null;
  paused: boolean;
  hintsRemaining: number;
  hintsUsed: number;
  status: GameStatus;
  tiles: number[];
  sequence: number[];
  playerSequence: number[];
  previewing: boolean;
  cipher: CipherPuzzle | null;
  cipherInput: string;
  feedback: "idle" | "correct" | "wrong";
  history: GameSnapshot[];
  winRecorded: boolean;
}

export interface ScoreEntry {
  id: string;
  mode: GameMode;
  difficulty: Difficulty;
  level: number;
  score: number;
  moves: number;
  elapsedSeconds: number;
  playedAt: number;
}

export interface PlayerStats {
  gamesPlayed: number;
  levelsWon: number;
  totalScore: number;
  bestScore: number;
  byMode: Record<GameMode, { wins: number; bestScore: number }>;
  leaderboard: ScoreEntry[];
}

const DIFFICULTY_INDEX: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};
const BOARD_SIZES = [3, 4, 5] as const;
const TIME_LIMITS = { easy: null, medium: 240, hard: 150 } as const;
const INITIAL_HINTS = 2;

const CIPHER_BANK: Record<Difficulty, CipherPuzzle[]> = {
  easy: [
    {
      clue: "The brightest thing in the daytime sky.",
      encoded: "WKH VXQ",
      answer: "THE SUN",
      hint: "Each letter has moved three places forward.",
    },
    {
      clue: "A quiet light in the night sky.",
      encoded: "PRRQ OLJKW",
      answer: "MOON LIGHT",
      hint: "Shift every letter three places backward.",
    },
    {
      clue: "Where ships meet the shore.",
      encoded: "VHD VKRUH",
      answer: "SEA SHORE",
      hint: "Try moving each letter back by three.",
    },
    {
      clue: "A small light that guides you after dark.",
      encoded: "VWDU OLJKW",
      answer: "STAR LIGHT",
      hint: "The message uses a Caesar shift of three.",
    },
  ],
  medium: [
    {
      clue: "A place where a story begins.",
      encoded: "WKH ILUVW SDJH",
      answer: "THE FIRST PAGE",
      hint: "The alphabet has been shifted forward by three.",
    },
    {
      clue: "A direction you might follow to find your way.",
      encoded: "QRUWK EB QRUWKZHVW",
      answer: "NORTH BY NORTHWEST",
      hint: "Decode with a Caesar shift of three; spaces stay in place.",
    },
    {
      clue: "What you need to solve every puzzle.",
      encoded: "FOHDU WKRXJKWV",
      answer: "CLEAR THOUGHTS",
      hint: "Move every encoded letter back three places.",
    },
    {
      clue: "A phrase for acting at exactly the right moment.",
      encoded: "LQ JRRG WLPH",
      answer: "IN GOOD TIME",
      hint: "Use a three-letter backward shift.",
    },
  ],
  hard: [
    {
      clue: "A short instruction for making progress.",
      encoded: "L H F S H R J Q H",
      answer: "KEEP GOING",
      hint: "The alphabet shift alternates: one step, then three, repeating.",
    },
    {
      clue: "Decode the number pattern: 20-8-9-14-11 2-5-6-15-18-5 21-19-5",
      encoded: "20 · 8 · 9 · 14 · 11   /   2 · 5 · 6 · 15 · 18 · 5   /   21 · 19 · 5",
      answer: "THINK BEFORE USE",
      hint: "A=1, B=2, C=3 ... Z=26.",
    },
    {
      clue: "A message hidden in the first letters: Golden Owls Navigate Open Water.",
      encoded: "G O N O W",
      answer: "GO NOW",
      hint: "Read the first letter of every word in the clue.",
    },
    {
      clue: "A key for finding the answer: reverse the phrase, then read it normally.",
      encoded: "NOITULOS EHT",
      answer: "THE SOLUTION",
      hint: "Read the encoded words from right to left, then reverse each word.",
    },
  ],
};

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getPlayerStats(): PlayerStats {
  return loadPlayerStats();
}

function modeSize(difficulty: Difficulty): number {
  return BOARD_SIZES[DIFFICULTY_INDEX[difficulty]];
}

function shuffledSlideBoard(size: number, level: number): number[] {
  const count = size * size;
  const board = Array.from({ length: count }, (_, index) =>
    index === count - 1 ? 0 : index + 1,
  );
  let blank = count - 1;
  let previousBlank = -1;
  const scrambleSteps = Math.min(900, 35 + level * 20 + size * 12);

  for (let step = 0; step < scrambleSteps; step += 1) {
    const row = Math.floor(blank / size);
    const col = blank % size;
    const candidates = [
      row > 0 ? blank - size : -1,
      row < size - 1 ? blank + size : -1,
      col > 0 ? blank - 1 : -1,
      col < size - 1 ? blank + 1 : -1,
    ].filter((index) => index >= 0 && index !== previousBlank);
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    [board[blank], board[next]] = [board[next], board[blank]];
    previousBlank = blank;
    blank = next;
  }

  if (board.every((tile, index) => tile === (index === count - 1 ? 0 : index + 1))) {
    const neighbor = blank - 1;
    [board[blank], board[neighbor]] = [board[neighbor], board[blank]];
  }
  return board;
}

function randomSequence(size: number, level: number, difficulty: Difficulty): number[] {
  const startLength = difficulty === "easy" ? 2 : difficulty === "medium" ? 3 : 4;
  const length = Math.min(size * size, startLength + level - 1);
  return Array.from({ length }, () => Math.floor(Math.random() * size * size));
}

function cipherAt(difficulty: Difficulty, level: number): CipherPuzzle {
  const puzzles = CIPHER_BANK[difficulty];
  return puzzles[(level - 1) % puzzles.length];
}

function snapshot(session: GameSession): GameSnapshot {
  return {
    tiles: [...session.tiles],
    playerSequence: [...session.playerSequence],
    cipherInput: session.cipherInput,
    moves: session.moves,
    score: session.score,
  };
}

function pushHistory(session: GameSession): GameSession {
  return {
    ...session,
    history: [...session.history.slice(-19), snapshot(session)],
  };
}

function calculateLevelScore(session: GameSession): number {
  const base = 450 + session.level * 90 + DIFFICULTY_INDEX[session.difficulty] * 100;
  const penalty = session.moves * 5 + session.elapsedSeconds * 2 + session.hintsUsed * 55;
  return Math.max(50, base - penalty);
}

function markWon(session: GameSession): GameSession {
  if (session.status !== "playing") return session;
  const levelScore = calculateLevelScore(session);
  const won: GameSession = {
    ...session,
    score: session.score + levelScore,
    lastLevelScore: levelScore,
    status: "won",
    winRecorded: true,
  };
  const stats = getPlayerStats();
  const entry: ScoreEntry = {
    id: `${session.id}-${session.level}`,
    mode: session.mode,
    difficulty: session.difficulty,
    level: session.level,
    score: levelScore,
    moves: session.moves,
    elapsedSeconds: session.elapsedSeconds,
    playedAt: Date.now(),
  };
  stats.levelsWon += 1;
  stats.totalScore += levelScore;
  stats.bestScore = Math.max(stats.bestScore, levelScore);
  stats.byMode[session.mode].wins += 1;
  stats.byMode[session.mode].bestScore = Math.max(stats.byMode[session.mode].bestScore, levelScore);
  stats.leaderboard = [entry, ...stats.leaderboard]
    .sort((a, b) => b.score - a.score || a.elapsedSeconds - b.elapsedSeconds)
    .slice(0, 10);
  savePlayerStats(stats);
  return won;
}

function maybeFail(session: GameSession): GameSession {
  if (
    session.timeLimitSeconds !== null &&
    session.elapsedSeconds >= session.timeLimitSeconds &&
    session.status === "playing"
  ) {
    return { ...session, status: "failed" };
  }
  return session;
}

export function createGame(mode: GameMode, difficulty: Difficulty): GameSession {
  const stats = getPlayerStats();
  stats.gamesPlayed += 1;
  savePlayerStats(stats);

  const size = modeSize(difficulty);
  const session: GameSession = {
    id: makeId(),
    mode,
    difficulty,
    level: 1,
    size,
    moves: 0,
    score: 0,
    lastLevelScore: 0,
    elapsedSeconds: 0,
    timeLimitSeconds: TIME_LIMITS[difficulty],
    paused: false,
    hintsRemaining: INITIAL_HINTS,
    hintsUsed: 0,
    status: "playing",
    tiles:
      mode === "slide"
        ? shuffledSlideBoard(size, 1)
        : mode === "memory"
          ? Array.from({ length: size * size }, () => 0)
          : [],
    sequence: mode === "memory" ? randomSequence(size, 1, difficulty) : [],
    playerSequence: [],
    previewing: mode === "memory",
    cipher: mode === "cipher" ? cipherAt(difficulty, 1) : null,
    cipherInput: "",
    feedback: "idle",
    history: [],
    winRecorded: false,
  };
  return session;
}

export function tickGame(session: GameSession): GameSession {
  if (session.status !== "playing" || session.paused) return session;
  return maybeFail({ ...session, elapsedSeconds: session.elapsedSeconds + 1 });
}

export function setGamePaused(session: GameSession, paused: boolean): GameSession {
  if (session.status !== "playing") return session;
  return { ...session, paused };
}

export function moveTile(session: GameSession, index: number): GameSession {
  if (session.status !== "playing" || session.mode !== "slide") return session;
  const blank = session.tiles.indexOf(0);
  const row = Math.floor(index / session.size);
  const col = index % session.size;
  const blankRow = Math.floor(blank / session.size);
  const blankCol = blank % session.size;
  if (Math.abs(row - blankRow) + Math.abs(col - blankCol) !== 1) return session;

  const next = pushHistory(session);
  const tiles = [...next.tiles];
  [tiles[blank], tiles[index]] = [tiles[index], tiles[blank]];
  const updated = { ...next, tiles, moves: next.moves + 1, feedback: "idle" as const };
  const solved = tiles.every((tile, tileIndex) => tile === (tileIndex === tiles.length - 1 ? 0 : tileIndex + 1));
  return solved ? markWon(updated) : updated;
}

export function finishMemoryPreview(session: GameSession): GameSession {
  if (session.mode !== "memory" || !session.previewing || session.status !== "playing") return session;
  return { ...session, previewing: false, playerSequence: [], feedback: "idle" };
}

export function replayMemoryPreview(session: GameSession): GameSession {
  if (session.mode !== "memory" || session.status !== "playing") return session;
  return { ...session, previewing: true, playerSequence: [], feedback: "idle" };
}

export function tapMemoryTile(session: GameSession, index: number): GameSession {
  if (
    session.status !== "playing" ||
    session.mode !== "memory" ||
    session.previewing ||
    index < 0 ||
    index >= session.size * session.size
  ) {
    return session;
  }
  const next = pushHistory(session);
  const playerSequence = [...next.playerSequence, index];
  const expected = next.sequence[playerSequence.length - 1];
  if (index !== expected) {
    return {
      ...next,
      playerSequence: [],
      moves: next.moves + 1,
      score: Math.max(0, next.score - 15),
      feedback: "wrong",
    };
  }

  const updated = {
    ...next,
    playerSequence,
    moves: next.moves + 1,
    feedback: "correct" as const,
  };
  return playerSequence.length === session.sequence.length ? markWon(updated) : updated;
}

export function setCipherInput(session: GameSession, value: string): GameSession {
  if (session.status !== "playing" || session.mode !== "cipher") return session;
  return { ...session, cipherInput: value.slice(0, 48), feedback: "idle" };
}

export function submitCipher(session: GameSession): GameSession {
  if (session.status !== "playing" || session.mode !== "cipher" || !session.cipher) return session;
  const next = pushHistory(session);
  if (!next.cipher) return next;
  const normalized = next.cipherInput.trim().replace(/\s+/g, " ").toUpperCase();
  const answer = next.cipher.answer.trim().replace(/\s+/g, " ").toUpperCase();
  if (normalized === answer) {
    return markWon({ ...next, moves: next.moves + 1, feedback: "correct" });
  }
  return {
    ...next,
    moves: next.moves + 1,
    score: Math.max(0, next.score - 20),
    feedback: "wrong",
  };
}

export function undoGame(session: GameSession): GameSession {
  if (session.status !== "playing" || session.history.length === 0) return session;
  const history = [...session.history];
  const previous = history.pop();
  if (!previous) return session;
  return {
    ...session,
    tiles: previous.tiles,
    playerSequence: previous.playerSequence,
    cipherInput: previous.cipherInput,
    moves: previous.moves,
    score: previous.score,
    history,
    feedback: "idle",
  };
}

export function getGameHint(
  session: GameSession,
): { session: GameSession; text: string } {
  if (session.status !== "playing" || session.hintsRemaining <= 0) {
    return { session, text: "No hints left for this level." };
  }
  const hinted: GameSession = {
    ...session,
    hintsRemaining: session.hintsRemaining - 1,
    hintsUsed: session.hintsUsed + 1,
  };
  if (session.mode === "slide") {
    const blank = session.tiles.indexOf(0);
    const candidates = [blank - session.size, blank + session.size, blank - 1, blank + 1].filter((index) => {
      if (index < 0 || index >= session.tiles.length) return false;
      if ((index === blank - 1 || index === blank + 1) && Math.floor(index / session.size) !== Math.floor(blank / session.size)) return false;
      return true;
    });
    const distance = (tile: number, index: number) => {
      const target = tile === 0 ? session.size * session.size - 1 : tile - 1;
      return Math.abs(Math.floor(index / session.size) - Math.floor(target / session.size)) + Math.abs((index % session.size) - (target % session.size));
    };
    const best = candidates.reduce((bestIndex, index) => {
      const before = distance(session.tiles[index], index) + distance(0, blank);
      const after = distance(session.tiles[index], blank) + distance(0, index);
      return after < before ? index : bestIndex;
    }, candidates[0]);
    return { session: hinted, text: `Try moving tile ${session.tiles[best]} into the empty space.` };
  }
  if (session.mode === "memory") {
    return { session: replayMemoryPreview(hinted), text: "Watch the sequence again, then repeat it." };
  }
  return { session: hinted, text: session.cipher?.hint ?? "Read the clue carefully." };
}

export function advanceLevel(session: GameSession): GameSession {
  if (session.status !== "won") return session;
  const level = session.level + 1;
  const next: GameSession = {
    ...session,
    level,
    moves: 0,
    elapsedSeconds: 0,
    lastLevelScore: 0,
    paused: false,
    hintsRemaining: INITIAL_HINTS,
    hintsUsed: 0,
    status: "playing",
    playerSequence: [],
    previewing: session.mode === "memory",
    cipherInput: "",
    feedback: "idle",
    history: [],
    winRecorded: false,
  };
  if (session.mode === "slide") next.tiles = shuffledSlideBoard(session.size, level);
  if (session.mode === "memory") next.sequence = randomSequence(session.size, level, session.difficulty);
  if (session.mode === "cipher") next.cipher = cipherAt(session.difficulty, level);
  return next;
}

export function restartLevel(session: GameSession): GameSession {
  const reset: GameSession = {
    ...session,
    moves: 0,
    elapsedSeconds: 0,
    lastLevelScore: 0,
    paused: false,
    hintsRemaining: INITIAL_HINTS,
    hintsUsed: 0,
    status: "playing",
    playerSequence: [],
    previewing: session.mode === "memory",
    cipherInput: "",
    feedback: "idle",
    history: [],
    winRecorded: false,
  };
  if (session.mode === "slide") reset.tiles = shuffledSlideBoard(session.size, session.level);
  if (session.mode === "memory") reset.sequence = randomSequence(session.size, session.level, session.difficulty);
  return reset;
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
