import { AnimatePresence, motion } from 'framer-motion';
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
  showrunner: ShowRunner,
};

const Index = () => {
  const activeModule = useAppStore((s) => s.activeModule);
  const ActiveComponent = moduleComponents[activeModule];

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
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
