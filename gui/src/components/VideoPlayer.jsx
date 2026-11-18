import { useEffect, useState } from "react";
import MpvPlayer from "./player/MpvPlayer";
import WebPlayer from "./player/WebPlayer";

export default function VideoPlayer(props) {
  const isElectron =
    typeof window !== "undefined" &&
    Boolean(window.electron && window.sharedStateAPI?.playInMpv);

  const [desktopPlayer, setDesktopPlayer] = useState(() => {
    try {
      return localStorage.getItem("desktopPlayer") || "web";
    } catch (_) {
      return "web";
    }
  });

  useEffect(() => {
    if (!isElectron) return;
    if (window.sharedStateAPI?.getSettings) {
      window.sharedStateAPI
        .getSettings(["desktopPlayer"])
        .then((res) => {
          if (res?.settings?.desktopPlayer) {
            setDesktopPlayer(res.settings.desktopPlayer);
            try {
              localStorage.setItem("desktopPlayer", res.settings.desktopPlayer);
            } catch (_) {}
          }
        })
        .catch(() => {});
    }
  }, [isElectron]);

  const handleSwitchToMpv = () => {
    setDesktopPlayer("mpv");
    try {
      localStorage.setItem("desktopPlayer", "mpv");
    } catch (_) {}
  };

  const handleSwitchToWeb = () => {
    setDesktopPlayer("web");
    try {
      localStorage.setItem("desktopPlayer", "web");
    } catch (_) {}
  };

  if (isElectron && desktopPlayer === "mpv") {
    return <MpvPlayer {...props} onSwitchToWeb={handleSwitchToWeb} />;
  }

  return (
    <WebPlayer
      {...props}
      onSwitchToMpv={isElectron ? handleSwitchToMpv : undefined}
    />
  );
}
