import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Compass, SquarePlus, Users } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { VideoFeed, type ViewerState } from "../components/Feed";
import { EmptyState, ErrorState, PageLoader } from "../components/Feedback";
import { LogoMark } from "../components/Brand";
import { getFollowingIds, getViewerState, listFeed } from "../lib/api";
import type { VideoCard } from "../lib/types";

const PAGE_SIZE = 8;
type Tab = "foryou" | "following";

export default function HomePage() {
  const { user, canUpload, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("foryou");
  const [videos, setVideos] = useState<VideoCard[]>([]);
  const [viewer, setViewer] = useState<ViewerState>({ liked: new Set(), saved: new Set(), following: new Set() });
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const generation = useRef(0);
  const busy = useRef(false);
  const followingIds = useRef<string[] | null>(null);

  const load = useCallback(
    async (offset: number) => {
      if (busy.current) return;
      busy.current = true;
      const gen = generation.current;
      setError(null);
      try {
        if (user && followingIds.current === null) {
          followingIds.current = await getFollowingIds();
          if (gen === generation.current) {
            setViewer((v) => ({ ...v, following: new Set(followingIds.current) }));
          }
        }
        const page = await listFeed({
          offset,
          limit: PAGE_SIZE,
          ownerIds: tab === "following" ? (followingIds.current ?? []) : undefined,
        });
        const state = await getViewerState(page.map((v) => v.id));
        if (gen !== generation.current) return;
        setVideos((prev) => {
          const seen = new Set(prev.map((v) => v.id));
          return [...prev, ...page.filter((v) => !seen.has(v.id))];
        });
        setViewer((v) => ({
          ...v,
          liked: new Set([...v.liked, ...state.liked]),
          saved: new Set([...v.saved, ...state.saved]),
        }));
        setHasMore(page.length === PAGE_SIZE);
      } catch (e) {
        if (gen === generation.current) setError(e);
      } finally {
        if (gen === generation.current) {
          busy.current = false;
          setInitialLoading(false);
        }
      }
    },
    [tab, user],
  );

  // Start over when the tab or the signed-in user changes.
  useEffect(() => {
    if (authLoading) return;
    generation.current++;
    busy.current = false;
    followingIds.current = null;
    setVideos([]);
    setHasMore(true);
    setInitialLoading(true);
    load(0);
  }, [tab, user?.id, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    if (!error) load(videos.length);
  }, [load, videos.length, error]);

  let body;
  if (initialLoading) {
    body = <PageLoader label="Loading videos" />;
  } else if (error && videos.length === 0) {
    body = <ErrorState error={error} onRetry={() => load(0)} />;
  } else if (videos.length === 0) {
    body =
      tab === "following" ? (
        <EmptyState
          icon={<Users size={40} />}
          title={user ? "Nothing from people you follow yet" : "Sign in to see who you follow"}
          action={
            <Link className="btn btn-primary" to={user ? "/explore" : "/login"}>
              {user ? "Find creators" : "Log in"}
            </Link>
          }
        >
          {user ? "Follow creators and their new videos will show up here." : undefined}
        </EmptyState>
      ) : (
        <EmptyState
          icon={<Compass size={40} />}
          title="No videos yet"
          action={
            canUpload ? (
              <Link className="btn btn-primary" to="/upload">
                <SquarePlus size={18} /> Upload the first one
              </Link>
            ) : undefined
          }
        >
          Public videos will appear here as soon as creators publish them.
        </EmptyState>
      );
  } else {
    body = <VideoFeed videos={videos} viewer={viewer} setViewer={setViewer} hasMore={hasMore} loadMore={loadMore} />;
  }

  return (
    <div className="home">
      <header className="feed-tabs">
        <Link to="/" className="feed-tabs-logo mobile-only" aria-label="Home">
          <LogoMark size={28} />
        </Link>
        <div className="feed-tabs-inner" role="tablist" aria-label="Feed">
          <button type="button" role="tab" aria-selected={tab === "following"} className={tab === "following" ? "active" : ""} onClick={() => setTab("following")}>
            Following
          </button>
          <button type="button" role="tab" aria-selected={tab === "foryou"} className={tab === "foryou" ? "active" : ""} onClick={() => setTab("foryou")}>
            For You
          </button>
        </div>
      </header>
      {body}
    </div>
  );
}
