import MpvPlayer from "./player/MpvPlayer";
import WebPlayer from "./player/WebPlayer";

export default function VideoPlayer(props) {
  const isElectron =
    typeof window !== "undefined" &&
    Boolean(window.electron && window.sharedStateAPI?.playInMpv);

  if (isElectron) {
    return <MpvPlayer {...props} />;
  }

  return <WebPlayer {...props} />;
}
