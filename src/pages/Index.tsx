import { useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ImagePlus, Shield, User, Pencil } from 'lucide-react';
import stokioLogo from '@/assets/stokio-logo.png';
import { useAppStore } from '@/store/appStore';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { BottomBar } from '@/components/layout/BottomBar';
import { StageBuilder } from '@/components/modules/StageBuilder';
import { MediaServer } from '@/components/modules/MediaServer';
import { TextOverlays } from '@/components/modules/TextOverlays';
import { FixtureControls } from '@/components/modules/FixtureControls';
import { NodeLogic } from '@/components/modules/NodeLogic';
import { Devices } from '@/components/modules/Devices';
import { LiveDJ } from '@/components/modules/LiveDJ';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const moduleComponents = {
  stage: StageBuilder,
  media: MediaServer,
  text: TextOverlays,
  fixtures: FixtureControls,
  nodes: NodeLogic,
  devices: Devices,
  livedj: LiveDJ,
};

// ── Start Screen ──
function StartScreen() {
  const { setUserRole, userName, adminName, setUserName, setAdminName } = useAppStore();
  const [editingUser, setEditingUser] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState(false);
  const [tempName, setTempName] = useState('');
  const [showPinPad, setShowPinPad] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const ADMIN_PIN = '666333';

  const handlePinDigit = (digit: string) => {
    setPinError(false);
    const newPin = pinInput + digit;
    setPinInput(newPin);
    if (newPin.length >= 6) {
      if (newPin === ADMIN_PIN) {
        setShowPinPad(false);
        setPinInput('');
        setUserRole('admin');
      } else {
        setPinError(true);
        setTimeout(() => { setPinInput(''); setPinError(false); }, 600);
      }
    }
  };

  const handlePinClear = () => { setPinInput(''); setPinError(false); };
  const handlePinBack = () => { setPinInput(prev => prev.slice(0, -1)); setPinError(false); };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background overflow-hidden relative">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="flex flex-col items-center gap-10 relative z-10">
        <div className="relative">
          <div className="absolute inset-0 rounded-full blur-3xl opacity-60 animate-rainbow-glow" />
          <img src={stokioLogo} alt="STOKIO FX" className="relative z-10 h-48 w-auto max-w-[400px] object-contain drop-shadow-[0_0_24px_rgba(0,229,255,0.4)]" />
        </div>
        <h1 className="text-2xl font-bold tracking-[0.3em] uppercase text-foreground">STOKIO FX LIGHT CONTROLLER</h1>
        <p className="text-sm text-muted-foreground tracking-wider">Select your role to continue</p>

        <div className="flex gap-8">
          {/* Admin Card */}
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}
            className="w-56 glass-panel border border-border/30 rounded-xl p-6 flex flex-col items-center gap-4 cursor-pointer hover:border-primary/40 transition-all group"
            onClick={() => { if (!editingAdmin) setShowPinPad(true); }}>
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center group-hover:shadow-[0_0_20px_hsl(var(--primary)/0.3)] transition-all">
              <Shield size={28} className="text-primary" />
            </div>
            <div className="flex items-center gap-1.5">
              {editingAdmin ? (
                <Input value={tempName} onChange={e => setTempName(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') { setAdminName(tempName || 'Admin'); setEditingAdmin(false); } }}
                  onBlur={() => { setAdminName(tempName || 'Admin'); setEditingAdmin(false); }}
                  className="h-7 w-28 text-center text-sm bg-muted/20 border-border/30" />
              ) : (
                <>
                  <span className="text-sm font-semibold tracking-wider uppercase">{adminName}</span>
                  <button onClick={e => { e.stopPropagation(); setTempName(adminName); setEditingAdmin(true); }}
                    className="text-muted-foreground/30 hover:text-muted-foreground"><Pencil size={10} /></button>
                </>
              )}
            </div>
            <span className="text-[9px] text-muted-foreground/50 text-center">Full access · PIN protected</span>
          </motion.div>

          {/* User Card */}
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}
            className="w-56 glass-panel border border-border/30 rounded-xl p-6 flex flex-col items-center gap-4 cursor-pointer hover:border-accent/40 transition-all group"
            onClick={() => !editingUser && setUserRole('user')}>
            <div className="w-16 h-16 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center group-hover:shadow-[0_0_20px_hsl(var(--accent)/0.3)] transition-all">
              <User size={28} className="text-accent" />
            </div>
            <div className="flex items-center gap-1.5">
              {editingUser ? (
                <Input value={tempName} onChange={e => setTempName(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') { setUserName(tempName || 'User'); setEditingUser(false); } }}
                  onBlur={() => { setUserName(tempName || 'User'); setEditingUser(false); }}
                  className="h-7 w-28 text-center text-sm bg-muted/20 border-border/30" />
              ) : (
                <>
                  <span className="text-sm font-semibold tracking-wider uppercase">{userName}</span>
                  <button onClick={e => { e.stopPropagation(); setTempName(userName); setEditingUser(true); }}
                    className="text-muted-foreground/30 hover:text-muted-foreground"><Pencil size={10} /></button>
                </>
              )}
            </div>
            <span className="text-[9px] text-muted-foreground/50 text-center">Media, Text & Live DJ only</span>
          </motion.div>
        </div>
      </motion.div>

      {/* PIN Pad Modal */}
      <AnimatePresence>
        {showPinPad && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
            onClick={() => { setShowPinPad(false); setPinInput(''); setPinError(false); }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="glass-panel border border-border/40 rounded-2xl p-8 flex flex-col items-center gap-6 w-80"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <Shield size={20} className="text-primary" />
                <span className="text-sm font-semibold tracking-wider uppercase">Admin PIN</span>
              </div>

              {/* PIN dots */}
              <div className="flex gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                    pinError ? 'border-destructive bg-destructive/30 animate-pulse' :
                    i < pinInput.length ? 'border-primary bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)]' :
                    'border-border/40 bg-muted/20'
                  }`} />
                ))}
              </div>

              {pinError && (
                <span className="text-[10px] text-destructive font-semibold animate-pulse">Wrong PIN</span>
              )}

              {/* Number pad */}
              <div className="grid grid-cols-3 gap-3">
                {['1','2','3','4','5','6','7','8','9'].map(d => (
                  <button key={d} onClick={() => handlePinDigit(d)}
                    className="w-16 h-16 rounded-xl bg-muted/30 border border-border/30 text-xl font-bold text-foreground hover:bg-muted/50 hover:border-primary/30 active:bg-primary/20 active:scale-95 transition-all">
                    {d}
                  </button>
                ))}
                <button onClick={handlePinClear}
                  className="w-16 h-16 rounded-xl bg-muted/20 border border-border/20 text-[10px] font-semibold text-muted-foreground hover:bg-muted/40 transition-all uppercase tracking-wider">
                  Clear
                </button>
                <button onClick={() => handlePinDigit('0')}
                  className="w-16 h-16 rounded-xl bg-muted/30 border border-border/30 text-xl font-bold text-foreground hover:bg-muted/50 hover:border-primary/30 active:bg-primary/20 active:scale-95 transition-all">
                  0
                </button>
                <button onClick={handlePinBack}
                  className="w-16 h-16 rounded-xl bg-muted/20 border border-border/20 text-[10px] font-semibold text-muted-foreground hover:bg-muted/40 transition-all uppercase tracking-wider">
                  ←
                </button>
              </div>

              <button onClick={() => { setShowPinPad(false); setPinInput(''); setPinError(false); }}
                className="text-[9px] text-muted-foreground/40 hover:text-muted-foreground transition-colors uppercase tracking-widest mt-2">
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-6 text-[9px] text-muted-foreground/20 tracking-widest">
        Made by Fredric Lindberg · v0.1
      </div>
    </div>
  );
}

const Index = () => {
  const activeModule = useAppStore((s) => s.activeModule);
  const userRole = useAppStore((s) => s.userRole);
  const ActiveComponent = moduleComponents[activeModule];
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

  // Show start screen if no role selected
  if (!userRole) return <StartScreen />;

  return (
    <div className="min-h-screen w-screen flex flex-col bg-background overflow-x-hidden">
      {/* Top Bar — STOKIO logo left, Venue logo center */}
      <div className="w-full flex items-center bg-[hsl(0_0%_3%)] border-b border-border/30 px-8 shrink-0 h-56">
        {/* STOKIO Logo — left */}
        <div className="shrink-0">
          <img src={stokioLogo} alt="STOKIO FX" className="h-48 w-48 object-contain drop-shadow-[0_0_16px_rgba(0,229,255,0.3)]" />
        </div>

        {/* Venue Logo — center */}
        <div className="flex-1 flex items-center justify-center">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleVenueUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center transition-all overflow-hidden group"
          >
            {venueLogo ? (
              <img
                src={venueLogo}
                alt="Venue Logo"
                className="h-48 max-w-[1200px] object-contain opacity-80 hover:opacity-100 transition-opacity"
              />
            ) : (
              <div className="flex items-center gap-3 px-8 py-4 rounded-lg border border-dashed border-border/20 hover:border-primary/30 bg-muted/5 hover:bg-muted/10 transition-all">
                <ImagePlus size={24} className="text-muted-foreground/30 group-hover:text-muted-foreground/50" />
                <span className="text-sm text-muted-foreground/30 group-hover:text-muted-foreground/50 uppercase tracking-widest">
                  Upload Venue Logo · 1000×200px
                </span>
              </div>
            )}
          </button>
        </div>

        {/* Spacer to balance layout */}
        <div className="w-48 shrink-0" />
      </div>

      <div className="flex-1 flex overflow-x-hidden">
        <AppSidebar />
        <main className="flex-1 overflow-auto touch-pan-y touch-pinch-zoom">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              <ActiveComponent />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <BottomBar />
    </div>
  );
};

export default Index;
