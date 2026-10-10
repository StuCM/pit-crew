// What `crew tasks --json` answers, and what the pane keeps between draws.

export type PitTask = {
  id: string;
  title: string;
  status: string;
  path: string;
  branch: string;
  hasBranch: boolean;
  model: string;
  files: string[];
  rounds: number;
  waitsOnUser: string | null;
  inFlight: boolean;
  terminal: boolean;
  worktree: string | null;
  plannedWorktree: string;
  ahead: number;
  uncommitted: number;
  brief: string;
};

export type PitCheckout = { task: string; branch: string; tip: string; bench: string };

export type PitSnapshot = {
  project: string;
  root: string;
  /** The main checkout: the orchestrator's, as against a task worktree. */
  main: string;
  baseBranch: string;
  reviewRounds: number;
  checkout: PitCheckout | null;
  tasks: PitTask[];
};

/** The outcome of the last press, drawn under the header until dismissed. */
export type PitNotice = {
  tone: 'ok' | 'warn' | 'error';
  title: string;
  lines: string[];
  /** Something to copy: the brief a new session starts with. */
  code?: string;
  /** A refused dispatch the person may push through. */
  forceId?: string;
};

export type PitSpec = { id: string; text: string };

declare module 'claude-code' {
  interface PluginState {
    'pit-wall': {
      snapshot: PitSnapshot | null;
      error: string | null;
      notice: PitNotice | null;
      busy: string | null;
      spec: PitSpec | null;
      isOpen: boolean;
    };
  }
}
