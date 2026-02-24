import { Fragment } from "react";
import "./StartupShellAd.css";

const STATS: { num: string; label: string }[] = [
  { num: "600+", label: "Members" },
  { num: "300+", label: "Ventures" },
  { num: "$2B+", label: "Venture Value" },
];

export default function StartupShellAd() {
  return (
    <div className="ss-root">
      <div className="ss-inner">
        <h1 className="ss-title">Startup Shell</h1>
        <p className="ss-tagline">UMD's Home for Creators & Entrepreneurs</p>

        <div className="ss-rule" />

        <div className="ss-stats">
          {STATS.map(({ num, label }, i) => (
            <Fragment key={num}>
              {i > 0 && <div className="ss-stat-divider" />}
              <div className="ss-stat">
                <span className="ss-stat-num">{num}</span>
                <span className="ss-stat-label">{label}</span>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
