import { createRoot } from "react-dom/client";
import { categoryGlyphs } from "../src/components/CategoryIcons";
import "../src/components/sidebar.css";

const Network = categoryGlyphs.network;
const Shield = categoryGlyphs.shield;
createRoot(document.getElementById("root")!).render(<div style={{ display: "flex", gap: 40, padding: 40 }}>
  <Network size={20} stroke={1.7} />
  <Network size={32} stroke={2.4} />
  <button type="button" aria-label="Shield" style={{ padding: 20, background: "white", color: "#24344c", border: 0 }}><Shield size={64} /></button>
</div>);
