import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { 
  Layout, Film, Type, Sliders, GitBranch, Cpu, Speaker, ImagePlus
} from 'lucide-react';
import { useAppStore, type ModuleId } from '@/store/appStore';
import stokioLogo from '@/assets/stokio-logo-color.png';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const navItems: { id: ModuleId; icon: typeof Layout; label: string }[] = [
  { id: 'stage', icon: Layout, label: 'Stage Builder' },
  { id: 'media', icon: Film, label: 'Media Server' },
  { id: 'text', icon: Type, label: 'Text Overlays' },
  { id: 'fixtures', icon: Sliders, label: 'Fixture Controls' },
  { id: 'nodes', icon: GitBranch, label: 'Node Logic' },
  { id: 'devices', icon: Cpu, label: 'Devices' },
  { id: 'livedj', icon: Speaker, label: 'LIVE DJ' },
];

export function AppSidebar() {
  const { activeModule, setActiveModule } = useAppStore();
  const [venueLogo, setVenueLogo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleVenueUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setVenueLogo(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="w-[100px] h-full flex flex-col items-center py-4 border-r border-border/50 bg-[hsl(0_0%_3%)]">
      {/* STOKIO Logo */}
      <div className="mb-3 px-2">
        <img src={stokioLogo} alt="STOKIO FX" className="w-[72px] h-[72px] object-contain drop-shadow-[0_0_12px_rgba(0,229,255,0.3)]" />
      </div>

      {/* Divider */}
      <div className="w-10 h-px bg-border/20 mb-3" />

      {/* Nav Items */}
      <nav className="flex-1 flex flex-col gap-1 w-full px-2">
        {navItems.map((item) => {
          const isActive = activeModule === item.id;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveModule(item.id)}
                  className="relative w-full aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all duration-200 group"
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-lg bg-primary/10 border border-primary/30 glow-green"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <item.icon
                    size={20}
                    className={`relative z-10 transition-colors duration-200 ${
                      isActive
                        ? 'text-primary'
                        : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                  />
                  <span className={`relative z-10 text-[7px] uppercase tracking-wider transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground/50 group-hover:text-muted-foreground'
                  }`}>
                    {item.label.split(' ')[0]}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="glass-panel-strong">
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Credit & Version */}
      <div className="flex flex-col items-center gap-1 mt-2">
        <div className="text-[7px] text-muted-foreground/25 font-light text-center leading-tight px-1">
          Made by<br />Fredric Lindberg
        </div>
        <div className="text-[8px] text-muted-foreground/30 font-light tracking-widest">
          v0.1
        </div>
      </div>
    </div>
  );
}
