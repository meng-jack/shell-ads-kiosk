import { useEffect, useRef, useState } from "react";
import SubmitPanel from "../components/SubmitPanel";
import AdQueue from "../components/AdQueue";
import type { PendingAd, SubmissionRecord } from "../types";
import { submissionStatus } from "../api";
import "../App.css";

const HISTORY_KEY = "shellnews_history";
const MAX_HISTORY = 20;

function loadHistory(): SubmissionRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(h: SubmissionRecord[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY)));
}

function recordToPendingAd(r: SubmissionRecord): PendingAd {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    url: r.url,
    durationSec: r.durationSec,
    submittedBy: r.submittedBy,
    status: r.status,
    submittedAt: new Date(r.submittedAt),
  };
}

export default function Submit() {
  const [history, setHistory] = useState<SubmissionRecord[]>(loadHistory);
  const pollRef = useRef<number>();

  // Poll submission statuses for known ad IDs every 5 seconds
  useEffect(() => {
    async function poll() {
      const current = loadHistory();
      if (current.length === 0) return;
      const ids = current.map((r) => r.id);
      try {
        const updates = await submissionStatus(ids);
        if (updates.length === 0) return;
        const statusMap = new Map(updates.map((u) => [u.id, u.status]));
        const updated = current.map((r) =>
          statusMap.has(r.id) ? { ...r, status: statusMap.get(r.id)! } : r,
        );
        saveHistory(updated);
        setHistory(updated);
      } catch {
        // Best-effort — ignore network errors
      }
    }

    poll();
    pollRef.current = window.setInterval(poll, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function handleSubmit(ad: PendingAd, submittedBy: string) {
    const record: SubmissionRecord = {
      id: ad.id,
      name: ad.name,
      type: ad.type,
      url: ad.url,
      durationSec: ad.durationSec,
      submittedBy,
      submittedAt: ad.submittedAt.toISOString(),
      status: "pending",
    };

    // Prepend to history, cap at MAX_HISTORY
    const updated = [record, ...history].slice(0, MAX_HISTORY);
    setHistory(updated);
    saveHistory(updated);

    try {
      await fetch("/api/submit-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ ...ad, submittedBy }]),
      });
    } catch {
      // Dev mode — launcher not running
    }
  }

  const pendingAds = history.map(recordToPendingAd);

  return (
    <div className="page">
      <p className="wordmark">Startup Shell</p>
      <p className="page-title">Submit an Ad</p>
      <div className="container">
        <SubmitPanel onSubmit={handleSubmit} />
        <AdQueue ads={pendingAds} />
      </div>
    </div>
  );
}

