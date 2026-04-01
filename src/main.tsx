import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSync } from "./lib/wsSync";
import { loadDefaultProject } from "./lib/backupRestore";

// Load default project on first visit (if saved and no existing state)
if (!localStorage.getItem('stokio-dj-autosave-v1')) {
  loadDefaultProject();
}

// Start WebSocket sync (connects to LAN server on port 9100)
initSync();

createRoot(document.getElementById("root")!).render(<App />);
