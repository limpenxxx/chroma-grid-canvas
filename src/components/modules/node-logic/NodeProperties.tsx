import { X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { LogicNode, NodeConfig } from './types';
import { CATEGORY_META } from './types';
import { generateESPHomeFirmware, generateWLEDUsermod } from './firmwareGenerator';

interface Props {
  node: LogicNode;
  allEsp32Nodes: LogicNode[];
  onUpdate: (config: Partial<NodeConfig>) => void;
  onClose: () => void;
}

export function NodeProperties({ node, allEsp32Nodes, onUpdate, onClose }: Props) {
  const meta = CATEGORY_META[node.category];

  const downloadFirmware = (type: 'esphome' | 'wled-usermod') => {
    const code = type === 'esphome'
      ? generateESPHomeFirmware(allEsp32Nodes)
      : generateWLEDUsermod(allEsp32Nodes);
    const ext = type === 'esphome' ? 'yaml' : 'h';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sflc_gpio.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="absolute right-0 top-0 z-20 w-72 h-full border-l border-border/30 p-4 overflow-y-auto backdrop-blur-xl bg-background/90">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: node.color }} />
          <span className="text-xs font-semibold" style={{ color: node.color }}>{node.name}</span>
        </div>
        <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={14} /></button>
      </div>

      <div className="text-[8px] uppercase tracking-wider text-muted-foreground/60 mb-3">
        {meta.icon} {meta.label}
      </div>

      <div className="space-y-3">
        {/* DMX Config */}
        {(node.category === 'dmx-input' || node.category === 'dmx-output') && (
          <>
            {node.config.protocol && (
              <Field label="Protocol">
                <div className="text-xs text-foreground/80">{node.config.protocol}</div>
              </Field>
            )}
            <Field label="Universe">
              <Input
                type="number" min={1} max={32768}
                value={node.config.universe || 1}
                onChange={e => onUpdate({ universe: parseInt(e.target.value) || 1 })}
                className="h-7 text-xs bg-muted/30 border-border/30"
              />
            </Field>
            {node.config.channelStart !== undefined && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ch Start">
                  <Input
                    type="number" min={1} max={512}
                    value={node.config.channelStart || 1}
                    onChange={e => onUpdate({ channelStart: parseInt(e.target.value) || 1 })}
                    className="h-7 text-xs bg-muted/30 border-border/30"
                  />
                </Field>
                <Field label="Ch End">
                  <Input
                    type="number" min={1} max={512}
                    value={node.config.channelEnd || 512}
                    onChange={e => onUpdate({ channelEnd: parseInt(e.target.value) || 512 })}
                    className="h-7 text-xs bg-muted/30 border-border/30"
                  />
                </Field>
              </div>
            )}
            {node.config.ipAddress !== undefined && (
              <Field label="IP Address">
                <Input
                  value={node.config.ipAddress || ''}
                  onChange={e => onUpdate({ ipAddress: e.target.value })}
                  className="h-7 text-xs bg-muted/30 border-border/30"
                  placeholder="255.255.255.255"
                />
              </Field>
            )}
          </>
        )}

        {/* WLED Config */}
        {node.category === 'wled' && (
          <>
            <Field label="WLED IP">
              <Input
                value={node.config.wledIp || ''}
                onChange={e => onUpdate({ wledIp: e.target.value })}
                className="h-7 text-xs bg-muted/30 border-border/30"
                placeholder="192.168.1.100"
              />
            </Field>
            {node.config.wledSegment !== undefined && (
              <Field label="Segment">
                <Input
                  type="number" min={0} max={32}
                  value={node.config.wledSegment || 0}
                  onChange={e => onUpdate({ wledSegment: parseInt(e.target.value) || 0 })}
                  className="h-7 text-xs bg-muted/30 border-border/30"
                />
              </Field>
            )}
          </>
        )}

        {/* ESP32 GPIO Config */}
        {node.category === 'esp32' && (
          <>
            <Field label="GPIO Pin">
              <Input
                type="number" min={0} max={39}
                value={node.config.gpioPin ?? 0}
                onChange={e => onUpdate({ gpioPin: parseInt(e.target.value) || 0 })}
                className="h-7 text-xs bg-muted/30 border-border/30"
              />
            </Field>
            {node.config.buttonMode && node.config.buttonMode !== 'pot' && (
              <Field label="Button Mode">
                <select
                  value={node.config.buttonMode}
                  onChange={e => onUpdate({ buttonMode: e.target.value as NodeConfig['buttonMode'] })}
                  className="w-full h-7 text-xs bg-muted/30 border border-border/30 rounded px-2 text-foreground"
                >
                  <option value="push-release">Push &amp; Release</option>
                  <option value="toggle">Toggle</option>
                  <option value="double-press">Double Press</option>
                  <option value="hold">Hold</option>
                </select>
              </Field>
            )}
            {node.config.buttonMode === 'hold' && (
              <Field label="Hold Time (ms)">
                <Input
                  type="number" min={100} max={5000} step={100}
                  value={node.config.holdTime || 1000}
                  onChange={e => onUpdate({ holdTime: parseInt(e.target.value) || 1000 })}
                  className="h-7 text-xs bg-muted/30 border-border/30"
                />
              </Field>
            )}
            {node.config.buttonMode === 'double-press' && (
              <Field label="Double Press Window (ms)">
                <Input
                  type="number" min={100} max={1000} step={50}
                  value={node.config.doublePressTime || 300}
                  onChange={e => onUpdate({ doublePressTime: parseInt(e.target.value) || 300 })}
                  className="h-7 text-xs bg-muted/30 border-border/30"
                />
              </Field>
            )}
            {node.config.buttonMode === 'pot' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Min Value">
                  <Input
                    type="number" min={0} max={65535}
                    value={node.config.potMin ?? 0}
                    onChange={e => onUpdate({ potMin: parseInt(e.target.value) || 0 })}
                    className="h-7 text-xs bg-muted/30 border-border/30"
                  />
                </Field>
                <Field label="Max Value">
                  <Input
                    type="number" min={0} max={65535}
                    value={node.config.potMax ?? 255}
                    onChange={e => onUpdate({ potMax: parseInt(e.target.value) || 255 })}
                    className="h-7 text-xs bg-muted/30 border-border/30"
                  />
                </Field>
              </div>
            )}

            {/* Firmware Download */}
            <div className="pt-3 border-t border-border/20 space-y-2">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
                Firmware Generator
              </div>
              <Button
                variant="outline" size="sm"
                onClick={() => downloadFirmware('esphome')}
                className="w-full h-7 text-[10px] gap-1"
              >
                <Download size={10} /> Download ESPHome YAML
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => downloadFirmware('wled-usermod')}
                className="w-full h-7 text-[10px] gap-1"
              >
                <Download size={10} /> Download WLED Usermod
              </Button>
            </div>
          </>
        )}

        {/* Trigger Config */}
        {node.category === 'triggers' && (
          <>
            <Field label="Target Type">
              <div className="text-xs text-foreground/80 capitalize">
                {node.config.mappedTargetType?.replace('-', ' ') || 'None'}
              </div>
            </Field>
            <Field label="Target ID / Name">
              <Input
                value={node.config.mappedTarget || ''}
                onChange={e => onUpdate({ mappedTarget: e.target.value })}
                className="h-7 text-xs bg-muted/30 border-border/30"
                placeholder="e.g. scene_fire, btn_strobe"
              />
            </Field>
          </>
        )}

        {/* DMX Channel Mapper */}
        {node.templateId === 'dmx-channel-map' && (
          <div className="pt-2 border-t border-border/20">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-2">
              Channel Mappings
            </div>
            {(node.config.channelMappings || []).map((m, i) => (
              <div key={i} className="flex gap-1 items-center mb-1">
                <span className="text-[8px] text-muted-foreground w-8">Ch {m.dmxChannel}</span>
                <span className="text-[8px]">→</span>
                <span className="text-[8px] text-muted-foreground flex-1 truncate">{m.targetLabel}</span>
              </div>
            ))}
            <Button
              variant="outline" size="sm"
              onClick={() => {
                const mappings = [...(node.config.channelMappings || [])];
                mappings.push({
                  dmxChannel: mappings.length + 1,
                  targetType: 'livdj-button',
                  targetId: '',
                  targetLabel: `Mapping ${mappings.length + 1}`,
                });
                onUpdate({ channelMappings: mappings });
              }}
              className="w-full h-6 text-[9px] mt-1"
            >
              + Add Mapping
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[8px] uppercase tracking-wider text-muted-foreground/50 mb-1">{label}</div>
      {children}
    </div>
  );
}
