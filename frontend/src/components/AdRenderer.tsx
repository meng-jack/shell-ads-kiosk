import type { Ad } from "../types";
import HtmlAd from "./ads/HtmlAd";
import ImageAd from "./ads/ImageAd";
import VideoAd from "./ads/VideoAd";

type Props = {
  ad: Ad;
  /** Local cached src to use instead of ad.src (locked per slot). */
  overrideSrc?: string;
};

export default function AdRenderer({ ad, overrideSrc }: Props) {
  if (!ad) return null;

  const src = overrideSrc ?? ad.src;

  switch (ad.type) {
    case "image":
      return <ImageAd src={src} alt={ad.id} layout={ad.layout} />;
    case "video":
      return (
        <VideoAd
          src={src}
          poster={ad.poster}
          durationMs={ad.durationMs}
          layout={ad.layout}
        />
      );
    case "html":
      return <HtmlAd html={ad.html} />;
    default:
      return <div className="placeholder">Unsupported creative</div>;
  }
}
