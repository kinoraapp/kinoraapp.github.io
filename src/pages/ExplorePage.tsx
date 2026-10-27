import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Hash, Search, SearchX, TrendingUp, X } from "lucide-react";
import { Avatar } from "../components/Brand";
import { EmptyState, ErrorState, Spinner } from "../components/Feedback";
import { VideoGrid } from "../components/VideoGrid";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useBrowser";
import { listCategories, searchProfiles, searchVideos, trendingHashtags } from "../lib/api";
import { compactNumber } from "../lib/format";
import type { VideoCard } from "../lib/types";

export default function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag");
  const category = params.get("category");
  const [query, setQuery] = useState(params.get("q") ?? (tag ? `#${tag}` : ""));
  const debounced = useDebounced(query.trim(), 350);
  const [extra, setExtra] = useState<VideoCard[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (tag) setQuery(`#${tag}`);
  }, [tag]);

  // Keep the URL in sync so searches can be shared and survive reloads.
  useEffect(() => {
    const next = new URLSearchParams();
    if (debounced) next.set("q", debounced);
    if (category) next.set("category", category);
    setParams(next, { replace: true });
  }, [debounced, category, setParams]);

  const categories = useAsync(() => listCategories(), []);
  const trending = useAsync(() => trendingHashtags(), []);
  const people = useAsync(
    () => (debounced && !debounced.startsWith("#") ? searchProfiles(debounced) : Promise.resolve([])),
    [debounced],
  );
  const videos = useAsync(async () => {
    const rows = await searchVideos(debounced, category, 0);
    setExtra([]);
    setHasMore(rows.length === 24);
    return rows;
  }, [debounced, category]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await searchVideos(debounced, category, (videos.data?.length ?? 0) + extra.length);
      setExtra((e) => [...e, ...rows]);
      setHasMore(rows.length === 24);
    } finally {
      setLoadingMore(false);
    }
  };

  const setCategory = (slug: string | null) => {
    const next = new URLSearchParams(params);
    if (slug) next.set("category", slug);
    else next.delete("category");
    setParams(next, { replace: true });
  };

  const all = [...(videos.data ?? []), ...extra];

  return (
    <div className="page">
      <form className="search-bar" role="search" onSubmit={(e) => e.preventDefault()}>
        <Search size={18} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search videos, #hashtags or @creators"
          aria-label="Search"
          enterKeyHint="search"
        />
        {query && (
          <button type="button" className="icon-btn" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={16} />
          </button>
        )}
      </form>

      <div className="chips" role="list" aria-label="Categories">
        <button type="button" className={`chip-btn${!category ? " active" : ""}`} onClick={() => setCategory(null)}>
          All
        </button>
        {(categories.data ?? []).map((c) => (
          <button
            type="button"
            key={c.slug}
            className={`chip-btn${category === c.slug ? " active" : ""}`}
            onClick={() => setCategory(category === c.slug ? null : c.slug)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {!debounced && (trending.data ?? []).length > 0 && (
        <section className="section">
          <h2 className="section-title">
            <TrendingUp size={18} /> Trending hashtags
          </h2>
          <div className="chips">
            {trending.data!.map((t) => (
              <button type="button" key={t.tag} className="chip-btn" onClick={() => setQuery(`#${t.tag}`)}>
                <Hash size={14} /> {t.tag} <span className="muted small">{compactNumber(t.video_count)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(people.data ?? []).length > 0 && (
        <section className="section">
          <h2 className="section-title">Creators</h2>
          <ul className="people-row">
            {people.data!.map((p) => (
              <li key={p.id}>
                <Link to={`/u/${p.username}`} className="person-card">
                  <Avatar src={p.avatar_url} name={p.username} size={56} />
                  <strong className="truncate">{p.display_name || p.username}</strong>
                  <span className="muted small truncate">@{p.username}</span>
                  <span className="muted small">{compactNumber(p.follower_count)} followers</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">{debounced ? `Videos for “${debounced}”` : category ? "Latest in this category" : "Latest videos"}</h2>
        {videos.loading ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : videos.error ? (
          <ErrorState error={videos.error} onRetry={videos.reload} />
        ) : all.length === 0 ? (
          <EmptyState icon={<SearchX size={36} />} title="No videos found">
            Try a different word, hashtag or category.
          </EmptyState>
        ) : (
          <>
            <VideoGrid videos={all} />
            {hasMore && (
              <div className="center-pad">
                <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
