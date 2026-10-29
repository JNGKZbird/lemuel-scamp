import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { CharKey, FrameRate, Gear, PetMode } from "../settings/store";

type StoreModule = typeof import("../settings/store");
type Gears = Record<CharKey, Gear>;
type Visibility = Record<CharKey, boolean>;

const DEFAULTS: Gears = { angel: "standard", angel2: "standard" };
const VISIBLE_DEFAULTS: Visibility = { angel: true, angel2: true };

export function useGearSettings() {
  const [desktop] = useState(() => isTauri());
  const [gears, setGears] = useState<Gears>(DEFAULTS);
  const [visible, setVisible] = useState<Visibility>(VISIBLE_DEFAULTS);
  const [outline, setOutline] = useState(true);
  const [iceGlide, setIceGlide] = useState(false);
  const [frameRate, setFrameRateState] = useState<FrameRate>("60");
  // 浏览器预览可带 ?mode=time 直接展开日轨；Tauri 内始终以 store 为准。
  const [mode, setMode] = useState<PetMode>(() => {
    if (desktop) return "gear";
    return new URLSearchParams(window.location.search).get("mode") === "time"
      ? "time"
      : "gear";
  });
  const [ready, setReady] = useState(!desktop);
  const storeRef = useRef<StoreModule | null>(null);
  const writeChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const cleanups: Array<() => void> = [];
    (async () => {
      const store = await import("../settings/store");
      const [
        angel,
        angel2,
        storedMode,
        angelVisible,
        angel2Visible,
        storedOutline,
        storedIceGlide,
        storedFrameRate,
      ] = await Promise.all([
        store.getGear("angel"),
        store.getGear("angel2"),
        store.getMode(),
        store.getCharacterVisible("angel"),
        store.getCharacterVisible("angel2"),
        store.getInteractionOutline(),
        store.getInteractionIceGlide(),
        store.getFrameRate(),
      ]);
      if (!alive) return;
      storeRef.current = store;
      setGears({ angel, angel2 });
      setVisible({ angel: angelVisible, angel2: angel2Visible });
      setMode(storedMode);
      setOutline(storedOutline);
      setIceGlide(storedIceGlide);
      setFrameRateState(storedFrameRate);
      setReady(true);

      const unlisteners = await Promise.all([
        store.subscribeCharacterVisible("angel", (next) => {
          if (!alive) return;
          setVisible((prev) =>
            prev.angel === next ? prev : { ...prev, angel: next },
          );
        }),
        store.subscribeCharacterVisible("angel2", (next) => {
          if (!alive) return;
          setVisible((prev) =>
            prev.angel2 === next ? prev : { ...prev, angel2: next },
          );
        }),
        store.subscribeInteractionOutline((next) => {
          if (!alive) return;
          setOutline(next);
        }),
        store.subscribeInteractionIceGlide((next) => {
          if (!alive) return;
          setIceGlide(next);
        }),
        store.subscribeFrameRate((next) => {
          if (!alive) return;
          setFrameRateState(next);
        }),
      ]);
      if (alive) cleanups.push(...unlisteners);
      else unlisteners.forEach((unlisten) => unlisten());
    })().catch((err) => {
      console.error("[console] load settings", err);
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
      cleanups.forEach((unlisten) => unlisten());
    };
  }, [desktop]);

  const setCharGear = (char: CharKey, gear: Gear) => {
    setGears((prev) => (prev[char] === gear ? prev : { ...prev, [char]: gear }));
    if (!desktop) return;
    writeChain.current = writeChain.current
      .then(async () => {
        const store = storeRef.current ?? (await import("../settings/store"));
        storeRef.current = store;
        await store.setGear(char, gear);
      })
      .catch((err) => console.error("[console] save settings", err));
  };

  const setCharVisible = (char: CharKey, next: boolean) => {
    setVisible((prev) =>
      prev[char] === next ? prev : { ...prev, [char]: next },
    );
    if (!desktop) return;
    writeChain.current = writeChain.current
      .then(async () => {
        const store = storeRef.current ?? (await import("../settings/store"));
        storeRef.current = store;
        await store.setCharacterVisible(char, next);
      })
      .catch((err) => console.error("[console] save visibility", err));
  };

  const setPetMode = (next: PetMode) => {
    setMode(next);
    if (!desktop) return;
    writeChain.current = writeChain.current
      .then(async () => {
        const store = storeRef.current ?? (await import("../settings/store"));
        storeRef.current = store;
        await store.setMode(next);
      })
      .catch((err) => console.error("[console] save mode", err));
  };

  const setInteractionOutline = (next: boolean) => {
    setOutline(next);
    if (!desktop) return;
    writeChain.current = writeChain.current
      .then(async () => {
        const store = storeRef.current ?? (await import("../settings/store"));
        storeRef.current = store;
        await store.setInteractionOutline(next);
      })
      .catch((err) => console.error("[console] save outline", err));
  };

  const setInteractionIceGlide = (next: boolean) => {
    setIceGlide(next);
    if (!desktop) return;
    writeChain.current = writeChain.current
      .then(async () => {
        const store = storeRef.current ?? (await import("../settings/store"));
        storeRef.current = store;
        await store.setInteractionIceGlide(next);
      })
      .catch((err) => console.error("[console] save ice glide", err));
  };

  const setFrameRate = (next: FrameRate) => {
    setFrameRateState(next);
    if (!desktop) return;
    writeChain.current = writeChain.current
      .then(async () => {
        const store = storeRef.current ?? (await import("../settings/store"));
        storeRef.current = store;
        await store.setFrameRate(next);
      })
      .catch((err) => console.error("[console] save frame rate", err));
  };

  return {
    gears,
    mode,
    visible,
    outline,
    iceGlide,
    frameRate,
    ready,
    setCharGear,
    setCharVisible,
    setPetMode,
    setInteractionOutline,
    setInteractionIceGlide,
    setFrameRate,
  };
}
