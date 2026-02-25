export type BadgeVariant = "green" | "yellow" | "red" | "blue";

export interface DetailRow {
  label: string;
  value: string;
}

export interface CardData {
  title: string;
  badge: { text: string; variant: BadgeVariant };
  rows: DetailRow[];
}

export type AdType = "image" | "video" | "html";
export type AdStatus = "pending" | "approved" | "rejected";

// Stage returned by the server for a user's own submission.
// submitted = pending admin review
// approved  = admin approved, in holding queue
// active    = currently in live playlist on kiosk
// removed   = admin rejected / user retracted
export type SubmissionStage = "submitted" | "approved" | "active" | "removed";

export interface PendingAd {
  id: string;
  name: string;
  type: AdType;
  url: string;
  durationSec: number;
  status: AdStatus;
  submittedAt: Date;
}

export interface UserAd {
  id: string;
  name: string;
  type: string;
  src: string;
  durationMs: number;
  stage: SubmissionStage;
  shownOnKiosk: boolean;
  submittedAt: string; // ISO string from server
}

export interface GoogleUser {
  sub: string;
  email: string;
  name: string;
  picture: string;
  idToken: string; // raw credential to send as X-Google-Token
}
