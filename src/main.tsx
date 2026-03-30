import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSync } from "./lib/wsSync";

// Start WebSocket sync (connects to LAN server on port 9100)
initSync();

createRoot(document.getElementById("root")!).render(<App />);
