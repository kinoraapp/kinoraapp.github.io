import { Link } from "react-router-dom";
import { Clock, EyeOff, Film, Globe, Link2, Lock, Play, Users } from "lucide-react";
import { usePosters } from "../hooks/usePlayback";
import { compactNumber, duration, visibilityLabel } from "../lib/format";
import type { VideoCard, Visibility } from "../lib/types";

export const visibilityIcon: Record<Visibility, typeof Globe> = {
  public: Globe,
  unlisted: Link2,
  private: Lock,
  selected: Users,
};

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const Icon = visibilityIcon[visibility];
  return (
    <span className={`badge badge-${visibility}`}>
      <Icon size={12} aria-hidden /> {visibilityLabel[visibility]}
    </span>
  );
}

/** Status chips for owners/admins: draft, scheduled, processing, removed. */
export function StatusBadges({ video }: { video: VideoCard }) {
  return (
    <>
      {video.moderation_status === "removed" && (
        <span className="badge badge-danger">
          <EyeOff size={12} /> Removed
        </span>
      )}
      {video.status === "draft" && <span className="badge">Draft</span>}
      {video.status === "scheduled" && !video.is_live && (
        <span className="badge badge-warning">
          <Clock size={12} /> Scheduled
        </span>
      )}
      {video.processing_status === "processing" && <span className="badge badge-info">Processing</span>}
      {video.processing_status === "awaiting_upload" && <span className="badge badge-info">Awaiting upload</span>}
      {video.processing_status === "errored" && <span className="badge badge-danger">Failed</span>}
    </>
  );
}

export function VideoGrid({
  videos,
  showStatus = false,
  linkFor = (v) => `/v/${v.id}`,
}: {
  videos: VideoCard[];
  showStatus?: boolean;
  linkFor?: (v: VideoCard) => string;
}) {
  const posters = usePosters(videos.map((v) => v.id));
  return (
    <ul className="video-grid">
      {videos.map((v) => (
        <li key={v.id}>
          <Link to={linkFor(v)} className="video-tile" aria-label={v.title}>
            {posters[v.id] ? (
              <img src={posters[v.id]!} alt="" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <span className="video-tile-placeholder" aria-hidden>
                <Film size={28} />
              </span>
            )}
            {showStatus && (
              <span className="video-tile-badges">
                {v.visibility !== "public" && <VisibilityBadge visibility={v.visibility} />}
                <StatusBadges video={v} />
              </span>
            )}
            <span className="video-tile-meta">
              <span>
                <Play size={12} fill="currentColor" aria-hidden /> {compactNumber(v.view_count)}
              </span>
              {v.duration_seconds ? <span>{duration(v.duration_seconds)}</span> : null}
            </span>
            <span className="video-tile-title">{v.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
