import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Layout, Film, Type, Sliders, GitBranch, Cpu, Speaker, Grid3X3, Download, Upload, LogOut,
  FolderOpen, Save, FilePlus, Star, Trash2, X
} from 'lucide-react';
import { useAppStore, type ModuleId } from '@/store/appStore';
import stokioLogo from '@/assets/stokio-logo-color.png';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  exportFullBackup, importFullBackup, downloadJson, openJsonFile,
  saveProject, loadProject, deleteProject, getSavedProjects, saveAsDefault,
  hasDefaultProject, clearAllState, type SavedProject,
} from '@/lib/backupRestore';
import { toast } from 'sonner';

const navItems: { id: ModuleId; icon: typeof Layout; label: string }[] = [
  { id: 'stage', icon: Grid3X3, label: 'Pixel Mapping' },
  { id: 'media', icon: Film, label: 'Media Server' },
  { id: 'text', icon: Type, label: 'Text Overlays' },
  { id: 'fixtures', icon: Sliders, label: 'Fixtures' },
  { id: 'nodes', icon: GitBranch, label: 'Node Logic' },
  { id: 'devices', icon: Cpu, label: 'Devices' },
  { id: 'livedj', icon: Speaker, label: 'LIVE DJ' },
];

export function AppSidebar({ compact = false }: { compact?: boolean }) {
  const { activeModule, setActiveModule, isModuleAllowed, userRole, logout } = useAppStore();
  const filteredNav = navItems.filter(item => isModuleAllowed(item.id));
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);

  const openLoad = () => {
    setSavedProjects(getSavedProjects());
    setShowLoadDialog(true);
    setShowProjectMenu(false);
  };

  const handleSave = () => {
    if (!saveName.trim()) return;
    saveProject(saveName.trim());
    toast.success(`Project "${saveName.trim()}" saved`);
    setSaveName('');
    setShowSaveDialog(false);
  };

  const handleLoad = (proj: SavedProject) => {
    const err = loadProject(proj.id);
    if (err) { toast.error(err); return; }
    toast.success(`Project "${proj.name}" loaded — reloading…`);
    setShowLoadDialog(false);
    setTimeout(() => window.location.reload(), 600);
  };

  const handleDelete = (proj: SavedProject) => {
    deleteProject(proj.id);
    setSavedProjects(getSavedProjects());
    toast.success(`Deleted "${proj.name}"`);
  };

  const handleNew = () => {
    clearAllState();
    toast.success('New project — reloading…');
    setShowProjectMenu(false);
    setTimeout(() => window.location.reload(), 600);
  };

  const handleSetDefault = () => {
    saveAsDefault();
    toast.success('Current state saved as default startup project');
    setShowProjectMenu(false);
  };

  return (
    <>
    <div className={`${compact ? 'w-[60px]' : 'w-[100px]'} h-full flex flex-col items-center py-4 border-r border-border/50 bg-[hsl(0_0%_3%)] transition-all`}>

      {/* Nav Items */}
      <nav className="flex-1 flex flex-col gap-1 w-full px-2">
        {filteredNav.map((item) => {
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
                  {!compact && (
                  <span className={`relative z-10 text-[7px] uppercase tracking-wider transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground/50 group-hover:text-muted-foreground'
                  }`}>
                    {item.label.split(' ')[0]}
                  </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="glass-panel-strong">
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Project Management */}
      {userRole === 'admin' && (
        <div className="flex flex-col items-center gap-1 w-full px-2 mb-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full h-8 text-[8px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowProjectMenu(!showProjectMenu)}>
                <FolderOpen size={12} /> Project
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Project management</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Backup / Restore */}
      <div className="flex flex-col items-center gap-1 w-full px-2 mb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full h-8 text-[8px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={async () => {
                const json = exportFullBackup();
                const ts = new Date().toISOString().slice(0, 10);
                await downloadJson(json, `stokio-backup-${ts}.json`);
                toast.success('Full project backup saved');
              }}>
              <Download size={12} /> Backup
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Export full project backup</TooltipContent>
        </Tooltip>
        {userRole === 'admin' && (
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
          <TooltipContent side="right">Import project backup (Admin only)</TooltipContent>
        </Tooltip>
        )}
      </div>

      {/* Logout */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="w-[80px] h-8 text-[8px] gap-1 text-muted-foreground hover:text-foreground mb-1"
            onClick={() => logout()}>
            <LogOut size={12} /> {userRole === 'admin' ? 'Admin' : 'User'}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Switch role / Logout</TooltipContent>
      </Tooltip>

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

    {/* ── Project Menu Overlay ── */}
    <AnimatePresence>
      {showProjectMenu && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowProjectMenu(false)}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            className="glass-panel border border-border/40 rounded-xl p-6 w-72 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold tracking-wider uppercase">Project</span>
              <button onClick={() => setShowProjectMenu(false)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
            </div>

            <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-[11px]" onClick={handleNew}>
              <FilePlus size={14} /> New Project
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-[11px]" onClick={() => { setShowSaveDialog(true); setShowProjectMenu(false); }}>
              <Save size={14} /> Save Project
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-[11px]" onClick={openLoad}>
              <FolderOpen size={14} /> Load Project
            </Button>
            <div className="border-t border-border/20 my-1" />
            <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-[11px]" onClick={handleSetDefault}>
              <Star size={14} className={hasDefaultProject() ? 'text-yellow-500' : ''} /> Set as Default
            </Button>
            <p className="text-[9px] text-muted-foreground/50 leading-tight">
              Default project loads automatically on startup.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* ── Save Dialog ── */}
    <AnimatePresence>
      {showSaveDialog && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowSaveDialog(false)}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            className="glass-panel border border-border/40 rounded-xl p-6 w-80 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}>
            <span className="text-sm font-semibold tracking-wider uppercase">Save Project</span>
            <Input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="Project name..."
              className="text-sm"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={!saveName.trim()}>Save</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* ── Load Dialog ── */}
    <AnimatePresence>
      {showLoadDialog && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowLoadDialog(false)}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            className="glass-panel border border-border/40 rounded-xl p-6 w-96 flex flex-col gap-4 max-h-[60vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold tracking-wider uppercase">Load Project</span>
              <button onClick={() => setShowLoadDialog(false)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
            </div>

            {savedProjects.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/60 text-center py-6">No saved projects yet.</p>
            ) : (
              <div className="flex flex-col gap-2 overflow-y-auto">
                {savedProjects.map(proj => (
                  <div key={proj.id} className="flex items-center gap-2 p-3 rounded-lg border border-border/20 hover:border-primary/30 bg-muted/10 hover:bg-muted/20 transition-all group">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold truncate">{proj.name}</div>
                      <div className="text-[9px] text-muted-foreground/50">
                        {new Date(proj.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-[10px] shrink-0" onClick={() => handleLoad(proj)}>
                      Load
                    </Button>
                    <button onClick={() => handleDelete(proj)} className="text-muted-foreground/30 hover:text-destructive transition-colors shrink-0">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
