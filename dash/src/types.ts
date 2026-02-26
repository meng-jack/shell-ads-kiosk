export type BadgeVariant = "green" | "yellow" | "red" | "blue";

export interface DetailRow {
  label: string;
  value: string;
}

export interface CardData {
  title: string;
  badge: {
    text: string;
    variant: BadgeVariant;
  };
  rows: DetailRow[];
}

export type AdType = "image" | "video" | "html";
export type AdStatus = "submitted" | "approved" | "live" | "denied" | "unknown";

export interface PendingAd {
  id: string;
  name: string;
  type: AdType;
  url: string;
  durationSec: number;
  status: AdStatus;
  submittedAt: Date;
  submittedBy: string;
}
