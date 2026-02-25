import { useState } from "react";
import type { AdType, PendingAd } from "../types";
import "./SubmitPanel.css";

interface Props {
  onSubmit: (ad: PendingAd) => void;
}

const TYPES: { value: AdType; label: string; placeholder: string }[] = [
  {
    value: "image",
    label: "Image",
    placeholder: "https://example.com/banner.png",
  },
  {
    value: "video",
    label: "Video",
    placeholder: "https://example.com/clip.mp4",
  },
  { value: "html", label: "HTML", placeholder: "https://example.com/ad.html" },
];

export default function SubmitPanel({ onSubmit }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AdType>("image");
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const placeholder = TYPES.find((t) => t.value === type)?.placeholder ?? "";

  function validate(): string | null {
    if (!name.trim()) return "Name is required.";
    if (!url.trim()) return "URL is required.";
    try {
      new URL(url.trim());
    } catch {
      return "Enter a valid URL.";
    }
    if (duration < 1 || duration > 120) return "Duration: 1–120 s.";
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onSubmit({
      id: crypto.randomUUID(),
      name: name.trim(),
      type,
      url: url.trim(),
      durationSec: duration,
      status: "pending",
      submittedAt: new Date(),
    });
    setOk(true);
    setTimeout(() => setOk(false), 2000);
    setName("");
    setUrl("");
    setDuration(15);
  }

  return (
    <form className="sp" onSubmit={handleSubmit} noValidate>
      <div className="sp-notice">
        Paste a public URL — direct uploads are not supported via Cloudflare
        Tunnel.
      </div>

      {/* Type */}
      <div className="sp-type-row">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`sp-type${type === t.value ? " sp-type--on" : ""}`}
            onClick={() => setType(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Name */}
      <div className="sp-field">
        <label className="sp-label" htmlFor="sp-name">
          Name
        </label>
        <input
          id="sp-name"
          className="sp-input"
          type="text"
          placeholder="Spring promo"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* URL */}
      <div className="sp-field">
        <label className="sp-label" htmlFor="sp-url">
          URL
        </label>
        <input
          id="sp-url"
          className="sp-input"
          type="url"
          placeholder={placeholder}
          value={url}
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      {/* Duration */}
      <div className="sp-field sp-field--row">
        <label className="sp-label" htmlFor="sp-dur">
          Duration (sec)
        </label>
        <input
          id="sp-dur"
          className="sp-input sp-input--num"
          type="number"
          min={1}
          max={120}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
        />
      </div>

      {error && <p className="sp-error">{error}</p>}

      <button
        className={`sp-btn${ok ? " sp-btn--ok" : ""}`}
        type="submit"
        disabled={ok}
      >
        {ok ? "✓ Submitted" : "Submit"}
      </button>
    </form>
  );
}
