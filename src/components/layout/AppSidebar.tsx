import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Layout, Film, Type, Sliders, GitBranch, Cpu, Speaker, Grid3X3, Download, Upload
} from 'lucide-react';
import { useAppStore, type ModuleId } from '@/store/appStore';
import stokioLogo from '@/assets/stokio-logo-color.png';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { exportFullBackup, importFullBackup, downloadJson, openJsonFile } from '@/lib/backupRestore';
import { toast } from 'sonner';

const navItems: { id: ModuleId; icon: typeof Layout; label: string }[] = [
  { id: 'stage', icon: Grid3X3, label: 'Pixel Mapping' },
  { id: 'media', icon: Film, label: 'Media Server' },
  { id: 'text', icon: Type, label: 'Text Overlays' },
  { id: 'fixtures', icon: Sliders, label: 'Fixture Controls' },
  { id: 'nodes', icon: GitBranch, label: 'Node Logic' },
  { id: 'devices', icon: Cpu, label: 'Devices' },
  { id: 'livedj', icon: Speaker, label: 'LIVE DJ' },
];

export function AppSidebar() {
  const { activeModule, setActiveModule } = useAppStore();

  return (
    <div className="w-[100px] h-full flex flex-col items-center py-4 border-r border-border/50 bg-[hsl(0_0%_3%)]">

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

      {/* Backup / Restore */}
      <div className="flex flex-col items-center gap-1 w-full px-2 mb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full h-8 text-[8px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => {
                const json = exportFullBackup();
                const ts = new Date().toISOString().slice(0, 10);
                downloadJson(json, `stokio-backup-${ts}.json`);
                toast.success('Full project backup saved');
              }}>
              <Download size={12} /> Backup
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Export full project backup</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full h-8 text-[8px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={async () => {
                try {
                  const json = await openJsonFile();
                  const err = importFullBackup(json);
                  if (err) { toast.error(err); return; }
                  toast.success('Backup restored — reloading…');
                  setTimeout(() => window.location.reload(), 800);
                } catch { /* cancelled */ }
              }}>
              <Upload size={12} /> Restore
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Import project backup</TooltipContent>
        </Tooltip>
      </div>

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
