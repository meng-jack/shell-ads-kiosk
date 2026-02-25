import { useState } from "react";
import SubmitPanel from "./components/SubmitPanel";
import AdQueue from "./components/AdQueue";
import type { PendingAd } from "./types";
import "./App.css";

export default function App() {
  const [queue, setQueue] = useState<PendingAd[]>([]);

  return (
    <div className="page">
      <p className="wordmark">Startup Shell</p>
      <div className="container">
        <SubmitPanel onSubmit={(ad) => setQueue((p) => [...p, ad])} />
        <AdQueue ads={queue} />
      </div>
    </div>
  );
}
