import { useState } from "react";
import SubmitPanel from "./components/SubmitPanel";
import AdQueue from "./components/AdQueue";
import type { PendingAd } from "./types";
import "./App.css";

export default function App() {
  const [queue, setQueue] = useState<PendingAd[]>([]);

  async function handleSubmit(ad: PendingAd) {
    setQueue((p) => [...p, ad]);
    // Send to launcher immediately — queued as pending until the operator
    // presses Z on the kiosk display to activate them.
    try {
      await fetch("/api/submit-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([ad]),
      });
    } catch {
      // Dev mode — launcher not running, local state is enough for mockup
    }
  }

  return (
    <div className="page">
      <p className="wordmark">Startup Shell</p>
      <div className="container">
        <SubmitPanel onSubmit={handleSubmit} />
        <AdQueue ads={queue} />
      </div>
    </div>
  );
}
