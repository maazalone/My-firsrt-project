import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeft, ArrowRight, Award, Brain, Check, ChevronRight, CircleHelp,
  Clock3, Command, Grid2X2, Lightbulb, ListOrdered, Pause, Play,
  RotateCcw, Sparkles, Volume2, VolumeX, X, Zap,
} from 'lucide-react';
import {
  advanceLevel, createGame, finishMemoryPreview, formatTime, getGameHint,
  getPlayerStats, moveTile, restartLevel, setCipherInput,
  setGamePaused, submitCipher, tapMemoryTile, tickGame, undoGame,
  type Difficulty, type GameMode, type GameSession, type PlayerStats,
} from '@/lib/game';

type Modal = 'pause' | 'instructions' | null;
type ModeInfo = { name: string; description: string; icon: typeof Grid2X2; count: string; id: GameMode };

const MODES: ModeInfo[] = [
  { id: 'slide', name: 'Sliding tiles', description: 'Put every number back in its place. A classic with a sharper edge.', icon: Grid2X2, count: '01 / LOGIC' },
  { id: 'memory', name: 'Sequence', description: 'Watch the pattern. Then trust your memory and repeat it.', icon: Brain, count: '02 / MEMORY' },
  { id: 'cipher', name: 'Cipher', description: 'Crack the encoded phrase before the clock runs out.', icon: Command, count: '03 / WORDPLAY' },
];

function playTone(kind: 'tap' | 'win' | 'wrong') {
  try {
    const Context = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(kind === 'win' ? 660 : kind === 'wrong' ? 180 : 440, now);
    if (kind === 'win') oscillator.frequency.exponentialRampToValueAtTime(990, now + .16);
    gain.gain.setValueAtTime(.055, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + (kind === 'win' ? .3 : .12));
    oscillator.start(now);
    oscillator.stop(now + (kind === 'win' ? .3 : .12));
    oscillator.onended = () => void context.close();
  } catch {
    // Audio is an optional enhancement; gameplay never depends on it.
  }
}

function App() {
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [session, setSession] = useState<GameSession | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [stats, setStats] = useState<PlayerStats>(() => getPlayerStats());
  const [sound, setSound] = useState(() => {
    try { return window.localStorage.getItem('tanveer-sound') !== 'off'; } catch { return true; }
  });
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  sessionRef.current = session;

  const update = useCallback((next: GameSession, soundKind?: 'tap' | 'win' | 'wrong') => {
    if (soundKind && sound) playTone(soundKind);
    setSession(next);
    if (next.status === 'won') setStats(getPlayerStats());
  }, [sound]);

  const announce = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 2600);
  };

  useEffect(() => {
    if (!session || session.status !== 'playing' || session.paused) return;
    const timer = window.setInterval(() => {
      setSession((current) => {
        if (!current) return current;
        const next = tickGame(current);
        if (next.status === 'failed' && sound) playTone('wrong');
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.status, session?.paused, sound]);

  useEffect(() => {
    if (!session || session.mode !== 'memory' || !session.previewing || session.paused || session.status !== 'playing') return;
    const previewDuration = Math.max(1300, session.sequence.length * 420 + 300);
    const timer = window.setTimeout(() => {
      setSession((current) => current && current.id === session.id && current.previewing ? finishMemoryPreview(current) : current);
    }, previewDuration);
    return () => window.clearTimeout(timer);
  }, [session?.id, session?.level, session?.previewing, session?.paused, session?.status, session?.hintsUsed, session?.sequence.length]);

  useEffect(() => {
    if (!session || session.mode !== 'slide' || session.status !== 'playing' || session.paused) return;
    const onKey = (event: KeyboardEvent) => {
      const current = sessionRef.current;
      if (!current || current.mode !== 'slide' || current.paused || current.status !== 'playing') return;
      const blank = current.tiles.indexOf(0);
      const col = blank % current.size;
      const index = event.key === 'ArrowUp' ? blank + current.size
        : event.key === 'ArrowDown' ? blank - current.size
          : event.key === 'ArrowLeft' ? (col < current.size - 1 ? blank + 1 : -1)
            : event.key === 'ArrowRight' ? (col > 0 ? blank - 1 : -1) : -1;
      if (index >= 0 && index < current.tiles.length) {
        event.preventDefault();
        const next = moveTile(current, index);
        update(next, next !== current && next.moves !== current.moves ? next.status === 'won' ? 'win' : 'tap' : undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session?.id, session?.mode, session?.status, session?.paused, update]);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const startGame = (mode: GameMode) => {
    setModal(null);
    setSession(createGame(mode, difficulty));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const returnHome = () => {
    setSession(null);
    setModal(null);
    setStats(getPlayerStats());
  };
  const toggleSound = () => {
    setSound((current) => {
      const next = !current;
      try { window.localStorage.setItem('tanveer-sound', next ? 'on' : 'off'); } catch { /* storage is optional */ }
      return next;
    });
  };
  const hint = () => {
    if (!session) return;
    const result = getGameHint(session);
    update(result.session, 'tap');
    announce(result.text);
  };
  const undo = () => {
    if (session) update(undoGame(session), 'tap');
  };
  const restart = () => {
    if (session) {
      update(restartLevel(session));
      setModal(null);
      announce('Level restarted');
    }
  };
  const pause = () => {
    if (session) {
      update(setGamePaused(session, true));
      setModal('pause');
    }
  };
  const resume = () => {
    if (session) update(setGamePaused(session, false));
    setModal(null);
  };
  const doCipherSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) return;
    const next = submitCipher(session);
    update(next, next.status === 'won' ? 'win' : next.feedback === 'wrong' ? 'wrong' : 'tap');
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={returnHome} aria-label="Tanveer home" data-testid="button-home">
          <span className="brand-mark"><Zap size={18} strokeWidth={2.4} /></span>
          <span>tanveer<span style={{ color: '#52e1dc' }}>.</span></span>
        </button>
        <div className="top-actions">
          {!session && <button className="quiet-button top-stats" onClick={() => document.getElementById('scoreboard')?.scrollIntoView({ behavior: 'smooth' })} data-testid="button-view-stats"><Award size={15} /> Your stats</button>}
          <button className="icon-button" onClick={toggleSound} aria-label={sound ? 'Mute sound' : 'Enable sound'} title={sound ? 'Mute sound' : 'Enable sound'} data-testid="button-toggle-sound">
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button className="icon-button" onClick={() => setModal('instructions')} aria-label="How to play" title="How to play" data-testid="button-instructions"><CircleHelp size={17} /></button>
        </div>
      </header>

      {!session ? (
        <section className="home-layout">
          <div className="hero">
            <div className="eyebrow">A little clarity, in a busy day</div>
            <h1>Make room<br />for <span>one more</span> thought.</h1>
            <p>Three quick challenges for the part of your brain that likes to click into place. Pick a game. Find your rhythm.</p>
            <div className="hero-meta">
              <span className="pill"><Clock3 size={13} /> 2–4 MIN</span>
              <span className="pill"><Sparkles size={13} /> 3 WAYS TO PLAY</span>
            </div>
          </div>

          <div className="mode-grid" aria-label="Choose a puzzle">
            {MODES.map((mode, index) => {
              const Icon = mode.icon;
              return (
                <button className={`mode-card ${index === 0 ? 'featured' : ''}`} onClick={() => startGame(mode.id)} key={mode.id} style={{ '--mode-glow': mode.id === 'memory' ? 'rgba(68,210,150,.12)' : mode.id === 'cipher' ? 'rgba(140,112,221,.12)' : 'rgba(48,218,216,.12)' } as CSSProperties} data-testid={`button-start-${mode.id}`}>
                  <div className="mode-card-top">
                    <span className="mode-icon"><Icon size={22} /></span>
                    <span className="mode-number">{mode.count}</span>
                  </div>
                  <div>
                    <h2>{mode.name}</h2>
                    <p>{mode.description}</p>
                  </div>
                  <div className="mode-footer"><span>Play now</span><ArrowRight size={16} /></div>
                </button>
              );
            })}
          </div>

          <div className="difficulty-row">
            <span className="difficulty-label">Set your pace</span>
            <div className="segmented" role="group" aria-label="Difficulty">
              {(['easy', 'medium', 'hard'] as const).map((item) => (
                <button key={item} className={`segment ${difficulty === item ? 'active' : ''}`} onClick={() => setDifficulty(item)} aria-pressed={difficulty === item} data-testid={`button-difficulty-${item}`}>{item[0].toUpperCase() + item.slice(1)}</button>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 11 }}>{difficulty === 'easy' ? 'No timer' : difficulty === 'medium' ? '4 minute timer' : '2:30 timer'}</span>
          </div>

          <section className="stats-strip" aria-label="Player stats" data-testid="panel-player-stats">
            <div className="stat-cell"><strong data-testid="text-games-played">{stats.gamesPlayed}</strong><span>games started</span></div>
            <div className="stat-cell"><strong data-testid="text-levels-won">{stats.levelsWon}</strong><span>levels solved</span></div>
            <div className="stat-cell"><strong data-testid="text-total-score">{stats.totalScore.toLocaleString()}</strong><span>total points</span></div>
            <div className="stat-cell"><strong data-testid="text-best-score">{stats.bestScore.toLocaleString()}</strong><span>best score</span></div>
          </section>

          <section id="scoreboard">
            <div className="section-heading"><h2>Recent bests</h2><span>YOUR PERSONAL LEADERBOARD</span></div>
            <div className="leaderboard" data-testid="list-leaderboard">
              <div className="leader-row header"><span>#</span><span>Game</span><span>Difficulty</span><span>Level</span><span>Score</span></div>
              {stats.leaderboard.length ? stats.leaderboard.slice(0, 5).map((entry, index) => (
                <div className="leader-row" key={entry.id} data-testid={`row-score-${entry.id}`}>
                  <span className="leader-rank">{String(index + 1).padStart(2, '0')}</span>
                  <span>{entry.mode === 'slide' ? 'Sliding tiles' : entry.mode === 'memory' ? 'Sequence' : 'Cipher'}</span>
                  <span>{entry.difficulty}</span><span className="mono">{entry.level}</span><span className="mono" style={{ color: '#5edfd7' }}>{entry.score.toLocaleString()}</span>
                </div>
              )) : <div className="empty-leader" data-testid="text-leaderboard-empty">Your first solved level will find a place here.</div>}
            </div>
          </section>
          <footer className="footnote">A QUIET PLACE TO THINK · TANVEER / 01</footer>
        </section>
      ) : (
        <GameView
          session={session}
          bestScore={stats.byMode[session.mode].bestScore}
          onBack={returnHome}
          onPause={pause}
          onHint={hint}
          onUndo={undo}
          onRestart={restart}
          onMove={(index) => {
            const next = moveTile(session, index);
            update(next, next !== session && next.moves !== session.moves ? next.status === 'won' ? 'win' : 'tap' : undefined);
          }}
          onMemoryTap={(index) => {
            const next = tapMemoryTile(session, index);
            update(next, next.feedback === 'wrong' ? 'wrong' : next.status === 'won' ? 'win' : next.moves !== session.moves ? 'tap' : undefined);
          }}
          onCipherChange={(value) => update(setCipherInput(session, value))}
          onCipherSubmit={doCipherSubmit}
          feedbackText={notice}
        />
      )}

      {modal === 'pause' && session && (
        <div className="overlay" role="presentation">
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="pause-heading" data-testid="dialog-pause">
            <div className="dialog-icon"><Pause size={23} /></div>
            <div className="eyebrow">Take your time</div>
            <h2 id="pause-heading">Paused.</h2>
            <p>The clock is stopped. Your puzzle will be right here when you’re ready.</p>
            <div className="dialog-actions">
              <button className="primary-button" onClick={resume} data-testid="button-resume"><Play size={15} /> Back to it</button>
              <button className="quiet-button" onClick={restart} data-testid="button-restart-paused"><RotateCcw size={14} /> Restart</button>
            </div>
            <div className="dialog-actions" style={{ marginTop: 9 }}>
              <button className="quiet-button" onClick={toggleSound} data-testid="button-sound-settings">{sound ? <Volume2 size={14} /> : <VolumeX size={14} />}{sound ? 'Sound on' : 'Sound off'}</button>
              <button className="quiet-button" onClick={returnHome} data-testid="button-quit-game">Leave game</button>
            </div>
          </section>
        </div>
      )}

      {modal === 'instructions' && (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="instructions-heading" data-testid="dialog-instructions">
            <button className="icon-button" style={{ float: 'right' }} onClick={() => setModal(null)} aria-label="Close instructions" data-testid="button-close-instructions"><X size={17} /></button>
            <div className="dialog-icon"><CircleHelp size={23} /></div>
            <div className="eyebrow">Three ways to focus</div>
            <h2 id="instructions-heading">How to play</h2>
            <div className="rules-list">
              <div className="rule"><span>01</span><span><b>Sliding tiles</b> — move neighboring tiles into the empty space until the numbers are in order. Arrow keys work too.</span></div>
              <div className="rule"><span>02</span><span><b>Sequence</b> — watch the glowing pattern, then tap its tiles in the same order. A replay hint shows it again.</span></div>
              <div className="rule"><span>03</span><span><b>Cipher</b> — use the clue to decode the message. Enter submits your answer; spaces and letter case do not matter.</span></div>
              <div className="rule"><span>04</span><span>Hints help you find the next step. You have two per level; using one lowers your score.</span></div>
            </div>
            <div className="dialog-actions"><button className="primary-button" onClick={() => setModal(null)} data-testid="button-got-it">Got it</button></div>
          </section>
        </div>
      )}

      {session?.status === 'won' && (
        <div className="overlay" role="presentation">
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="won-heading" data-testid="dialog-win">
            <div className="dialog-icon" style={{ color: '#70e6b8', borderColor: 'rgba(98,225,181,.3)', background: 'rgba(57,190,146,.09)' }}><Check size={24} /></div>
            <div className="eyebrow" style={{ color: '#68dfad' }}>Level complete</div>
            <h2 id="won-heading">Well thought.</h2>
            <p>You found the pattern. Keep your momentum going.</p>
            <div className="modal-score"><strong>+{Math.max(0, session.lastLevelScore)}</strong><span>POINTS · LEVEL {session.level}</span></div>
            <div className="dialog-actions">
              <button className="primary-button" onClick={() => update(advanceLevel(session))} data-testid="button-next-level">Next level <ChevronRight size={16} /></button>
              <button className="quiet-button" onClick={returnHome} data-testid="button-finish-home">Finish</button>
            </div>
          </section>
        </div>
      )}

      {session?.status === 'failed' && (
        <div className="overlay" role="presentation">
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="timeout-heading" data-testid="dialog-timeout">
            <div className="dialog-icon" style={{ color: '#e99b83', borderColor: 'rgba(233,155,131,.3)', background: 'rgba(200,101,79,.08)' }}><Clock3 size={22} /></div>
            <div className="eyebrow" style={{ color: '#e9a18c' }}>Time is up</div>
            <h2 id="timeout-heading">A close one.</h2>
            <p>Every attempt builds the instinct. Take a breath and give this level another go.</p>
            <div className="dialog-actions">
              <button className="primary-button" onClick={restart} data-testid="button-try-again"><RotateCcw size={15} /> Try again</button>
              <button className="quiet-button" onClick={returnHome} data-testid="button-timeout-home">Back to menu</button>
            </div>
          </section>
        </div>
      )}
      {notice && session?.status === 'playing' && <div className="toast-message" role="status" data-testid="status-hint">{notice}</div>}
    </main>
  );
}

type GameViewProps = {
  session: GameSession;
  bestScore: number;
  onBack: () => void;
  onPause: () => void;
  onHint: () => void;
  onUndo: () => void;
  onRestart: () => void;
  onMove: (index: number) => void;
  onMemoryTap: (index: number) => void;
  onCipherChange: (value: string) => void;
  onCipherSubmit: (event: FormEvent<HTMLFormElement>) => void;
  feedbackText: string;
};

function GameView({ session, bestScore, onBack, onPause, onHint, onUndo, onRestart, onMove, onMemoryTap, onCipherChange, onCipherSubmit, feedbackText }: GameViewProps) {
  const [previewTile, setPreviewTile] = useState<number | null>(null);
  const swipeStart = useRef<{ index: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (session.mode !== 'memory' || !session.previewing || session.paused || session.status !== 'playing') {
      setPreviewTile(null);
      return;
    }
    let step = 0;
    let timeout: number | undefined;
    const showNext = () => {
      if (step >= session.sequence.length) {
        setPreviewTile(null);
        return;
      }
      setPreviewTile(session.sequence[step]);
      timeout = window.setTimeout(() => {
        setPreviewTile(null);
        timeout = window.setTimeout(() => {
          step += 1;
          showNext();
        }, 90);
      }, 330);
    };
    showNext();
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [session.id, session.level, session.previewing, session.paused, session.status, session.hintsUsed, session.sequence]);

  const handleBoardPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-slide-index]');
    if (!button) return;
    swipeStart.current = {
      index: Number(button.dataset.slideIndex),
      x: event.clientX,
      y: event.clientY,
    };
  };
  const handleBoardPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || session.mode !== 'slide') return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    if (session.tiles[start.index] !== 0) {
      onMove(start.index);
      return;
    }
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const target = horizontal
      ? start.index + (dx > 0 ? 1 : -1)
      : start.index + (dy > 0 ? session.size : -session.size);
    if (target >= 0 && target < session.tiles.length) {
      const sameRow = Math.floor(target / session.size) === Math.floor(start.index / session.size);
      if (horizontal && !sameRow) return;
      onMove(target);
    }
  };
  const modeName = session.mode === 'slide' ? 'Sliding tiles' : session.mode === 'memory' ? 'Sequence' : 'Cipher';
  const progress = session.mode === 'memory'
    ? Math.round((session.playerSequence.length / Math.max(session.sequence.length, 1)) * 100)
    : session.mode === 'slide' ? Math.round((session.moves / Math.max(session.size * session.size * 2, 1)) * 100) : Math.min(100, session.moves * 12);
  const feedback = session.feedback === 'correct'
    ? session.status === 'won' ? 'Solved. Excellent focus.' : 'That’s right. Keep going.'
    : session.feedback === 'wrong' ? session.mode === 'memory' ? 'Not quite. Take another look at the pattern.' : 'Not quite. Try another approach.' : feedbackText;
  const remaining = session.timeLimitSeconds === null ? null : Math.max(0, session.timeLimitSeconds - session.elapsedSeconds);

  return (
    <section className="game-layout">
      <div className="game-head">
        <button className="back-button" onClick={onBack} data-testid="button-back-menu"><ArrowLeft size={16} /> All puzzles</button>
        <div className="game-head-title"><span className="eyebrow">TANVEER / 01</span><h1>{modeName}</h1></div>
        <span className="pill">{session.difficulty.toUpperCase()} · {session.size}×{session.size}</span>
      </div>
      <div className="game-content">
        <section className="play-panel" aria-label={`${modeName} game`}>
          <div className="game-toolbar">
            <span className="level-tag">LEVEL {String(session.level).padStart(2, '0')} <span style={{ color: '#506266' }}>/</span> {session.mode === 'memory' ? 'PATTERN RECALL' : session.mode === 'cipher' ? 'DECODE THE MESSAGE' : 'RESTORE THE ORDER'}</span>
            <div className="toolbar-actions">
              <button className="icon-button" onClick={onUndo} disabled={session.history.length === 0} aria-label="Undo move" title="Undo" data-testid="button-undo"><RotateCcw size={15} /></button>
              <button className="icon-button" onClick={() => setLocalRules(true)} aria-label="Show game instructions" title="Instructions" data-testid="button-game-help"><CircleHelp size={15} /></button>
              <button className="icon-button" onClick={onPause} aria-label="Pause game" title="Pause" data-testid="button-pause"><Pause size={15} /></button>
            </div>
          </div>
          {session.mode === 'slide' && (
            <div className="game-board-wrap">
                <div className="slide-board" style={{ gridTemplateColumns: `repeat(${session.size}, minmax(0, 1fr))` }} role="grid" aria-label="Sliding tile board" data-testid="board-sliding" onPointerDown={handleBoardPointerDown} onPointerUp={handleBoardPointerUp} onPointerCancel={() => { swipeStart.current = null; }}>
                {session.tiles.map((tile, index) => {
                  const blank = session.tiles.indexOf(0);
                  const adjacent = Math.abs(Math.floor(index / session.size) - Math.floor(blank / session.size)) + Math.abs(index % session.size - blank % session.size) === 1;
                  return <button key={`${session.id}-tile-${index}`} className="slide-tile" onClick={() => onMove(index)} disabled={tile === 0 || !adjacent || session.paused} aria-label={tile === 0 ? 'Empty space' : `Move tile ${tile}`} data-slide-index={index} data-testid={`tile-slide-${index}`} role="gridcell">{tile || ''}</button>;
                })}
              </div>
            </div>
          )}
          {session.mode === 'memory' && (
            <>
              <p className="memory-instruction" data-testid="text-memory-instruction">{session.previewing ? 'Watch closely. The pattern will disappear in a moment.' : 'Repeat the sequence in the same order.'}</p>
              <div className="game-board-wrap">
                <div className="memory-board" style={{ gridTemplateColumns: `repeat(${session.size}, minmax(0, 1fr))` }} role="grid" aria-label="Memory sequence board" data-testid="board-memory">
                  {Array.from({ length: session.size * session.size }, (_, index) => {
                    const isTarget = session.previewing && previewTile === index;
                    const isSelected = session.playerSequence.includes(index);
                    return <button key={`${session.id}-memory-${index}`} className={`memory-tile ${isTarget ? 'target' : ''} ${isSelected ? 'selected' : ''} ${session.feedback === 'wrong' && !session.previewing ? 'wrong' : ''}`} onClick={() => onMemoryTap(index)} disabled={session.previewing || session.paused} aria-label={`Memory tile ${index + 1}${isTarget ? ', pattern tile' : ''}`} data-testid={`tile-memory-${index}`} role="gridcell" />;
                  })}
                </div>
              </div>
              {session.previewing && <div className="preview-meter" aria-label="Pattern preview timer"><span key={`${session.id}-${session.level}-${session.hintsUsed}`} style={{ animationDuration: `${Math.max(1300, session.sequence.length * 420 + 300)}ms` }} /></div>}
            </>
          )}
          {session.mode === 'cipher' && (
            <div className="game-board-wrap">
              <div className="cipher-card">
                <div className="cipher-label">A clue for you</div>
                <p className="cipher-clue" data-testid="text-cipher-clue">{session.cipher?.clue}</p>
                <div className="cipher-label" style={{ marginBottom: 9 }}>Encoded message</div>
                <div className="encoded-box" data-testid="text-cipher-encoded">{session.cipher?.encoded}</div>
                <form className="answer-form" onSubmit={onCipherSubmit}>
                  <input className="answer-input" value={session.cipherInput} onChange={(event) => onCipherChange(event.target.value)} placeholder="Your decoded phrase" aria-label="Decoded answer" disabled={session.paused} autoComplete="off" data-testid="input-cipher-answer" />
                  <button className="primary-button" type="submit" disabled={!session.cipherInput.trim() || session.paused} data-testid="button-submit-cipher">Check <ArrowRight size={15} /></button>
                </form>
                <div className={`feedback ${session.feedback === 'correct' ? 'good' : session.feedback === 'wrong' ? 'bad' : ''}`} role="status" data-testid="status-cipher-feedback">{feedback}</div>
              </div>
            </div>
          )}
          {session.mode !== 'cipher' && <div className={`feedback ${session.feedback === 'correct' ? 'good' : session.feedback === 'wrong' ? 'bad' : ''}`} role="status" data-testid="status-game-feedback">{feedback || (session.mode === 'slide' ? 'Tap a tile beside the empty space · arrow keys also work' : 'Each correct tile reveals the next step')}</div>}
        </section>
        <aside className="side-panel" aria-label="Game status and actions">
          <h2 className="side-title">Your run</h2>
          <div className="metric-grid">
            <div className="metric"><span>Time</span><strong className={`timer ${remaining !== null && remaining < 30 ? 'urgent' : ''}`} data-testid="text-game-time">{remaining === null ? formatTime(session.elapsedSeconds) : formatTime(remaining)}</strong></div>
            <div className="metric"><span>Moves</span><strong data-testid="text-game-moves">{session.moves}</strong></div>
            <div className="metric"><span>Score</span><strong data-testid="text-game-score">{session.score.toLocaleString()}</strong></div>
            <div className="metric"><span>Hints left</span><strong data-testid="text-hints-left">{session.hintsRemaining}</strong></div>
          </div>
          <div className="progress-wrap">
            <div className="progress-label"><span>{session.mode === 'memory' ? 'Sequence' : 'Level'} progress</span><span className="mono">{session.mode === 'memory' ? `${session.playerSequence.length}/${session.sequence.length}` : `${Math.min(progress, 100)}%`}</span></div>
            <div className="progress-track" aria-label="Level progress"><span style={{ width: `${session.mode === 'memory' ? progress : progress}%` }} /></div>
          </div>
          <div className="side-divider" />
          <div className="hint-box" data-testid="panel-hint"><strong>Small nudge</strong>{session.mode === 'cipher' ? 'A clue is waiting if you need to shift your perspective.' : session.mode === 'memory' ? 'Try grouping the pattern into short runs.' : 'Look for a tile that is already close to its final position.'}</div>
          <div className="side-buttons">
            <button className="quiet-button" onClick={onHint} disabled={session.hintsRemaining === 0 || session.paused} data-testid="button-use-hint"><Lightbulb size={14} /> Get a hint</button>
            {session.mode === 'memory'
              ? <button className="quiet-button" onClick={onHint} disabled={session.hintsRemaining === 0 || session.previewing || session.paused} data-testid="button-replay-sequence"><RotateCcw size={14} /> Replay · hint</button>
              : <button className="quiet-button" onClick={onRestart} disabled={session.paused} data-testid="button-restart-level"><RotateCcw size={14} /> Restart</button>}
          </div>
          <div className="side-divider" />
          <div className="progress-label"><span>Difficulty</span><span style={{ color: '#dcebea', textTransform: 'capitalize' }}>{session.difficulty}</span></div>
          {session.timeLimitSeconds !== null && <div className="progress-label" style={{ marginTop: 10 }}><span>Time limit</span><span className="mono">{formatTime(session.timeLimitSeconds)}</span></div>}
          <div className="progress-label" style={{ marginTop: 10 }}><span>Best in this mode</span><span className="mono" style={{ color: '#63ded7' }}>{bestScore.toLocaleString()}</span></div>
        </aside>
      </div>
      <GameInstructionsInline />
    </section>
  );
}

function setLocalRules(open: boolean) {
  window.dispatchEvent(new CustomEvent('tanveer-instructions', { detail: open }));
}

function GameInstructionsInline() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener('tanveer-instructions', handler);
    return () => window.removeEventListener('tanveer-instructions', handler);
  }, []);
  if (!visible) return null;
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setVisible(false); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="inline-rules-heading" data-testid="dialog-game-instructions">
        <button className="icon-button" style={{ float: 'right' }} onClick={() => setVisible(false)} aria-label="Close instructions" data-testid="button-close-game-instructions"><X size={17} /></button>
        <div className="dialog-icon"><ListOrdered size={23} /></div>
        <div className="eyebrow">A quick refresher</div>
        <h2 id="inline-rules-heading">How this one works</h2>
        <div className="rules-list">
          <div className="rule"><span>01</span><span>Take one move at a time. Your progress is saved for this run.</span></div>
          <div className="rule"><span>02</span><span>Hints reveal a useful next step, but spend some of your score.</span></div>
          <div className="rule"><span>03</span><span>Pause any time if you need a moment. The clock pauses with you.</span></div>
        </div>
        <div className="dialog-actions"><button className="primary-button" onClick={() => setVisible(false)} data-testid="button-close-rules">Understood</button></div>
      </section>
    </div>
  );
}

export default App;
