import { useEffect, useMemo, useState } from "react";
import GlobeView from "../globe/GlobeView.tsx";
import {
  dateAtParts,
  datePartsFromDate,
  formatDateParts,
  parseIsoDate,
} from "../pet/calendar.ts";
import type { GeoLocation } from "../settings/store";
import { useI18n } from "../i18n";

const BEIJING: GeoLocation = {
  lat: 39.9042,
  lon: 116.4074,
  isDefault: true,
};

type Props = {
  desktop: boolean;
  preview: boolean;
  virtualDate: string | null;
  onVirtualDateChange: (date: string | null) => void;
  virtualMinute: number | null;
  onVirtualMinuteChange: (minute: number | null) => void;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function minuteLabel(minute: number): string {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

export default function GlobePage({
  desktop,
  preview,
  virtualDate,
  onVirtualDateChange,
  virtualMinute,
  onVirtualMinuteChange,
}: Props) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const [location, setLocation] = useState<GeoLocation>(BEIJING);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!desktop || preview) return;
    let active = true;
    let stop: (() => void) | null = null;
    import("../settings/store")
      .then(({ getLocation, subscribeLocation }) => {
        getLocation()
          .then((stored) => {
            if (active) setLocation(stored);
          })
          .catch((error) => console.error("[globe] location", error));
        subscribeLocation((stored) => {
          if (active) setLocation(stored);
        })
          .then((unlisten) => {
            if (active) stop = unlisten;
            else unlisten();
          })
          .catch((error) => console.error("[globe] location subscribe", error));
      })
      .catch((error) => console.error("[globe] settings", error));
    return () => {
      active = false;
      stop?.();
    };
  }, [desktop, preview]);

  const changeLocation = (nextLat: number, nextLon: number) => {
    setLocation({ lat: nextLat, lon: nextLon, isDefault: false });
    if (desktop && !preview) {
      import("../settings/store")
        .then(({ setLocation: persistLocation }) =>
          persistLocation(nextLat, nextLon),
        )
        .catch((error) => console.error("[globe] save location", error));
    }
  };

  const displayDate = useMemo(() => {
    if (virtualDate === null && virtualMinute === null) return now;
    const parts =
      virtualDate !== null ? parseIsoDate(virtualDate) : null;
    const baseParts = parts ?? datePartsFromDate(now);
    const minute =
      virtualMinute ?? now.getHours() * 60 + now.getMinutes();
    return dateAtParts(baseParts, minute);
  }, [now, virtualDate, virtualMinute]);

  return (
    <section className="console-globe-page" aria-label={t("globe.pageAria")}>
      <GlobeView
        lat={location.lat}
        lon={location.lon}
        date={displayDate}
        isDefault={location.isDefault}
        onLocationChange={changeLocation}
        paletteId="ivory"
        terminatorWidthDeg={8}
        terminatorStrength={0.28}
        sunCorePx={4}
        sunBloomPx={80}
        sunIntensity={1}
        sunFlare={0.9}
        sunViewFalloff={0.2}
        moonSizePx={8}
        moonDarkLevel={0.2}
      />
      {virtualDate !== null || virtualMinute !== null ? (
        <div className="console-globe-virtual" role="status">
          <span>
            {virtualMinute !== null
              ? t("globe.virtualDateTime", {
                  date:
                    virtualDate ?? formatDateParts(datePartsFromDate(now)),
                  time: minuteLabel(virtualMinute),
                })
              : t("globe.virtualDate", {
                  date:
                    virtualDate ?? formatDateParts(datePartsFromDate(now)),
                })}
          </span>
          <button
            type="button"
            onClick={() => {
              onVirtualDateChange(null);
              onVirtualMinuteChange(null);
            }}
          >
            {t("globe.reset")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
