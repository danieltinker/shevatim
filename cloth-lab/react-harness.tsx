// Mounts the real React component under StrictMode (double mount) to check its lifecycle outside Next.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TzitzitCanvas from "../components/cloth/TzitzitCanvas";

const spec = { shape: "hooded-poncho", texture: null, baseColor: "#efe6d2", trim: "tassels", trimColor: "#efe6d2", stringColor: "#f5f2ea", techelet: true } as const;
createRoot(document.getElementById("stage")!).render(
  <StrictMode>
    <div style={{ width: 300 }}><TzitzitCanvas spec={spec} label="tzitzit" hint="drag the cloth" poster="swatches/cream.jpg" /></div>
  </StrictMode>,
);
