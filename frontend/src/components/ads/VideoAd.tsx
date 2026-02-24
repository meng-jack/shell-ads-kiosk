import { useEffect, useRef, type CSSProperties } from "react";
import type { AdLayout, MediaFit } from "../../types";

type Props = {
  src?: string;
  poster?: string;
  /** Allotted slot duration in ms – video loops if shorter than this. */
  durationMs?: number;
  layout?: AdLayout;
};

function resolveObjectFit(fit?: MediaFit): CSSProperties["objectFit"] {
  switch (fit) {
    case "cover":
      return "cover";
    case "fill":
    case "stretch":
      return "fill";
    case "center":
    case "none":
      return "none";
    case "contain":
    default:
      return "contain";
  }
}

export default function VideoAd({ src, poster, layout }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Imperatively trigger play so autoplay restrictions are bypassed where possible.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    video.load();
    video.play().catch(() => {
      /* autoplay blocked – silently ignore */
    });
  }, [src]);

  if (!src) {
    return <div className="placeholder">Video creative missing</div>;
  }

  const wrapperStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: layout?.background ?? "transparent",
    padding: layout?.paddingPx ? `${layout.paddingPx}px` : undefined,
    boxSizing: "border-box",
  };

  const mediaStyle: CSSProperties = {
    width: layout?.width ?? "100%",
    height: layout?.height ?? "100%",
    objectFit: resolveObjectFit(layout?.fit),
    objectPosition: layout?.fit === "center" ? "center" : undefined,
    display: "block",
  };

  return (
    <div style={wrapperStyle}>
      <video
        ref={videoRef}
        style={mediaStyle}
        src={src}
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
        // @ts-ignore – non-standard but needed for some browsers
        controls={false}
      />
    </div>
  );
}
