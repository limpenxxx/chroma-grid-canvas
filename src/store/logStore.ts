import { create } from 'zustand';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'dmx' | 'wled' | 'ai';

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

interface LogState {
  entries: LogEntry[];
  maxEntries: number;
  addLog: (level: LogLevel, source: string, message: string, data?: unknown) => void;
  clearLogs: () => void;
}

let _counter = 0;

export const useLogStore = create<LogState>()((set, get) => ({
  entries: [],
  maxEntries: 2000,
  addLog: (level, source, message, data) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${_counter++}`,
      ts: Date.now(),
      level,
      source,
      message,
      data,
    };
    set((s) => ({
      entries: [...s.entries.slice(-(s.maxEntries - 1)), entry],
    }));
  },
  clearLogs: () => set({ entries: [] }),
}));

/** Shorthand logger */
export const syslog = {
  info: (src: string, msg: string, data?: unknown) => useLogStore.getState().addLog('info', src, msg, data),
  warn: (src: string, msg: string, data?: unknown) => useLogStore.getState().addLog('warn', src, msg, data),
  error: (src: string, msg: string, data?: unknown) => useLogStore.getState().addLog('error', src, msg, data),
  debug: (src: string, msg: string, data?: unknown) => useLogStore.getState().addLog('debug', src, msg, data),
  dmx: (src: string, msg: string, data?: unknown) => useLogStore.getState().addLog('dmx', src, msg, data),
  wled: (src: string, msg: string, data?: unknown) => useLogStore.getState().addLog('wled', src, msg, data),
  ai: (src: string, msg: string, data?: unknown) => useLogStore.getState().addLog('ai', src, msg, data),
};
