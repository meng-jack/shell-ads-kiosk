import { Fragment } from "react";
import "./StartupShellAd.css";

const HIGHLIGHTS = [
  "Shell Members Exploring AR/VR",
  "Shellers Pitching at Business Expo",
  "Late Night at Startup Shell",
  "Nextdoor Founders Speaking to Shellers",
];

const STATS: { num: string; label: string }[] = [
  { num: "600+", label: "Member\ncommunity" },
  { num: "300+", label: "Student ventures\nsince 2012" },
  { num: "$100,000", label: "In available\nresources" },
];

export default function StartupShellAd() {
  return (
    <div className="ss-root">
      <div className="ss-inner">
        <div className="ss-header">
          <h1 className="ss-title">Startup Shell</h1>
          <p className="ss-tagline">
            UMD's home for creators and entrepreneurs
          </p>
        </div>

        <hr className="ss-rule" />

        <p className="ss-body">
          Startup Shell is a student-run startup incubator and co-working space
          at the University of Maryland. We provide the student entrepreneurship
          community with the space, resources, and network to explore ideas,
          collaborate, and scale their ventures.
        </p>

        <div className="ss-highlights">
          {HIGHLIGHTS.map((h) => (
            <span key={h} className="ss-highlight">
              {h}
            </span>
          ))}
        </div>

        <hr className="ss-rule" />

        <p className="ss-venture-value">
          Our community contains over{" "}
          <strong className="ss-venture-strong">$2 billion</strong> in venture
          value
        </p>

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
