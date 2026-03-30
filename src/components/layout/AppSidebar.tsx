import { motion } from 'framer-motion';
import { 
  Layout, Film, Type, Sliders, GitBranch, Cpu, Speaker
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
  { id: 'showrunner', icon: Play, label: 'Show Runner' },
];

export function AppSidebar() {
  const { activeModule, setActiveModule } = useAppStore();

  return (
    <div className="w-[72px] h-full flex flex-col items-center py-4 border-r border-border/50 bg-[hsl(0_0%_3%)]">
      {/* Logo */}
      <div className="mb-6 px-2">
        <img src={stokioLogo} alt="STOKIO FX" className="w-10 h-10 object-contain" />
      </div>

      {/* Nav Items */}
      <nav className="flex-1 flex flex-col gap-1 w-full px-2">
        {navItems.map((item) => {
          const isActive = activeModule === item.id;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveModule(item.id)}
                  className="relative w-full aspect-square rounded-lg flex items-center justify-center transition-all duration-200 group"
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-lg bg-primary/10 border border-primary/30 glow-green"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <item.icon
                    size={22}
                    className={`relative z-10 transition-colors duration-200 ${
                      isActive
                        ? 'text-primary'
                        : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="glass-panel-strong">
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Version */}
      <div className="text-[9px] text-muted-foreground/40 font-light tracking-widest">
        v0.1
      </div>
    </div>
  );
}
