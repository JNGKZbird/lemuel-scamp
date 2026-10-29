import React from "react";
import ReactDOM from "react-dom/client";
import { initLanguage } from "./i18n";
import "./fonts.css";

const params = new URLSearchParams(location.search);
const isConsole = params.get("view") === "console";
const isPhasePreview = params.get("view") === "phase-preview";
const isGlobePreview = params.get("view") === "globe-preview";
const isOverlay = params.get("view") === "overlay";
const legacyPetWindows = import.meta.env.VITE_LEGACY_PET_WINDOWS === "1";
if (isOverlay) {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}
if (isConsole) {
  const material = params.get("material") === "liquid" ? "liquid" : "classic";
  const black = params.get("theme") === "black";
  const bg =
    material === "classic"
      ? black
        ? "#0b0d10"
        : "#ffffff"
      : black
        ? "#000000"
        : "#e7e3db";
  document.documentElement.style.background = bg;
  document.body.style.background = bg;
}
if (isPhasePreview) {
  document.documentElement.style.background = "#eef2f5";
  document.body.style.background = "#eef2f5";
}
if (isGlobePreview) {
  document.documentElement.style.background = "#111318";
  document.body.style.background = "#111318";
}
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

const render = (node: React.ReactNode) => {
  root.render(<React.StrictMode>{node}</React.StrictMode>);
};

// 先读出已保存的语言再渲染，避免窗口先闪一帧中文（或英文）。
const afterLanguage = (label: string, load: () => Promise<void>) => {
  void initLanguage().finally(() => {
    load().catch((err) => console.error(`[boot] ${label}`, err));
  });
};

if (isOverlay) {
  afterLanguage("overlay", () =>
    import("./overlay/OverlayPoc").then(({ default: OverlayPoc }) =>
      render(<OverlayPoc />),
    ),
  );
} else if (isConsole) {
  afterLanguage("console", () =>
    import("./console/ConsoleApp").then(({ default: ConsoleApp }) =>
      render(<ConsoleApp />),
    ),
  );
} else if (isPhasePreview) {
  import("./preview/PhasePreview")
    .then(({ default: PhasePreview }) => render(<PhasePreview />))
    .catch((err) => console.error("[boot] phase-preview", err));
} else if (isGlobePreview) {
  import("./preview/GlobePreview")
    .then(({ default: GlobePreview }) => render(<GlobePreview />))
    .catch((err) => console.error("[boot] globe-preview", err));
} else if (legacyPetWindows) {
  import("./App")
    .then(({ default: App }) => render(<App />))
    .catch((err) => console.error("[boot] app", err));
} else {
  afterLanguage("overlay-bootstrap", () =>
    import("./overlay/OverlayBootstrap").then(
      ({ default: OverlayBootstrap }) => render(<OverlayBootstrap />),
    ),
  );
}
