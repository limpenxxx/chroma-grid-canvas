import { useState, useRef } from 'react';
import {
  FolderOpen, Upload, Download, FileVideo, Image, FileJson, Trash2, Eye,
  Plus, Film, Lightbulb, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useMediaStore, type MediaItem } from '@/store/mediaStore';
import { useFixtureStore, type FixtureDefinition } from '@/store/fixtureStore';
import { parseGdtfFile } from '@/lib/gdtfParser';
import { toast } from 'sonner';

/* ────────── helpers ────────── */

function downloadFile(data: string, filename: string, mime = 'application/json') {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pickFile(accept: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      if (input.files?.[0]) resolve(input.files[0]);
      else reject(new Error('cancelled'));
    };
    input.click();
  });
}

function pickFiles(accept: string): Promise<FileList> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => {
      if (input.files?.length) resolve(input.files);
      else reject(new Error('cancelled'));
    };
    input.click();
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/* ────────── MediaFile type for local browsing ────────── */
interface LocalFile {
  id: string;
  name: string;
  type: 'video' | 'image' | 'gif' | 'fixture-json';
  src: string;
  size: number;
  addedAt: number;
}

/* ────────── component ────────── */

export function FileExplorer() {
  const mediaStore = useMediaStore();
  const fixtureStore = useFixtureStore();
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'video' | 'image'>('image');
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);

  /* ── Import media files ── */
  const importMedia = async () => {
    try {
      const files = await pickFiles('video/*,image/*,.gif');
      const newFiles: LocalFile[] = [];
      const newMediaItems: MediaItem[] = [];

      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        const isVideo = file.type.startsWith('video/');
        const isGif = file.type === 'image/gif';
        const type = isVideo ? 'video' : isGif ? 'gif' : 'image';

        const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        newFiles.push({ id, name: file.name, type, src: dataUrl, size: file.size, addedAt: Date.now() });
        newMediaItems.push({
          id,
          name: file.name,
          type: type as 'video' | 'image' | 'gif',
          sourceType: 'file',
          src: dataUrl,
          duration: 0,
          crossfade: 0,
          createdAt: Date.now(),
        });
      }

      newMediaItems.forEach((item) => mediaStore.addItem(item));
      setLocalFiles((prev) => [...prev, ...newFiles]);
      toast.success(`Imported ${newFiles.length} media file(s)`);
    } catch { /* cancelled */ }
  };

  /* ── Export fixtures ── */
  const exportFixtures = () => {
    const defs = fixtureStore.definitions;
    if (defs.length === 0) { toast.error('No fixture definitions to export'); return; }
    downloadFile(JSON.stringify(defs, null, 2), `stokio-fixtures-${Date.now()}.json`);
    toast.success(`Exported ${defs.length} fixture definition(s)`);
  };

  /* ── Import fixtures (JSON or GDTF) ── */
  const importFixtures = async () => {
    try {
      const file = await pickFile('.json,.gdtf,application/json');
      
      if (file.name.endsWith('.gdtf') || file.name.endsWith('.xml')) {
        // GDTF format
        const def = await parseGdtfFile(file);
        if (def) {
          fixtureStore.addDefinition(def);
          toast.success(`Imported GDTF: ${def.manufacturer} ${def.model} (${def.modes.length} mode(s))`);
        } else {
          toast.error('Could not parse GDTF file');
        }
        return;
      }

      // JSON format
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr: FixtureDefinition[] = Array.isArray(parsed) ? parsed : [parsed];
      let count = 0;
      for (const def of arr) {
        if (def.id && def.model && def.modes) {
          fixtureStore.addDefinition(def);
          count++;
        }
      }
      toast.success(`Imported ${count} fixture definition(s)`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message !== 'cancelled') toast.error('Invalid fixture file');
    }
  };

  /* ── Export all media metadata ── */
  const exportMediaList = () => {
    const items = mediaStore.items;
    if (items.length === 0) { toast.error('No media items to export'); return; }
    // Export metadata only (src is data URL, too large)
    const meta = items.map(({ id, name, type, sourceType, externalUrl, duration }) => ({
      id, name, type, sourceType, externalUrl, duration,
    }));
    downloadFile(JSON.stringify(meta, null, 2), `stokio-media-list-${Date.now()}.json`);
    toast.success(`Exported metadata for ${meta.length} media item(s)`);
  };

  /* ── Preview ── */
  const openPreview = (src: string, type: 'video' | 'image') => {
    setPreviewSrc(src);
    setPreviewType(type);
  };

  /* ── Remove local file ── */
  const removeLocalFile = (id: string) => {
    setLocalFiles((prev) => prev.filter((f) => f.id !== id));
    mediaStore.removeItem(id);
    toast.success('File removed');
  };

  const allMediaItems = mediaStore.items;
  const fixtureDefs = fixtureStore.definitions;

  return (
    <div className="h-full flex flex-col gap-2 p-3">
      <Tabs defaultValue="media" className="flex-1 flex flex-col">
        <TabsList className="bg-muted/20 self-start">
          <TabsTrigger value="media" className="text-xs gap-1"><Film size={12} /> Media</TabsTrigger>
          <TabsTrigger value="fixtures" className="text-xs gap-1"><Lightbulb size={12} /> Fixtures</TabsTrigger>
        </TabsList>

        {/* ── Media Tab ── */}
        <TabsContent value="media" className="flex-1 flex flex-col gap-2 mt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={importMedia}>
              <Upload size={12} /> Import Media
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={exportMediaList}>
              <Download size={12} /> Export List
            </Button>
            <div className="flex-1" />
            <Badge variant="outline" className="text-[9px] font-mono">
              {allMediaItems.length} items
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1">
            {allMediaItems.length === 0 ? (
              <div className="text-muted-foreground/40 text-center py-12 text-xs">
                No media files. Click "Import Media" to add videos, images, or GIFs.
              </div>
            ) : (
              allMediaItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 p-2 rounded-lg border border-border/20 hover:border-primary/30 bg-muted/10 hover:bg-muted/20 transition-all group">
                  {/* Thumbnail */}
                  <div className="w-10 h-10 rounded bg-muted/30 flex items-center justify-center shrink-0 overflow-hidden">
                    {item.type === 'video' ? (
                      <FileVideo size={16} className="text-blue-400" />
                    ) : item.src.startsWith('data:') ? (
                      <img src={item.src} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Image size={16} className="text-green-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium truncate">{item.name}</div>
                    <div className="text-[9px] text-muted-foreground/50 flex gap-2">
                      <span className="uppercase">{item.type}</span>
                      <span>{item.sourceType}</span>
                    </div>
                  </div>

                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                    onClick={() => openPreview(item.src, item.type === 'video' ? 'video' : 'image')}>
                    <Eye size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-destructive"
                    onClick={() => { mediaStore.removeItem(item.id); toast.success('Removed'); }}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* ── Fixtures Tab ── */}
        <TabsContent value="fixtures" className="flex-1 flex flex-col gap-2 mt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={importFixtures}>
              <Upload size={12} /> Import (JSON / GDTF)
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={exportFixtures}>
              <Download size={12} /> Export All
            </Button>
            <div className="flex-1" />
            <Badge variant="outline" className="text-[9px] font-mono">
              {fixtureDefs.length} definitions
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1">
            {fixtureDefs.length === 0 ? (
              <div className="text-muted-foreground/40 text-center py-12 text-xs">
                No fixture definitions. Create fixtures in the Fixture Editor or import JSON files.
              </div>
            ) : (
              fixtureDefs.map((def) => (
                <div key={def.id} className="flex items-center gap-2 p-2 rounded-lg border border-border/20 hover:border-primary/30 bg-muted/10 hover:bg-muted/20 transition-all group">
                  <div className="w-8 h-8 rounded bg-muted/30 flex items-center justify-center shrink-0 text-sm">
                    {def.type === 'moving-head' ? '◎' : def.type === 'par' ? '●' : def.type === 'strip' ? '▬' : def.type === 'wled' ? '⊞' : '◈'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium truncate">{def.manufacturer} {def.model}</div>
                    <div className="text-[9px] text-muted-foreground/50 flex gap-2">
                      <span className="uppercase">{def.type}</span>
                      <span>{def.modes.length} mode(s)</span>
                      <span>{def.modes[0]?.channelCount || '?'}ch</span>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 text-[9px] opacity-0 group-hover:opacity-100"
                    onClick={() => {
                      downloadFile(JSON.stringify(def, null, 2), `${def.manufacturer}-${def.model}.json`);
                      toast.success('Exported');
                    }}>
                    <Download size={10} />
                  </Button>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Preview overlay ── */}
      {previewSrc && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setPreviewSrc(null)}>
          <div className="relative max-w-[80vw] max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <button className="absolute -top-8 right-0 text-muted-foreground hover:text-foreground"
              onClick={() => setPreviewSrc(null)}>
              <X size={18} />
            </button>
            {previewType === 'video' ? (
              <video src={previewSrc} controls autoPlay className="max-w-full max-h-[75vh] rounded-lg" />
            ) : (
              <img src={previewSrc} alt="Preview" className="max-w-full max-h-[75vh] rounded-lg object-contain" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
