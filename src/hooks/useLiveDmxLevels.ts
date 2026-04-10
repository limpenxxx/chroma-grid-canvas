import { useState, useEffect, useRef } from 'react';
import { onEngineMessage } from '@/lib/wsSync';

/**
 * Hook that subscribes to live DMX levels broadcast by the engine.
 * Returns a Record<string, number> keyed as "universe:channel" → value.
 * Only re-renders when the data actually changes (~10fps max from engine).
 */
export function useLiveDmxLevels(): Record<string, number> {
  const [levels, setLevels] = useState<Record<string, number>>({});
  const ref = useRef(levels);

  useEffect(() => {
    const unsub = onEngineMessage((msg: any) => {
      if (msg.type !== 'dmx-levels' || !msg.levels) return;
      const flat: Record<string, number> = {};
      for (const [uni, channels] of Object.entries(msg.levels as Record<string, Record<string, number>>)) {
        for (const [ch, val] of Object.entries(channels)) {
          flat[`${uni}:${ch}`] = val;
        }
      }
      ref.current = flat;
      setLevels(flat);
    });
    return unsub;
  }, []);

  return levels;
}
