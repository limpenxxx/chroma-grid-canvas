/**
 * Web MIDI API hook for AKAI MPD218 and similar pad controllers.
 * 
 * MPD218 layout (per bank A/B/C):
 *   Pads 1-16: Note On/Off (velocity-sensitive)
 *   Knobs K1-K6: CC messages
 * 
 * Bank A default: Pads = notes 36-51, Knobs CC 3,9,12,13,14,15
 * Bank B default: Pads = notes 36-51, Knobs CC 16,17,18,19,20,21
 * Bank C default: Pads = notes 36-51, Knobs CC 22,23,24,25,26,27
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface MidiMapping {
  id: string;
  /** 'pad' for note triggers, 'knob' for CC faders */
  inputType: 'pad' | 'knob';
  /** MIDI channel (0-15) */
  channel: number;
  /** Note number (pads) or CC number (knobs) */
  noteOrCC: number;
  /** What this maps to */
  targetType: 'widget' | 'page' | 'master-dimmer' | 'blackout' | 'bpm-tap';
  /** Widget ID if targetType === 'widget' */
  targetWidgetId?: string;
  /** Page ID if targetType === 'page' */
  targetPageId?: string;
  /** For knobs mapped to sliders: which parameter */
  paramName?: string;
  /** Human label */
  label?: string;
}

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  connected: boolean;
}

export interface MidiEvent {
  type: 'noteon' | 'noteoff' | 'cc';
  channel: number;
  note: number;    // note number or CC number
  velocity: number; // velocity or CC value
  timestamp: number;
}

interface UseMidiControllerOptions {
  onPadPress?: (mapping: MidiMapping, velocity: number) => void;
  onPadRelease?: (mapping: MidiMapping) => void;
  onKnobChange?: (mapping: MidiMapping, value: number) => void;
  onRawMidi?: (event: MidiEvent) => void;
}

const STORAGE_KEY = 'stokio-midi-mappings';

function loadMappings(): MidiMapping[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveMappings(mappings: MidiMapping[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
}

export function useMidiController(options: UseMidiControllerOptions = {}) {
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [mappings, setMappings] = useState<MidiMapping[]>(loadMappings);
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [midiSupported] = useState(() => !!navigator.requestMIDIAccess);
  const [isLearning, setIsLearning] = useState(false);
  const [lastEvent, setLastEvent] = useState<MidiEvent | null>(null);
  const [learnTarget, setLearnTarget] = useState<Partial<MidiMapping> | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mappingsRef = useRef(mappings);
  mappingsRef.current = mappings;

  // Persist mappings
  useEffect(() => { saveMappings(mappings); }, [mappings]);

  // Request MIDI access
  useEffect(() => {
    if (!midiSupported) return;
    navigator.requestMIDIAccess({ sysex: false }).then(access => {
      setMidiAccess(access);
      updateDeviceList(access);
      access.onstatechange = () => updateDeviceList(access);
    }).catch(err => {
      console.warn('[MIDI] Access denied:', err);
    });
  }, [midiSupported]);

  const updateDeviceList = (access: MIDIAccess) => {
    const devs: MidiDevice[] = [];
    access.inputs.forEach(input => {
      devs.push({
        id: input.id,
        name: input.name || 'Unknown',
        manufacturer: input.manufacturer || '',
        connected: input.state === 'connected',
      });
    });
    setDevices(devs);
  };

  // Listen to MIDI messages
  useEffect(() => {
    if (!midiAccess) return;

    const handleMessage = (e: MIDIMessageEvent) => {
      const data = e.data;
      if (!data || data.length < 3) return;

      const status = data[0];
      const channel = status & 0x0F;
      const msgType = status & 0xF0;
      const note = data[1];
      const velocity = data[2];

      let event: MidiEvent | null = null;

      if (msgType === 0x90 && velocity > 0) {
        event = { type: 'noteon', channel, note, velocity, timestamp: Date.now() };
      } else if (msgType === 0x80 || (msgType === 0x90 && velocity === 0)) {
        event = { type: 'noteoff', channel, note, velocity: 0, timestamp: Date.now() };
      } else if (msgType === 0xB0) {
        event = { type: 'cc', channel, note, velocity, timestamp: Date.now() };
      }

      if (!event) return;

      setLastEvent(event);
      optionsRef.current.onRawMidi?.(event);

      // If learning mode, capture this event
      if (isLearning && learnTarget) {
        // Don't capture noteoff for learning
        if (event.type === 'noteoff') return;
        
        const newMapping: MidiMapping = {
          id: `midi-${Date.now()}`,
          inputType: event.type === 'cc' ? 'knob' : 'pad',
          channel: event.channel,
          noteOrCC: event.note,
          targetType: learnTarget.targetType || 'widget',
          targetWidgetId: learnTarget.targetWidgetId,
          targetPageId: learnTarget.targetPageId,
          paramName: learnTarget.paramName,
          label: learnTarget.label || `${event.type === 'cc' ? 'Knob' : 'Pad'} ${event.note}`,
        };
        
        // Replace existing mapping for same input or add new
        setMappings(prev => {
          const filtered = prev.filter(m =>
            !(m.channel === newMapping.channel && m.noteOrCC === newMapping.noteOrCC && m.inputType === newMapping.inputType)
          );
          return [...filtered, newMapping];
        });
        setIsLearning(false);
        setLearnTarget(null);
        return;
      }

      // Dispatch to mapped targets
      const currentMappings = mappingsRef.current;
      for (const mapping of currentMappings) {
        if (mapping.channel !== event.channel) continue;
        if (mapping.noteOrCC !== event.note) continue;

        if (mapping.inputType === 'pad') {
          if (event.type === 'noteon') {
            optionsRef.current.onPadPress?.(mapping, event.velocity);
          } else if (event.type === 'noteoff') {
            optionsRef.current.onPadRelease?.(mapping);
          }
        } else if (mapping.inputType === 'knob' && event.type === 'cc') {
          optionsRef.current.onKnobChange?.(mapping, event.velocity);
        }
      }
    };

    midiAccess.inputs.forEach(input => {
      input.onmidimessage = handleMessage;
    });

    return () => {
      midiAccess.inputs.forEach(input => {
        input.onmidimessage = null;
      });
    };
  }, [midiAccess, isLearning, learnTarget]);

  const startLearn = useCallback((target: Partial<MidiMapping>) => {
    setLearnTarget(target);
    setIsLearning(true);
  }, []);

  const cancelLearn = useCallback(() => {
    setIsLearning(false);
    setLearnTarget(null);
  }, []);

  const removeMapping = useCallback((id: string) => {
    setMappings(prev => prev.filter(m => m.id !== id));
  }, []);

  const clearAllMappings = useCallback(() => {
    setMappings([]);
  }, []);

  const updateMapping = useCallback((id: string, updates: Partial<MidiMapping>) => {
    setMappings(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  return {
    devices,
    mappings,
    midiSupported,
    isLearning,
    lastEvent,
    learnTarget,
    startLearn,
    cancelLearn,
    removeMapping,
    clearAllMappings,
    updateMapping,
    setMappings,
  };
}
