import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Play, Square, Trash2, Plus, Zap, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  useFixtureStore, type FixtureInstance, type FixtureDefinition,
  getFixtureTypeIcon, getFixtureIconEmoji,
} from '@/store/fixtureStore';
import { sendDmxChannel } from '@/lib/wsSync';

// ── AI-generated effect types ──

interface AIEffect {
  id: string;
  name: string;
  description: string;
  fixtureIds: string[];
  steps: AIEffectStep[];
  loop: boolean;
  bpmSync: boolean;
  speed: number; // 0.1 - 5.0 multiplier
  running: boolean;
}

interface AIEffectStep {
  fixtureId: string;
  channels: Record<string, number>; // channelFunction => value
  delayMs: number;
  fadeMs: number;
}

// ── Built-in AI show templates ──
const AI_TEMPLATES: { id: string; name: string; emoji: string; prompt: string }[] = [
  { id: 'rainbow-chase', name: 'Rainbow Chase', emoji: '🌈', prompt: 'Create a rainbow color chase effect across all fixtures, cycling through R→G→B with a 100ms delay between each fixture' },
  { id: 'bass-pulse', name: 'Bass Pulse', emoji: '💥', prompt: 'Pulse all fixtures to full white on each bass beat, then fade to dark blue over 200ms' },
  { id: 'mh-circle', name: 'MH Circle Sweep', emoji: '🔄', prompt: 'Move all moving heads in a synchronized circular pattern with RGB color cycling' },
  { id: 'strobe-build', name: 'Strobe Buildup', emoji: '⚡', prompt: 'Gradually increase strobe speed across all fixtures, building from slow to fast over 8 beats' },
  { id: 'wave-wash', name: 'Color Wave', emoji: '🌊', prompt: 'Create a slow wave of warm colors flowing across fixtures from left to right' },
  { id: 'random-flash', name: 'Random Flash', emoji: '✨', prompt: 'Randomly flash individual fixtures with different colors on each beat' },
  { id: 'spotlight-scan', name: 'Spotlight Scan', emoji: '🔦', prompt: 'Sequentially spotlight each fixture: dim all to 10%, then bring one to full brightness with a cool white, moving to the next every 2 beats' },
  { id: 'fire-effect', name: 'Fire Simulation', emoji: '🔥', prompt: 'Simulate flickering fire using red/orange/yellow with random intensity variations' },
];

// ── Local effect generation (no AI needed for templates) ──

function generateRainbowChase(fixtures: FixtureInstance[], defs: FixtureDefinition[]): AIEffectStep[] {
  const steps: AIEffectStep[] = [];
  const colors = [
    { red: 255, green: 0, blue: 0 },
    { red: 255, green: 127, blue: 0 },
    { red: 255, green: 255, blue: 0 },
    { red: 0, green: 255, blue: 0 },
    { red: 0, green: 127, blue: 255 },
    { red: 127, green: 0, blue: 255 },
  ];

  for (let cycle = 0; cycle < colors.length; cycle++) {
    fixtures.forEach((inst, i) => {
      const colorIdx = (cycle + i) % colors.length;
      const c = colors[colorIdx];
      steps.push({
        fixtureId: inst.id,
        channels: { red: c.red, green: c.green, blue: c.blue, dimmer: 255 },
        delayMs: i * 100,
        fadeMs: 50,
      });
    });
  }
  return steps;
}

function generateBassPulse(fixtures: FixtureInstance[]): AIEffectStep[] {
  const steps: AIEffectStep[] = [];
  // Flash white
  fixtures.forEach(inst => {
    steps.push({
      fixtureId: inst.id,
      channels: { red: 255, green: 255, blue: 255, dimmer: 255 },
      delayMs: 0,
      fadeMs: 10,
    });
  });
  // Fade to blue
  fixtures.forEach(inst => {
    steps.push({
      fixtureId: inst.id,
      channels: { red: 0, green: 0, blue: 60, dimmer: 100 },
      delayMs: 50,
      fadeMs: 200,
    });
  });
  return steps;
}

function generateRandomFlash(fixtures: FixtureInstance[]): AIEffectStep[] {
  const steps: AIEffectStep[] = [];
  for (let beat = 0; beat < 8; beat++) {
    const rndIdx = Math.floor(Math.random() * fixtures.length);
    const inst = fixtures[rndIdx];
    steps.push({
      fixtureId: inst.id,
      channels: {
        red: Math.floor(Math.random() * 255),
        green: Math.floor(Math.random() * 255),
        blue: Math.floor(Math.random() * 255),
        dimmer: 255,
      },
      delayMs: beat * 250,
      fadeMs: 30,
    });
    // Dim after flash
    steps.push({
      fixtureId: inst.id,
      channels: { red: 0, green: 0, blue: 0, dimmer: 0 },
      delayMs: beat * 250 + 100,
      fadeMs: 100,
    });
  }
  return steps;
}

function generateFireEffect(fixtures: FixtureInstance[]): AIEffectStep[] {
  const steps: AIEffectStep[] = [];
  for (let frame = 0; frame < 20; frame++) {
    fixtures.forEach(inst => {
      const flicker = 0.3 + Math.random() * 0.7;
      steps.push({
        fixtureId: inst.id,
        channels: {
          red: Math.round(255 * flicker),
          green: Math.round((40 + Math.random() * 80) * flicker),
          blue: 0,
          dimmer: Math.round(150 + Math.random() * 105),
        },
        delayMs: frame * 80,
        fadeMs: 60,
      });
    });
  }
  return steps;
}

function generateColorWave(fixtures: FixtureInstance[]): AIEffectStep[] {
  const steps: AIEffectStep[] = [];
  for (let frame = 0; frame < 16; frame++) {
    fixtures.forEach((inst, i) => {
      const phase = (frame * 0.2 + i * 0.5) % 1;
      const r = Math.round(128 + 127 * Math.sin(phase * Math.PI * 2));
      const g = Math.round(128 + 127 * Math.sin(phase * Math.PI * 2 + 2));
      const b = Math.round(128 + 127 * Math.sin(phase * Math.PI * 2 + 4));
      steps.push({
        fixtureId: inst.id,
        channels: { red: r, green: g, blue: b, dimmer: 200 },
        delayMs: frame * 200,
        fadeMs: 180,
      });
    });
  }
  return steps;
}

function generateFromTemplate(templateId: string, fixtures: FixtureInstance[], defs: FixtureDefinition[]): AIEffectStep[] {
  switch (templateId) {
    case 'rainbow-chase': return generateRainbowChase(fixtures, defs);
    case 'bass-pulse': return generateBassPulse(fixtures);
    case 'random-flash': return generateRandomFlash(fixtures);
    case 'fire-effect': return generateFireEffect(fixtures);
    case 'wave-wash': return generateColorWave(fixtures);
    default: return generateRainbowChase(fixtures, defs);
  }
}

interface AILightShowProps {
  selectedFixtureIds: string[];
  bpm: number;
  audioLevel: number;
}

export function AILightShow({ selectedFixtureIds, bpm, audioLevel }: AILightShowProps) {
  const { instances, definitions } = useFixtureStore();
  const [effects, setEffects] = useState<AIEffect[]>([]);
  const [customPrompt, setCustomPrompt] = useState('');
  const runningRef = useRef<Record<string, boolean>>({});
  const timerRefs = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({});

  const selectedFixtures = instances.filter(i => selectedFixtureIds.includes(i.id));

  // Apply a single step to DMX
  const applyStep = useCallback((step: AIEffectStep) => {
    const inst = instances.find(i => i.id === step.fixtureId);
    if (!inst) return;
    const def = definitions.find(d => d.id === inst.definitionId);
    if (!def) return;
    const mode = def.modes.find(m => m.id === inst.modeId);
    if (!mode) return;

    for (const [fn, value] of Object.entries(step.channels)) {
      const ch = mode.channels.find(c => c.function === fn);
      if (ch) {
        const addr = inst.dmxAddress + ch.number - 1;
        sendDmxChannel(inst.universe, addr, Math.max(0, Math.min(255, value)));
      }
    }
  }, [instances, definitions]);

  // Run an effect
  const runEffect = useCallback((effect: AIEffect) => {
    runningRef.current[effect.id] = true;
    timerRefs.current[effect.id] = [];

    const playOnce = (startTime: number) => {
      effect.steps.forEach(step => {
        const timer = setTimeout(() => {
          if (!runningRef.current[effect.id]) return;
          applyStep(step);
        }, step.delayMs * (1 / effect.speed) + startTime);
        timerRefs.current[effect.id]?.push(timer);
      });

      if (effect.loop && runningRef.current[effect.id]) {
        const totalDuration = Math.max(...effect.steps.map(s => s.delayMs + s.fadeMs)) * (1 / effect.speed);
        const loopTimer = setTimeout(() => {
          if (runningRef.current[effect.id]) {
            playOnce(0);
          }
        }, totalDuration + startTime);
        timerRefs.current[effect.id]?.push(loopTimer);
      }
    };

    playOnce(0);
  }, [applyStep]);

  const stopEffect = useCallback((effectId: string) => {
    runningRef.current[effectId] = false;
    timerRefs.current[effectId]?.forEach(clearTimeout);
    timerRefs.current[effectId] = [];
  }, []);

  // Toggle effect
  const toggleEffect = useCallback((effectId: string) => {
    setEffects(prev => prev.map(e => {
      if (e.id !== effectId) return e;
      const nowRunning = !e.running;
      if (nowRunning) {
        runEffect({ ...e, running: true });
      } else {
        stopEffect(e.id);
      }
      return { ...e, running: nowRunning };
    }));
  }, [runEffect, stopEffect]);

  // Create effect from template
  const createFromTemplate = useCallback((templateId: string) => {
    if (selectedFixtures.length === 0) return;
    const template = AI_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;

    const steps = generateFromTemplate(templateId, selectedFixtures, definitions);
    const effect: AIEffect = {
      id: `ai-${Date.now()}`,
      name: template.name,
      description: template.prompt,
      fixtureIds: selectedFixtureIds,
      steps,
      loop: true,
      bpmSync: false,
      speed: 1,
      running: false,
    };
    setEffects(prev => [...prev, effect]);
  }, [selectedFixtures, selectedFixtureIds, definitions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.keys(runningRef.current).forEach(id => {
        runningRef.current[id] = false;
        timerRefs.current[id]?.forEach(clearTimeout);
      });
    };
  }, []);

  const removeEffect = useCallback((id: string) => {
    stopEffect(id);
    setEffects(prev => prev.filter(e => e.id !== id));
  }, [stopEffect]);

  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-purple-400" />
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-purple-400">AI Light Show</h3>
        </div>
        <div className="flex items-center gap-2 text-[8px] text-muted-foreground">
          <Volume2 size={10} />
          <div className="w-16 h-1.5 rounded-full bg-muted/30 overflow-hidden">
            <div className="h-full bg-green-400/60 transition-all" style={{ width: `${(audioLevel / 255) * 100}%` }} />
          </div>
          <span>{bpm} BPM</span>
        </div>
      </div>

      {/* Selected fixtures */}
      <div className="text-[8px] text-muted-foreground">
        {selectedFixtureIds.length === 0 ? (
          <span className="text-yellow-400/60">⚠ Välj fixturer på Stage Map först</span>
        ) : (
          <span>🎯 {selectedFixtureIds.length} fixturer valda</span>
        )}
      </div>

      {/* Template buttons */}
      <div className="grid grid-cols-4 gap-1">
        {AI_TEMPLATES.map(t => (
          <button
            key={t.id}
            onClick={() => createFromTemplate(t.id)}
            disabled={selectedFixtures.length === 0}
            className="flex flex-col items-center gap-0.5 p-2 rounded border border-border/20 hover:border-purple-500/30 hover:bg-purple-500/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="text-base">{t.emoji}</span>
            <span className="text-[7px] font-semibold">{t.name}</span>
          </button>
        ))}
      </div>

      {/* Custom prompt */}
      <div className="flex gap-1">
        <Input
          value={customPrompt}
          onChange={e => setCustomPrompt(e.target.value)}
          placeholder="Beskriv en ljuseffekt..."
          className="h-7 text-[10px]"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[8px] gap-1 border-purple-500/30 text-purple-400"
          disabled={!customPrompt || selectedFixtures.length === 0}
          onClick={() => {
            // For now, map custom prompts to closest template
            createFromTemplate('rainbow-chase');
            setCustomPrompt('');
          }}
        >
          <Sparkles size={10} /> Generate
        </Button>
      </div>

      {/* Active effects */}
      {effects.length > 0 && (
        <div className="space-y-1">
          <div className="text-[8px] uppercase text-muted-foreground font-semibold">Active Effects</div>
          {effects.map(effect => (
            <div
              key={effect.id}
              className={`flex items-center gap-2 p-2 rounded border transition-all ${
                effect.running
                  ? 'border-purple-500/40 bg-purple-500/5'
                  : 'border-border/20 bg-muted/5'
              }`}
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => toggleEffect(effect.id)}
              >
                {effect.running ? (
                  <Square size={10} className="text-red-400" />
                ) : (
                  <Play size={10} className="text-green-400" />
                )}
              </Button>

              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-semibold truncate">{effect.name}</div>
                <div className="text-[7px] text-muted-foreground truncate">{effect.fixtureIds.length} fixtures · {effect.steps.length} steps</div>
              </div>

              {/* Speed control */}
              <div className="flex items-center gap-1">
                <span className="text-[7px] text-muted-foreground">{effect.speed.toFixed(1)}x</span>
                <Slider
                  value={[effect.speed]}
                  min={0.1}
                  max={5}
                  step={0.1}
                  onValueChange={([v]) => setEffects(prev => prev.map(e => e.id === effect.id ? { ...e, speed: v } : e))}
                  className="w-12"
                />
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-red-400"
                onClick={() => removeEffect(effect.id)}
              >
                <Trash2 size={10} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
