import { useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ImagePlus } from 'lucide-react';
import stokioLogo from '@/assets/stokio-logo-color.png';
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

const moduleComponents = {
  stage: StageBuilder,
  media: MediaServer,
  text: TextOverlays,
  fixtures: FixtureControls,
  nodes: NodeLogic,
  devices: Devices,
  livedj: LiveDJ,
};

const Index = () => {
  const activeModule = useAppStore((s) => s.activeModule);
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

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      {/* Venue Logo Bar — top center */}
      <div className="w-full flex items-center justify-center bg-[hsl(0_0%_3%)] border-b border-border/30 px-4 shrink-0">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleVenueUpload} />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="h-24 flex items-center justify-center transition-all overflow-hidden group py-2"
        >
          {venueLogo ? (
            <img
              src={venueLogo}
              alt="Venue Logo"
              className="h-20 max-w-[800px] object-contain opacity-80 hover:opacity-100 transition-opacity"
            />
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-border/20 hover:border-primary/30 bg-muted/5 hover:bg-muted/10 transition-all">
              <ImagePlus size={14} className="text-muted-foreground/30 group-hover:text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground/30 group-hover:text-muted-foreground/50 uppercase tracking-widest">
                Upload Venue Logo · 1000×200px
              </span>
            </div>
          )}
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <AppSidebar />
        <main className="flex-1 overflow-hidden">
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
