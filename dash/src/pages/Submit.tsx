import { useState } from "react";
import SubmitPanel from "../components/SubmitPanel";
import AdQueue from "../components/AdQueue";
import type { PendingAd } from "../types";
import "../App.css";

export default function Submit() {
  const [queue, setQueue] = useState<PendingAd[]>([]);

  async function handleSubmit(ad: PendingAd) {
    setQueue((p) => [...p, ad]);
    try {
      await fetch("/api/submit-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([ad]),
      });
    } catch {
      // Dev mode — launcher not running
    }
  }

  return (
    <div className="page">
      <p className="wordmark">Startup Shell</p>
      <p className="page-title">Submit an Ad</p>
      <div className="container">
        <SubmitPanel onSubmit={handleSubmit} />
        <AdQueue ads={queue} />
      </div>
    </div>
  );
}
