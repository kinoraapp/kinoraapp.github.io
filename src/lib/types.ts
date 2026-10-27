export type Role = "viewer" | "creator" | "admin";
export type CreatorStatus = "none" | "pending" | "approved" | "rejected";
export type Visibility = "public" | "unlisted" | "private" | "selected";
export type VideoStatus = "draft" | "scheduled" | "published";
export type ProcessingStatus = "awaiting_upload" | "processing" | "ready" | "errored";
export type ModerationStatus = "active" | "removed";
export type ReportStatus = "open" | "resolved" | "dismissed";
export type ReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "violence"
  | "sexual"
  | "self_harm"
  | "misinformation"
  | "copyright"
  | "other";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  website: string | null;
  avatar_url: string | null;
  role: Role;
  creator_status: CreatorStatus;
  creator_request_note: string | null;
  can_upload: boolean;
  is_suspended: boolean;
  suspended_reason: string | null;
  follower_count: number;
  following_count: number;
  created_at: string;
}

export interface VideoCard {
  id: string;
  owner_id: string;
  title: string;
  caption: string;
  hashtags: string[];
  category_slug: string | null;
  visibility: Visibility;
  status: VideoStatus;
  publish_at: string | null;
  published_at: string | null;
  live_at: string | null;
  is_live: boolean;
  allow_comments: boolean;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  mux_playback_id: string | null;
  duration_seconds: number | null;
  aspect_ratio: string | null;
  thumbnail_path: string | null;
  moderation_status: ModerationStatus;
  moderation_reason: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  created_at: string;
  updated_at: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface CommentRow {
  id: string;
  video_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  is_hidden: boolean;
  created_at: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export type NotificationType =
  | "like"
  | "comment"
  | "reply"
  | "follow"
  | "new_video"
  | "access_granted"
  | "creator_request"
  | "creator_approved"
  | "creator_rejected"
  | "video_ready"
  | "video_failed"
  | "video_removed"
  | "video_restored"
  | "report_update"
  | "account";

export interface NotificationRow {
  id: string;
  type: NotificationType;
  actor_id: string | null;
  video_id: string | null;
  comment_id: string | null;
  message: string;
  read_at: string | null;
  created_at: string;
  actor: { username: string; display_name: string; avatar_url: string | null } | null;
  video: { title: string } | null;
}

export interface Category {
  slug: string;
  name: string;
  sort_order: number;
}

export interface Playlist {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  video_count: number;
}

export interface AccessEntry {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  source: "grant" | "link";
  granted_by_username: string | null;
  created_at: string;
}

export interface DayPoint {
  day: string;
  views?: number;
  users?: number;
}

export interface CreatorStats {
  videos: number;
  published: number;
  scheduled: number;
  drafts: number;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  followers: number;
  views_by_day: DayPoint[];
  top_videos: { id: string; title: string; view_count: number; like_count: number; comment_count: number }[];
}

export interface AdminStats {
  users: number;
  creators: number;
  admins: number;
  suspended: number;
  pending_creators: number;
  videos: number;
  public_videos: number;
  unlisted_videos: number;
  private_videos: number;
  selected_videos: number;
  live_videos: number;
  draft_videos: number;
  scheduled_videos: number;
  processing_videos: number;
  failed_videos: number;
  removed_videos: number;
  views: number;
  likes: number;
  comments: number;
  open_reports: number;
  storage: { video_bytes: number; video_seconds: number; thumbnail_bytes: number; avatar_bytes: number };
  views_by_day: DayPoint[];
  signups_by_day: DayPoint[];
}

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  email: string;
  role: Role;
  creator_status: CreatorStatus;
  creator_request_note: string | null;
  can_upload: boolean;
  is_suspended: boolean;
  suspended_reason: string | null;
  follower_count: number;
  video_count: number;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface AdminReport {
  id: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  reporter_username: string;
  video_id: string | null;
  video_title: string | null;
  video_moderation: ModerationStatus | null;
  comment_id: string | null;
  comment_body: string | null;
  comment_hidden: boolean | null;
  reported_user_id: string | null;
  reported_username: string | null;
  reported_suspended: boolean | null;
}

export interface AdminComment {
  id: string;
  body: string;
  is_hidden: boolean;
  created_at: string;
  video_id: string;
  author: { username: string } | null;
  video: { title: string } | null;
}
