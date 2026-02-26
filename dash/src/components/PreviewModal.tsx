import "./PreviewModal.css";

export interface PreviewItem {
  name: string;
  type: string;
  /** URL to display — relative /media/ paths, absolute https:// URLs, or inline HTML */
  src: string;
}

interface Props {
  item: PreviewItem;
  onClose: () => void;
}

export default function PreviewModal({ item, onClose }: Props) {
  const isHtml = item.type === "html";

  return (
    <div
      className="pm-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="pm-modal">
        <div className="pm-header">
          <div className="pm-title">
            <span className="pm-name">{item.name}</span>
            <span className={`pm-type pm-type--${item.type}`}>{item.type}</span>
          </div>
          <button className="pm-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* 16:9 body for image/video; natural height for html */}
        <div className={isHtml ? "pm-body pm-body--html" : "pm-body"}>
          {!item.src && (
            <p className="pm-no-src">No preview available — media not yet cached.</p>
          )}
          {item.src && item.type === "image" && (
            <img className="pm-img" src={item.src} alt={item.name} />
          )}
          {item.src && item.type === "video" && (
            <video
              className="pm-video"
              src={item.src}
              controls
              autoPlay
              loop
              playsInline
            />
          )}
          {item.src && item.type === "html" && (
            <iframe
              className="pm-iframe"
              src={item.src}
              title={item.name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </div>
    </div>
  );
}
