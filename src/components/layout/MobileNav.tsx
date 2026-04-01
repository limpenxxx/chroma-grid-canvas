import { motion } from 'framer-motion';
import { Layout, Film, Type, Sliders, GitBranch, Cpu, Speaker, Grid3X3 } from 'lucide-react';
import { useAppStore, type ModuleId } from '@/store/appStore';

const navItems: { id: ModuleId; icon: typeof Layout; label: string }[] = [
  { id: 'stage', icon: Grid3X3, label: 'Stage' },
  { id: 'media', icon: Film, label: 'Media' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'fixtures', icon: Sliders, label: 'Fixtures' },
  { id: 'nodes', icon: GitBranch, label: 'Nodes' },
  { id: 'devices', icon: Cpu, label: 'Devices' },
  { id: 'livedj', icon: Speaker, label: 'DJ' },
];

export function MobileNav() {
  const { activeModule, setActiveModule, isModuleAllowed } = useAppStore();
  const filteredNav = navItems.filter(item => isModuleAllowed(item.id));

  return (
    <nav className="w-full flex items-center justify-around bg-[hsl(0_0%_3%)] border-t border-border/50 px-1 py-1.5 shrink-0">
      {filteredNav.map((item) => {
        const isActive = activeModule === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setActiveModule(item.id)}
            className="relative flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-all"
          >
            {isActive && (
              <motion.div
                layoutId="mobile-nav-active"
                className="absolute inset-0 rounded-lg bg-primary/10 border border-primary/30"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <item.icon
              size={18}
              className={`relative z-10 ${isActive ? 'text-primary' : 'text-muted-foreground/60'}`}
            />
            <span className={`relative z-10 text-[7px] uppercase tracking-wider ${
              isActive ? 'text-primary' : 'text-muted-foreground/40'
            }`}>
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}