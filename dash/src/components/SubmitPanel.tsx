import { useRef, useState } from "react";
import type { AdType, PendingAd } from "../types";
import { uploadFile as uploadFileToServer } from "../api";
import "./SubmitPanel.css";

const FILE_IO_MAX = 500 * 1024 * 1024; // 500 MB server limit

// ── Per-type configuration ─────────────────────────────────────────────────
const TYPE_CONFIG: Record<
  AdType,
  {
    label: string;
    placeholder: string;
    accept: string;
    exts: string[];
    mimes: string[];
    description: string;
    urlHint: string;
    warning?: string;
  }
> = {
  image: {
    label: "Image",
    placeholder: "https://example.com/banner.png",
    accept: ".png,.jpg,.jpeg,.webp,.gif",
    exts: ["png", "jpg", "jpeg", "webp", "gif"],
    mimes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    description:
      "Displayed as a full-screen static image on the kiosk. Accepted formats: PNG, JPG / JPEG, WEBP, GIF.",
    urlHint:
      "Must be a direct public link ending in .png, .jpg, .jpeg, .webp, or .gif.",
  },
  video: {
    label: "Video",
    placeholder: "https://example.com/clip.mp4",
    accept: ".mp4,.webm",
    exts: ["mp4", "webm"],
    mimes: ["video/mp4", "video/webm"],
    description:
      "Played as a full-screen looping video on the kiosk. Accepted formats: MP4, WEBM.",
    urlHint: "Must be a direct public link ending in .mp4 or .webm.",
  },
  html: {
    label: "HTML",
    placeholder: "https://example.com/ad.html",
    accept: ".html,.htm",
    exts: ["html", "htm"],
    mimes: ["text/html"],
    description:
      "Rendered as a full-screen iframe on the kiosk. Accepted formats: HTML, HTM.",
    urlHint: "Must be a direct public link to a .html or .htm file.",
    warning:
      "Bundle all CSS, JavaScript, and images into a single self-contained file — no relative local file references. External CDN links are fine.\n\nUploading malicious, deceptive, or harmful content will result in immediate permanent removal and may carry severe legal consequences.",
  },
};

type InputMode = "upload" | "url";

interface Props {
  onSubmit: (ad: PendingAd) => void;
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return Math.round(b / 1e3) + " KB";
}

// Validate a File against the allowed extensions + MIME types for a given type.
function validateFileType(
  file: File,
  cfg: (typeof TYPE_CONFIG)[AdType],
): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type.toLowerCase();

  const extOk = cfg.exts.includes(ext);
  // Some browsers report empty MIME for .htm/.html — treat empty as ok if ext passes
  const mimeOk = mime === "" || cfg.mimes.some((m) => mime.startsWith(m));

  if (!extOk)
    return `Invalid file type (.${ext || "unknown"}). Allowed: ${cfg.exts.map((e) => "." + e.toUpperCase()).join(", ")}.`;
  if (!mimeOk)
    return `File MIME type "${mime}" is not allowed for this format.`;
  return null;
}

// Validate a URL's extension for the given type.
function validateUrlExt(
  url: string,
  cfg: (typeof TYPE_CONFIG)[AdType],
): string | null {
  try {
    const path = new URL(url).pathname.split("?")[0].toLowerCase();
    const ext = path.split(".").pop() ?? "";
    if (!cfg.exts.includes(ext))
      return `URL must point to a ${cfg.exts.map((e) => "." + e.toUpperCase()).join(" / ")} file.`;
  } catch {
    // URL parse error caught later
  }
  return null;
}

export default function SubmitPanel({ onSubmit }: Props) {
  const [mode, setMode] = useState<InputMode>("upload");
  const [name, setName] = useState("");
  const [type, setType] = useState<AdType>("image");
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cfg = TYPE_CONFIG[type];

  function switchType(t: AdType) {
    setType(t);
    // Reset upload state when switching types — a .png is not valid for video
    setUploadFile(null);
    setUploadedUrl(null);
    setUploadPct(0);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setUploadedUrl(null);
    setUploadPct(0);
    setError(null);
    if (!file) {
      setUploadFile(null);
      return;
    }

    const typeErr = validateFileType(file, cfg);
    if (typeErr) {
      setError(typeErr);
      setUploadFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > FILE_IO_MAX) {
      setError(`File too large (${fmtBytes(file.size)}) — max 500 MB.`);
      setUploadFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploadFile(file);
  }

  async function handleUpload() {
    if (!uploadFile) return;
    abortRef.current = new AbortController();
    setUploading(true);
    setError(null);
    setUploadPct(0);
    try {
      const link = await uploadFileToServer(
        uploadFile,
        setUploadPct,
        abortRef.current.signal,
      );
      setUploadedUrl(link);
    } catch (e: unknown) {
      if ((e as Error).message !== "Upload cancelled.")
        setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function handleCancelUpload() {
    abortRef.current?.abort();
  }

  function validate(): string | null {
    if (!name.trim()) return "Name is required.";
    const finalUrl = mode === "upload" ? (uploadedUrl ?? "") : url.trim();
    if (!finalUrl)
      return mode === "upload"
        ? "Upload a file first, or switch to Paste URL."
        : "URL is required.";
    // Server uploads return a /media/ path — skip absolute URL validation for those.
    if (mode !== "upload" || !finalUrl.startsWith("/media/")) {
      try {
        new URL(finalUrl);
      } catch {
        return "Enter a valid URL (must start with https://).";
      }
    }
    if (mode === "url") {
      const extErr = validateUrlExt(finalUrl, cfg);
      if (extErr) return extErr;
    }
    if (duration < 1 || duration > 120)
      return "Duration must be between 1 and 120 seconds.";
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
    const finalUrl = mode === "upload" ? uploadedUrl! : url.trim();
    onSubmit({
      id: crypto.randomUUID(),
      name: name.trim(),
      type,
      url: finalUrl,
      durationSec: duration,
      status: "pending",
      submittedAt: new Date(),
    });
    setOk(true);
    setTimeout(() => setOk(false), 2500);
    setName("");
    setUrl("");
    setDuration(15);
    setUploadFile(null);
    setUploadedUrl(null);
    setUploadPct(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <form className="sp" onSubmit={handleSubmit} noValidate>
      {/* ── Ad type ───────────────────────────────────────────────── */}
      <div className="sp-type-row">
        {(Object.keys(TYPE_CONFIG) as AdType[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`sp-type${type === t ? " sp-type--on" : ""}`}
            onClick={() => switchType(t)}
          >
            {TYPE_CONFIG[t].label}
          </button>
        ))}
      </div>

      {/* ── Type description ──────────────────────────────────────── */}
      <p className="sp-desc">{cfg.description}</p>

      {/* ── HTML warning ──────────────────────────────────────────── */}
      {type === "html" && cfg.warning && (
        <div className="sp-warning">
          {cfg.warning.split("\n\n").map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}

      {/* ── Name ──────────────────────────────────────────────────── */}
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

      {/* ── Input mode switch ─────────────────────────────────────── */}
      <div className="sp-mode-row">
        <button
          type="button"
          className={`sp-mode-btn${mode === "upload" ? " sp-mode-btn--on" : ""}`}
          onClick={() => {
            setMode("upload");
            setError(null);
          }}
        >
          ↑ Upload file
        </button>
        <button
          type="button"
          className={`sp-mode-btn${mode === "url" ? " sp-mode-btn--on" : ""}`}
          onClick={() => {
            setMode("url");
            setError(null);
          }}
        >
          ⊹ Paste URL
        </button>
      </div>

      {/* ── Upload panel ──────────────────────────────────────────── */}
      {mode === "upload" && (
        <div className="sp-upload-zone">
          <p className="sp-upload-note">
            Your file is uploaded securely to this server. Max{" "}
            <strong>500 MB</strong>.
          </p>

          {!uploadedUrl ? (
            <>
              <input
                ref={fileRef}
                type="file"
                id="sp-file"
                className="sp-file-input"
                accept={cfg.accept}
                onChange={handleFileChange}
              />
              <label
                htmlFor="sp-file"
                className={`sp-file-label${uploadFile ? " sp-file-label--has-file" : ""}`}
              >
                {uploadFile ? (
                  <>
                    <span className="sp-file-name">{uploadFile.name}</span>
                    <span className="sp-file-size">
                      {fmtBytes(uploadFile.size)}
                    </span>
                  </>
                ) : (
                  <>
                    <span>Click to choose a file</span>
                    <span className="sp-file-accept">
                      {cfg.exts.map((e) => "." + e.toUpperCase()).join("  ")}
                    </span>
                  </>
                )}
              </label>

              {uploadFile && !uploading && (
                <button
                  type="button"
                  className="sp-upload-btn"
                  onClick={handleUpload}
                >
                  Upload file
                </button>
              )}

              {uploading && (
                <div className="sp-progress-wrap">
                  <div className="sp-progress">
                    <div
                      className="sp-progress-bar"
                      style={{ width: `${uploadPct}%` }}
                    />
                  </div>
                  <div className="sp-progress-row">
                    <span className="sp-progress-pct">{uploadPct}%</span>
                    <button
                      type="button"
                      className="sp-cancel-btn"
                      onClick={handleCancelUpload}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="sp-uploaded-ok">
              <span className="sp-uploaded-check">✓</span>
              <div className="sp-uploaded-info">
                <span className="sp-uploaded-label">Uploaded successfully</span>
                <a
                  className="sp-uploaded-url"
                  href={uploadedUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {uploadedUrl}
                </a>
              </div>
              <button
                type="button"
                className="sp-replace-btn"
                onClick={() => {
                  setUploadedUrl(null);
                  setUploadFile(null);
                  setUploadPct(0);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Replace
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── URL panel ─────────────────────────────────────────────── */}
      {mode === "url" && (
        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-url">
            URL
          </label>
          <input
            id="sp-url"
            className="sp-input"
            type="url"
            placeholder={cfg.placeholder}
            value={url}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
          />
          <span className="sp-url-note">{cfg.urlHint}</span>
        </div>
      )}

      {/* ── Duration ──────────────────────────────────────────────── */}
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

      {/* ── Error ─────────────────────────────────────────────────── */}
      {error && <p className="sp-error">⚠ {error}</p>}

      {/* ── Submit ────────────────────────────────────────────────── */}
      <button
        className={`sp-btn${ok ? " sp-btn--ok" : ""}`}
        type="submit"
        disabled={ok || uploading}
      >
        {ok ? "✓ Submitted" : "Submit"}
      </button>
    </form>
  );
}
