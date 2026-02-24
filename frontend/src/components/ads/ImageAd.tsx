import type { CSSProperties } from "react";
import type { AdLayout, MediaFit } from "../../types";

type Props = {
  src?: string;
  alt?: string;
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

export default function ImageAd({ src, alt, layout }: Props) {
  if (!src) {
    return <div className="placeholder">Image creative missing</div>;
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
      <img style={mediaStyle} src={src} alt={alt ?? "Sponsored image"} />
    </div>
  );
}
