import { Trash2, Settings2 } from 'lucide-react';
import type { LogicNode, NodeCategory } from './types';
import { CATEGORY_META } from './types';

interface NodeCardProps {
  node: LogicNode;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onSelect: () => void;
  onRemove: () => void;
}

export function NodeCard({ node, selected, onMouseDown, onSelect, onRemove }: NodeCardProps) {
  const meta = CATEGORY_META[node.category];

  return (
    <div
      className="absolute z-10 select-none"
      style={{ left: node.x, top: node.y }}
      onMouseDown={onMouseDown}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <div
        className={`w-[220px] rounded-lg border backdrop-blur-md bg-background/80 transition-shadow ${
          selected ? 'ring-1 ring-offset-1 ring-offset-background' : ''
        }`}
        style={{
          borderColor: `${node.color}40`,
          boxShadow: selected ? `0 0 12px ${node.color}30` : undefined,
          ...(selected ? { ringColor: node.color } : {}),
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 rounded-t-lg"
          style={{ background: `${node.color}15` }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: node.color, boxShadow: `0 0 6px ${node.color}` }}
            />
            <span className="text-[10px] font-semibold truncate" style={{ color: node.color }}>
              {node.name}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {node.config.protocol && (
              <span className="text-[7px] uppercase px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">
                {node.config.protocol}
              </span>
            )}
            <span className="text-[7px] uppercase px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">
              {meta.label}
            </span>
            <button onClick={(e) => { e.stopPropagation(); onSelect(); }} className="opacity-40 hover:opacity-100">
              <Settings2 size={10} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="opacity-40 hover:opacity-100">
              <Trash2 size={10} />
            </button>
          </div>
        </div>

        {/* Ports */}
        <div className="px-3 py-2 space-y-1">
          {node.ports.map(port => (
            <div
              key={port.id}
              className={`flex items-center gap-2 text-[9px] ${port.type === 'output' ? 'justify-end' : ''}`}
            >
              {port.type === 'input' && (
                <div
                  className="w-2.5 h-2.5 rounded-full border"
                  style={{ borderColor: node.color, backgroundColor: `${node.color}25` }}
                />
              )}
              <span className="text-muted-foreground">{port.label}</span>
              {port.dataType && (
                <span className="text-[7px] px-1 rounded bg-muted/30 text-muted-foreground/60">{port.dataType}</span>
              )}
              {port.type === 'output' && (
                <div
                  className="w-2.5 h-2.5 rounded-full border"
                  style={{ borderColor: node.color, backgroundColor: `${node.color}25` }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Config Summary */}
        {(node.config.universe || node.config.gpioPin !== undefined || node.config.wledIp) && (
          <div className="px-3 pb-2 border-t border-border/20 pt-1">
            {node.config.universe && (
              <div className="text-[8px] text-muted-foreground/60">Universe {node.config.universe}</div>
            )}
            {node.config.channelStart && node.config.channelEnd && (
              <div className="text-[8px] text-muted-foreground/60">
                Ch {node.config.channelStart}-{node.config.channelEnd}
              </div>
            )}
            {node.config.gpioPin !== undefined && (
              <div className="text-[8px] text-muted-foreground/60">GPIO {node.config.gpioPin}</div>
            )}
            {node.config.wledIp && (
              <div className="text-[8px] text-muted-foreground/60">{node.config.wledIp}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
