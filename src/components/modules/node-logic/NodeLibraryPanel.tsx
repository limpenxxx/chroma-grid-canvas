import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { NODE_LIBRARY } from './nodeLibrary';
import { CATEGORY_META, type NodeCategory } from './types';

interface Props {
  onAddNode: (templateId: string) => void;
}

const CATEGORIES: NodeCategory[] = ['dmx-input', 'dmx-output', 'wled', 'audio', 'esp32', 'triggers', 'processing'];

export function NodeLibraryPanel({ onAddNode }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ 'dmx-input': true, 'esp32': true });

  const toggle = (cat: string) => setExpanded(p => ({ ...p, [cat]: !p[cat] }));

  return (
    <motion.div
      initial={{ x: -240, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -240, opacity: 0 }}
      className="absolute left-0 top-0 z-20 w-60 h-full border-r border-border/30 p-3 overflow-y-auto backdrop-blur-xl bg-background/90"
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
        Node Library
      </div>

      {CATEGORIES.map(cat => {
        const meta = CATEGORY_META[cat];
        const templates = NODE_LIBRARY.filter(t => t.category === cat);
        const isOpen = !!expanded[cat];

        return (
          <div key={cat} className="mb-1">
            <button
              onClick={() => toggle(cat)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/30 transition-colors"
            >
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>{meta.icon}</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
                {meta.label}
              </span>
              <span className="text-[8px] text-muted-foreground/50 ml-auto">{templates.length}</span>
            </button>

            {isOpen && (
              <div className="ml-3 pl-3 border-l border-border/20 space-y-0.5 mt-0.5 mb-2">
                {templates.map(tpl => (
                  <button
                    key={tpl.id}
                    onClick={() => onAddNode(tpl.id)}
                    className="w-full flex flex-col gap-0.5 p-2 rounded text-left hover:bg-muted/40 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tpl.color }} />
                      <span className="text-[10px] font-medium">{tpl.name}</span>
                    </div>
                    <span className="text-[8px] text-muted-foreground/50 group-hover:text-muted-foreground/70 pl-3.5">
                      {tpl.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </motion.div>
  );
}
