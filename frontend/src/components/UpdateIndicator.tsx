import type { main } from "../../wailsjs/go/models";

interface Props {
  updateInfo: main.UpdateInfo | null;
  devMode: boolean;
}

export default function UpdateIndicator({ updateInfo, devMode }: Props) {
  if (!updateInfo?.available) {
    return null;
  }

  return (
    <div className={`update-indicator ${devMode ? "dev" : "prod"}`}>
      <span className="update-pulse" />
      <span className="update-text">
        {devMode ? "UPDATE AVAILABLE" : "Update…"}
      </span>
    </div>
  );
}
