export type AnalysisPhaseDetail = {
  analyzing: boolean;
  queueLength: number;
};

export type PhaseController = {
  start: () => void;
  reset: () => void;
  handlePoll: (detail: AnalysisPhaseDetail) => void;
  isActive: () => boolean;
  refresh: () => void;
};

const PHASE_LABELS = ['Answer sent', 'Preparing analysis', 'Correction on the way', 'Ready'] as const;
const LAST_PHASE = PHASE_LABELS.length - 1;
const FIRST_STEP_MS = 1400;
const MIN_PHASE_MS = 1200;
const TICK_MS = 250;

export function createPhaseController(
  getStatusEl: () => HTMLElement | null,
  idleText: string,
  isRecording: () => boolean
): PhaseController {
  let active = false;
  let shown = 0;
  let target = 0;
  let lastAdvance = 0;
  let stepTimeout: ReturnType<typeof setTimeout> | null = null;
  let tickInterval: ReturnType<typeof setInterval> | null = null;

  function clearTimers() {
    if (stepTimeout) {
      clearTimeout(stepTimeout);
      stepTimeout = null;
    }
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function render() {
    if (isRecording()) return;
    const el = getStatusEl();
    if (!el) return;
    el.textContent = PHASE_LABELS[shown];
  }

  function maybeAdvance() {
    if (!active) return;
    if (shown >= target) {
      if (target >= LAST_PHASE && tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
      return;
    }
    if (Date.now() - lastAdvance < MIN_PHASE_MS) return;
    shown += 1;
    lastAdvance = Date.now();
    render();
    if (shown >= LAST_PHASE && tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function start() {
    clearTimers();
    active = true;
    shown = 0;
    target = 0;
    lastAdvance = Date.now();
    render();
    stepTimeout = setTimeout(() => {
      stepTimeout = null;
      if (!active) return;
      if (target < 1) target = 1;
      maybeAdvance();
    }, FIRST_STEP_MS);
    tickInterval = setInterval(maybeAdvance, TICK_MS);
  }

  function handlePoll(detail: AnalysisPhaseDetail) {
    if (!active || isRecording()) return;
    if (detail.analyzing || detail.queueLength > 0) {
      if (target < 2) target = 2;
    } else {
      target = LAST_PHASE;
    }
    maybeAdvance();
  }

  function reset() {
    clearTimers();
    active = false;
    shown = 0;
    target = 0;
    if (!isRecording()) {
      const el = getStatusEl();
      if (el) el.textContent = idleText;
    }
  }

  function refresh() {
    if (active) render();
  }

  return { start, reset, handlePoll, isActive: () => active, refresh };
}
