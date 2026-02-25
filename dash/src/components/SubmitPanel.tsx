import { useRef, useState } from "react";
import type { AdType, PendingAd } from "../types";
import "./SubmitPanel.css";

const FILE_IO_MAX = 4 * 1024 * 1024 * 1024; // 4 GB — file.io limit

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

type InputMode = "upload" | "url";

interface Props {
  onSubmit: (ad: PendingAd) => void;
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return Math.round(b / 1e3) + " KB";
}

function uploadToFileIo(
  fd: FormData,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://file.io/?expires=14d");
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText) as {
          success: boolean;
          link?: string;
          message?: string;
        };
        if (data.success && data.link) resolve(data.link);
        else
          reject(
            new Error(data.message ?? "Upload failed — no link returned."),
          );
      } catch {
        reject(new Error("Unexpected response from file.io."));
      }
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Network error — check your connection and try again.")),
    );
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(fd);
  });
}

export default function SubmitPanel({ onSubmit }: Props) {
  const [mode, setMode] = useState<InputMode>("upload");
  const [name, setName] = useState("");
  const [type, setType] = useState<AdType>("image");
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Upload-specific state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setUploadedUrl(null);
    setUploadPct(0);
    setError(null);
    if (!file) {
      setUploadFile(null);
      return;
    }
    if (file.size > FILE_IO_MAX) {
      setError(`File too large (${fmtBytes(file.size)}) — max 4 GB.`);
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
    const fd = new FormData();
    fd.append("file", uploadFile);
    try {
      const link = await uploadToFileIo(
        fd,
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
    try {
      new URL(finalUrl);
    } catch {
      return "Enter a valid URL (must start with https://).";
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
      {/* ── Ad type ─────────────────────────────────────────────────── */}
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

      {/* ── Name ────────────────────────────────────────────────────── */}
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

      {/* ── Input mode switch ────────────────────────────────────────── */}
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

      {/* ── Upload panel ─────────────────────────────────────────────── */}
      {mode === "upload" && (
        <div className="sp-upload-zone">
          <p className="sp-upload-note">
            Your browser uploads directly to{" "}
            <a
              className="sp-link"
              href="https://file.io"
              target="_blank"
              rel="noreferrer"
            >
              file.io
            </a>{" "}
            — the file never passes through this server or the Cloudflare
            tunnel. Max&nbsp;<strong>4 GB</strong>. Link expires after 14 days.
          </p>

          {!uploadedUrl ? (
            <>
              <input
                ref={fileRef}
                type="file"
                id="sp-file"
                className="sp-file-input"
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
                  <span>Click to choose a file</span>
                )}
              </label>

              {uploadFile && !uploading && (
                <button
                  type="button"
                  className="sp-upload-btn"
                  onClick={handleUpload}
                >
                  Upload to file.io
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

      {/* ── URL panel ────────────────────────────────────────────────── */}
      {mode === "url" && (
        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-url">
            URL
          </label>
          <input
            id="sp-url"
            className="sp-input"
            type="url"
            placeholder={TYPES.find((t) => t.value === type)?.placeholder ?? ""}
            value={url}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
          />
          <span className="sp-url-note">
            Must be a publicly accessible direct link.
          </span>
        </div>
      )}

      {/* ── Duration ─────────────────────────────────────────────────── */}
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

      {/* ── Error ────────────────────────────────────────────────────── */}
      {error && <p className="sp-error">⚠ {error}</p>}

      {/* ── Submit ───────────────────────────────────────────────────── */}
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
