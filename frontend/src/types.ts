export type AdType = "image" | "video" | "html" | "startup-shell";
export type TransitionName = "fade" | "slide-left" | "slide-up" | "zoom";
export type MediaFit =
  | "contain"
  | "cover"
  | "fill"
  | "stretch"
  | "center"
  | "none";

export interface Transition {
  enter?: TransitionName;
  exit?: TransitionName;
}

export interface AdLayout {
  /** How the media is scaled inside its container. Default: "contain". */
  fit?: MediaFit;
  /** Uniform padding in pixels around the media element. */
  paddingPx?: number;
  /** CSS background color shown behind the media (visible with padding / letterboxing). */
  background?: string;
  /** Override the rendered width of the media element (CSS value, e.g. "80%", "1280px"). */
  width?: string;
  /** Override the rendered height of the media element. */
  height?: string;
}

export interface Ad {
  id: string; // Internal identifier (not displayed)
  name?: string; // User-friendly display name
  type: AdType;
  src?: string;
  poster?: string;
  html?: string;
  durationMs?: number;
  transition?: Transition;
  layout?: AdLayout;
}
