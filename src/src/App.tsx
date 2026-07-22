import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { HeroBanner } from './components/HeroBanner';
import { MovieRow } from './components/MovieRow';
import { MovieModal } from './components/MovieModal';
import { AddVideoModal } from './components/AddVideoModal';
import { AddPlaylistModal } from './components/AddPlaylistModal';
import { Sparkles, Film, Plus, ChevronDown } from 'lucide-react';
import { parseTags } from './utils';
import { ContentRow } from './components/ContentRow';
import type { Content } from './components/ContentRow';

interface ContentSource {
  provider_id: string;
  provider_name: string;
  page_url: string;
  season_number?: number | null;
}

interface ContentDetail {
  content: Content;
  sources: ContentSource[];
}
import { ContentLandingModal } from './components/ContentLandingModal';
import { ProviderList } from './components/ProviderList';

export interface Video {
  id: string;
  title: string;
  page_url: string;
  cover_url?: string | null;
  tags?: string | null;
  playlist_id?: string | null;
  added_at: string;
}

export interface Playlist {
  id: string;
  name: string;
}

const DEMO_VIDEOS: Video[] = [
  {
    id: 'demo-1',
    title: 'Building Next-Gen Desktop Shells with Tauri v2 & React 19',
    page_url: 'https://tauri.app',
    cover_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
    tags: JSON.stringify(['tauri', 'react', 'rust', 'featured']),
    playlist_id: 'pl-1',
    added_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString()
  },
  {
    id: 'demo-2',
    title: 'High Performance Frontend Architecture & Vite 8 Deep Dive',
    page_url: 'https://vite.dev',
    cover_url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80',
    tags: JSON.stringify(['vite', 'javascript', 'performance']),
    playlist_id: 'pl-1',
    added_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString()
  },
  {
    id: 'demo-3',
    title: 'Rust & Sqlx SQLite Database Architecture for Desktop Applications',
    page_url: 'https://www.rust-lang.org',
    cover_url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1200&q=80',
    tags: JSON.stringify(['rust', 'sqlite', 'backend']),
    playlist_id: 'pl-2',
    added_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString()
  },
  {
    id: 'demo-4',
    title: 'Modern UI/UX Design System with Dark Glassmorphism',
    page_url: 'https://dribbble.com',
    cover_url: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=1200&q=80',
    tags: JSON.stringify(['design', 'css', 'ui']),
    playlist_id: 'pl-1',
    added_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
  },
  {
    id: 'demo-5',
    title: 'GitHub Interface Framework & Antigravity Assistant Capabilities',
    page_url: 'https://github.com',
    cover_url: 'https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?auto=format&fit=crop&w=1200&q=80',
    tags: JSON.stringify(['git', 'antigravity', 'rust']),
    playlist_id: 'pl-2',
    added_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString()
  }
];

const DEMO_PLAYLISTS: Playlist[] = [
  { id: 'pl-1', name: 'Web Dev & Tauri' },
  { id: 'pl-2', name: 'Rust & Backend Tutorials' }
];

const PAGE_SIZE = 500;
const GENRE_ROWS = ['Action', 'Drama', 'Thriller', 'Comedy', 'Crime', 'Horror', 'Romance'] as const;
type GenreName = typeof GENRE_ROWS[number];

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function callTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<T>(command, args);
    }
  } catch (err) {
    console.warn(`[Tauri IPC fallback] Command "${command}" not natively executed:`, err);
  }
  return null;
}

export default function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('home');

  const [isAddVideoOpen, setIsAddVideoOpen] = useState(false);
  const [isAddPlaylistOpen, setIsAddPlaylistOpen] = useState(false);
  const [selectedVideoModal, setSelectedVideoModal] = useState<Video | null>(null);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  // Catalog state with pagination
  const [movies, setMovies] = useState<Content[]>([]);
  const [tvShows, setTvShows] = useState<Content[]>([]);
  const [movieOffset, setMovieOffset] = useState(0);
  const [tvOffset, setTvOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [heroContent, setHeroContent] = useState<Content[]>([]);
  const [genreRows, setGenreRows] = useState<Record<GenreName, Content[]>>({} as Record<GenreName, Content[]>);
  const [movieGenreRows, setMovieGenreRows] = useState<Record<GenreName, Content[]>>({} as Record<GenreName, Content[]>);
  const [tvGenreRows, setTvGenreRows] = useState<Record<GenreName, Content[]>>({} as Record<GenreName, Content[]>);

  // Catalog search results (separate from video search)
  const [catalogSearchResults, setCatalogSearchResults] = useState<Content[]>([]);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCatalogPage = useCallback(async (
    mediaType: 'movie' | 'tv_show',
    offset: number,
    search?: string,
  ): Promise<Content[]> => {
    const result = await callTauri<Content[]>('list_content', {
      search: search?.trim() || null,
      mediaType,
      limit: PAGE_SIZE,
      offset,
    });
    return result ?? [];
  }, []);

  const refreshData = async () => {
    setLoading(true);
    const vList = await callTauri<Video[]>('list_videos');
    const pList = await callTauri<Playlist[]>('list_playlists');

    if (vList !== null) {
      setVideos(vList);
      // DB is authoritative — clear any stale localStorage
      localStorage.removeItem('flud_netflix_videos');
    } else {
      const savedV = localStorage.getItem('flud_netflix_videos');
      setVideos(savedV ? JSON.parse(savedV) : []);
    }

    if (pList !== null) {
      setPlaylists(pList);
      localStorage.removeItem('flud_netflix_playlists');
    } else {
      const savedP = localStorage.getItem('flud_netflix_playlists');
      setPlaylists(savedP ? JSON.parse(savedP) : []);
    }

    // Initial page load — offset 0 for both
    const [mList, tvList] = await Promise.all([
      fetchCatalogPage('movie', 0),
      fetchCatalogPage('tv_show', 0),
    ]);

    setMovies(mList);
    setTvShows(tvList);
    setMovieOffset(mList.length);
    setTvOffset(tvList.length);

    const recentList = await callTauri<Content[]>('list_recent_content', { limit: 20 });
    setHeroContent(recentList ?? []);

    const [genreResults, movieGenreResults, tvGenreResults] = await Promise.all([
      Promise.all(GENRE_ROWS.map((genre) => callTauri<Content[]>('list_content_by_genre', { genre, limit: 48 }))),
      Promise.all(GENRE_ROWS.map((genre) => callTauri<Content[]>('list_content_by_genre', { genre, mediaType: 'movie', limit: 48 }))),
      Promise.all(GENRE_ROWS.map((genre) => callTauri<Content[]>('list_content_by_genre', { genre, mediaType: 'tv_show', limit: 48 }))),
    ]);
    const newGenreRows = {} as Record<GenreName, Content[]>;
    const newMovieGenreRows = {} as Record<GenreName, Content[]>;
    const newTvGenreRows = {} as Record<GenreName, Content[]>;
    GENRE_ROWS.forEach((genre, i) => {
      newGenreRows[genre] = genreResults[i] ?? [];
      newMovieGenreRows[genre] = movieGenreResults[i] ?? [];
      newTvGenreRows[genre] = tvGenreResults[i] ?? [];
    });
    setGenreRows(newGenreRows);
    setMovieGenreRows(newMovieGenreRows);
    setTvGenreRows(newTvGenreRows);

    setLoading(false);
  };

  useEffect(() => {
    refreshData();
  }, []);

  // Debounced catalog search — triggers on searchQuery change
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!searchQuery.trim()) {
      setCatalogSearchResults([]);
      return;
    }

    setCatalogSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      const [mResults, tvResults] = await Promise.all([
        fetchCatalogPage('movie', 0, searchQuery),
        fetchCatalogPage('tv_show', 0, searchQuery),
      ]);
      setCatalogSearchResults([...mResults, ...tvResults]);
      setCatalogSearching(false);
    }, 300);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, fetchCatalogPage]);

  const loadMoreMovies = async () => {
    setLoadingMore(true);
    const next = await fetchCatalogPage('movie', movieOffset);
    setMovies((prev) => [...prev, ...next]);
    setMovieOffset((prev) => prev + next.length);
    setLoadingMore(false);
  };

  const loadMoreTv = async () => {
    setLoadingMore(true);
    const next = await fetchCatalogPage('tv_show', tvOffset);
    setTvShows((prev) => [...prev, ...next]);
    setTvOffset((prev) => prev + next.length);
    setLoadingMore(false);
  };

  const updateLocalVideos = (newV: Video[]) => {
    setVideos(newV);
    localStorage.setItem('flud_netflix_videos', JSON.stringify(newV));
  };

  const updateLocalPlaylists = (newP: Playlist[]) => {
    setPlaylists(newP);
    localStorage.setItem('flud_netflix_playlists', JSON.stringify(newP));
  };

  const handleAddVideo = async (title: string, pageUrl: string, coverUrl: string, tagsInput: string) => {
    const tagsArray = tagsInput.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    const res = await callTauri<void>('add_video', {
      title, pageUrl, coverUrl: coverUrl.trim() ? coverUrl.trim() : null, tags: tagsArray
    });
    if (res !== null) {
      await refreshData();
    } else {
      updateLocalVideos([{
        id: `v-${Date.now()}`, title, page_url: pageUrl,
        cover_url: coverUrl.trim() || null, tags: JSON.stringify(tagsArray),
        playlist_id: null, added_at: new Date().toISOString()
      }, ...videos]);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    const res = await callTauri<void>('delete_video', { id });
    if (res !== null) await refreshData();
    else updateLocalVideos(videos.filter((v) => v.id !== id));
    if (selectedVideoModal?.id === id) setSelectedVideoModal(null);
  };

  const handleAddPlaylist = async (name: string) => {
    const res = await callTauri<string>('create_playlist', { name });
    if (res !== null) await refreshData();
    else updateLocalPlaylists([...playlists, { id: `pl-${Date.now()}`, name }]);
  };

  const handleSetVideoPlaylist = async (videoId: string, playlistId: string | null) => {
    const res = await callTauri<void>('set_video_playlist', { videoId, playlistId: playlistId || null });
    if (res !== null) await refreshData();
    else updateLocalVideos(videos.map((v) => (v.id === videoId ? { ...v, playlist_id: playlistId } : v)));
    if (selectedVideoModal?.id === videoId) setSelectedVideoModal({ ...selectedVideoModal!, playlist_id: playlistId });
  };

  const handleUpdateVideoCover = async (id: string, coverUrl: string) => {
    await callTauri<void>('update_video_cover', { id, coverUrl });
    setVideos((prev) => prev.map((v) => v.id === id ? { ...v, cover_url: coverUrl || null } : v));
  };

  const handlePlayWebview = async (video: Video) => {
    const res = await callTauri<void>('open_video_player', { url: video.page_url, title: video.title, providerId: null });
    if (res === null) window.open(video.page_url, '_blank', 'noopener,noreferrer');
  };

  const handlePlayContent = async (url: string, title: string, providerId: string) => {
    setSelectedContentId(null);
    const res = await callTauri<void>('open_video_player', { url, title, providerId });
    if (res === null) window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Direct play from catalog card — fetches first source and plays without opening the modal
  const handlePlayContentDirect = useCallback(async (contentId: string) => {
    const detail = await callTauri<ContentDetail>('get_content_detail', { contentId });
    if (!detail || detail.sources.length === 0) {
      // No sources found — fall back to the detail modal so user can see why
      setSelectedContentId(contentId);
      return;
    }
    // For TV shows with seasons, open modal so user can pick a season
    if (detail.content.media_type === 'tv_show' && detail.sources.length > 1) {
      setSelectedContentId(contentId);
      return;
    }
    const src = detail.sources[0];
    const res = await callTauri<void>('open_video_player', {
      url: src.page_url,
      title: detail.content.title,
      providerId: src.provider_id,
    });
    if (res === null) window.open(src.page_url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleSeedData = () => {
    updateLocalVideos(DEMO_VIDEOS);
    updateLocalPlaylists(DEMO_PLAYLISTS);
  };

  const filteredVideos = useMemo(() => {
    if (!searchQuery.trim()) return videos;
    const q = searchQuery.toLowerCase();
    return videos.filter(
      (v) => v.title.toLowerCase().includes(q) || v.page_url.toLowerCase().includes(q) ||
        parseTags(v.tags).some((t) => t.toLowerCase().includes(q))
    );
  }, [videos, searchQuery]);

  // 10 most recently released movies for the hero banner (sorted by release_date DESC in DB)
  const heroItems = useMemo(() => heroContent.slice(0, 10), [heroContent]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    videos.forEach((v) => parseTags(v.tags).forEach((t) => set.add(t)));
    return Array.from(set);
  }, [videos]);

  const movieChunks = useMemo(() => chunkArray(movies, 24), [movies]);
  const tvChunks = useMemo(() => chunkArray(tvShows, 24), [tvShows]);
  const catalogSearchChunks = useMemo(() => chunkArray(catalogSearchResults, 24), [catalogSearchResults]);

  const isCatalogTab = activeTab === 'movies' || activeTab === 'tv' || activeTab === 'providers';
  const hasMoreMovies = movieOffset > 0 && movieOffset % PAGE_SIZE === 0;
  const hasMoreTv = tvOffset > 0 && tvOffset % PAGE_SIZE === 0;

  const LoadMoreButton = ({ onClick }: { onClick: () => void }) => (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem 0 2rem' }}>
      <button
        className="btn-netflix-secondary"
        onClick={onClick}
        disabled={loadingMore}
        style={{ gap: '0.5rem', padding: '0.75rem 2rem' }}
      >
        <ChevronDown size={18} />
        <span>{loadingMore ? 'Loading...' : 'Load More'}</span>
      </button>
    </div>
  );

  const renderCatalogTab = () => {
    if (activeTab === 'movies') {
      if (movieChunks.length === 0) {
        return (
          <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-gray)' }}>
            <Film size={48} color="var(--netflix-red)" style={{ margin: '0 auto 1rem' }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>No Movies Yet</h2>
            <p>Run the import script to populate the catalog.</p>
          </div>
        );
      }
      return (
        <>
          {movieChunks.map((chunk, i) => (
            <ContentRow
              key={i}
              title={i === 0 ? `Movies · ${movies.length.toLocaleString()} loaded` : `Movies · Page ${i + 1}`}
              items={chunk}
              onOpenDetail={setSelectedContentId}
              onPlay={handlePlayContentDirect}
              providerLabel="FMovies"
            />
          ))}
          {hasMoreMovies && <LoadMoreButton onClick={loadMoreMovies} />}
          {GENRE_ROWS.map((genre) =>
            movieGenreRows[genre]?.length ? (
              <ContentRow
                key={`movie-genre-${genre}`}
                title={genre}
                items={movieGenreRows[genre]}
                onOpenDetail={setSelectedContentId}
                onPlay={handlePlayContentDirect}
                providerLabel="FMovies"
              />
            ) : null
          )}
        </>
      );
    }

    if (activeTab === 'tv') {
      if (tvChunks.length === 0) {
        return (
          <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-gray)' }}>
            <Film size={48} color="var(--netflix-red)" style={{ margin: '0 auto 1rem' }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>No TV Shows Yet</h2>
            <p>Run the import script to populate the catalog.</p>
          </div>
        );
      }
      return (
        <>
          {tvChunks.map((chunk, i) => (
            <ContentRow
              key={i}
              title={i === 0 ? `TV Shows · ${tvShows.length.toLocaleString()} loaded` : `TV Shows · Page ${i + 1}`}
              items={chunk}
              onOpenDetail={setSelectedContentId}
              onPlay={handlePlayContentDirect}
              providerLabel="FMovies"
            />
          ))}
          {hasMoreTv && <LoadMoreButton onClick={loadMoreTv} />}
          {GENRE_ROWS.map((genre) =>
            tvGenreRows[genre]?.length ? (
              <ContentRow
                key={`tv-genre-${genre}`}
                title={genre}
                items={tvGenreRows[genre]}
                onOpenDetail={setSelectedContentId}
                onPlay={handlePlayContentDirect}
                providerLabel="FMovies"
              />
            ) : null
          )}
        </>
      );
    }

    if (activeTab === 'providers') return <ProviderList />;
    return null;
  };

  return (
    <div className="flud-netflix-app">
      <Navbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenAddVideo={() => setIsAddVideoOpen(true)}
        onOpenAddPlaylist={() => setIsAddPlaylistOpen(true)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {!searchQuery && heroItems.length > 0 && !isCatalogTab && (
        <HeroBanner items={heroItems} onPlay={handlePlayContentDirect} onOpenDetail={setSelectedContentId} />
      )}

      <div className="rows-wrapper" style={{ marginTop: searchQuery ? '90px' : undefined }}>
        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-gray)' }}>
            Loading...
          </div>
        ) : isCatalogTab ? (
          renderCatalogTab()
        ) : searchQuery ? (
          <>
            {/* Catalog search results from 36k titles */}
            {catalogSearching ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-gray)' }}>
                Searching catalog...
              </div>
            ) : catalogSearchResults.length > 0 ? (
              <>
                {catalogSearchChunks.map((chunk, i) => (
                  <ContentRow
                    key={`catalog-${i}`}
                    title={i === 0 ? `Catalog Results (${catalogSearchResults.length})` : `Catalog Results · Page ${i + 1}`}
                    items={chunk}
                    onOpenDetail={setSelectedContentId}
                    onPlay={handlePlayContentDirect}
                    providerLabel="FMovies"
                  />
                ))}
              </>
            ) : null}

            {/* Manual bookmark search results */}
            {filteredVideos.length > 0 && (
              <>
                <MovieRow
                  title={`Bookmarks: "${searchQuery}"`}
                  videos={filteredVideos}
                  onPlay={handlePlayWebview}
                  onOpenDetails={(v) => setSelectedVideoModal(v)}
                  onDeleteVideo={handleDeleteVideo}
                />
                {playlists.map((pl) => {
                  const plVideos = filteredVideos.filter((v) => v.playlist_id === pl.id);
                  if (plVideos.length === 0) return null;
                  return (
                    <MovieRow key={pl.id} title={`Shelf: ${pl.name}`} videos={plVideos}
                      onPlay={handlePlayWebview} onOpenDetails={(v) => setSelectedVideoModal(v)} onDeleteVideo={handleDeleteVideo} />
                  );
                })}
              </>
            )}

            {catalogSearchResults.length === 0 && filteredVideos.length === 0 && !catalogSearching && (
              <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-gray)' }}>
                <Film size={48} color="var(--netflix-red)" style={{ margin: '0 auto 1rem' }} />
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>No results for "{searchQuery}"</h2>
              </div>
            )}
          </>
        ) : filteredVideos.length === 0 ? (
          <>
            {activeTab === 'home' && (movieChunks.length > 0 || tvChunks.length > 0) ? (
              <>
                {movieChunks.length > 0 && (
                  <ContentRow
                    title={`Movies · ${movies.length.toLocaleString()} loaded`}
                    items={movieChunks[0]}
                    onOpenDetail={setSelectedContentId}
                    onPlay={handlePlayContentDirect}
                    providerLabel="FMovies"
                  />
                )}
                {tvChunks.length > 0 && (
                  <ContentRow
                    title={`TV Shows · ${tvShows.length.toLocaleString()} loaded`}
                    items={tvChunks[0]}
                    onOpenDetail={setSelectedContentId}
                    onPlay={handlePlayContentDirect}
                    providerLabel="FMovies"
                  />
                )}
                {GENRE_ROWS.map((genre) =>
                  genreRows[genre]?.length ? (
                    <ContentRow
                      key={genre}
                      title={genre}
                      items={genreRows[genre]}
                      onOpenDetail={setSelectedContentId}
                      onPlay={handlePlayContentDirect}
                      providerLabel="FMovies"
                    />
                  ) : null
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '5rem 2rem' }}>
                <Film size={48} color="var(--netflix-red)" style={{ margin: '0 auto 1rem' }} />
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>No Bookmarks Found</h2>
                <p style={{ color: 'var(--text-gray)', marginBottom: '1.5rem' }}>
                  Add your first video link to populate your Netflix shell.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                  <button className="btn-netflix-primary" onClick={() => setIsAddVideoOpen(true)}>
                    <Plus size={18} /><span>Add Video</span>
                  </button>
                  <button className="btn-netflix-secondary" onClick={handleSeedData}>
                    <Sparkles size={18} /><span>Load Demo Data</span>
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {activeTab === 'home' ? (
              <>
                <MovieRow title="Trending & Recently Added" videos={filteredVideos}
                  onPlay={handlePlayWebview} onOpenDetails={(v) => setSelectedVideoModal(v)} onDeleteVideo={handleDeleteVideo} />
                {playlists.map((pl) => {
                  const plVideos = videos.filter((v) => v.playlist_id === pl.id);
                  return <MovieRow key={pl.id} title={`Shelf: ${pl.name}`} videos={plVideos}
                    onPlay={handlePlayWebview} onOpenDetails={(v) => setSelectedVideoModal(v)} onDeleteVideo={handleDeleteVideo} />;
                })}
                {allTags.map((tag) => {
                  const tagVideos = filteredVideos.filter((v) => parseTags(v.tags).includes(tag));
                  if (tagVideos.length === 0) return null;
                  return <MovieRow key={tag} title={`Topic: #${tag}`} videos={tagVideos}
                    onPlay={handlePlayWebview} onOpenDetails={(v) => setSelectedVideoModal(v)} onDeleteVideo={handleDeleteVideo} />;
                })}
                {movieChunks.length > 0 && (
                  <ContentRow title={`Catalog: Movies (${movies.length.toLocaleString()})`} items={movieChunks[0]} onOpenDetail={setSelectedContentId} onPlay={handlePlayContentDirect} providerLabel="FMovies" />
                )}
                {tvChunks.length > 0 && (
                  <ContentRow title={`Catalog: TV Shows (${tvShows.length.toLocaleString()})`} items={tvChunks[0]} onOpenDetail={setSelectedContentId} onPlay={handlePlayContentDirect} providerLabel="FMovies" />
                )}
                {GENRE_ROWS.map((genre) =>
                  genreRows[genre]?.length ? (
                    <ContentRow
                      key={genre}
                      title={genre}
                      items={genreRows[genre]}
                      onOpenDetail={setSelectedContentId}
                      onPlay={handlePlayContentDirect}
                      providerLabel="FMovies"
                    />
                  ) : null
                )}
              </>
            ) : activeTab === 'playlists' ? (
              <>
                {playlists.map((pl) => {
                  const plVideos = videos.filter((v) => v.playlist_id === pl.id);
                  return <MovieRow key={pl.id} title={`Shelf: ${pl.name}`} videos={plVideos}
                    onPlay={handlePlayWebview} onOpenDetails={(v) => setSelectedVideoModal(v)} onDeleteVideo={handleDeleteVideo} />;
                })}
              </>
            ) : activeTab === 'tags' ? (
              <>
                {allTags.map((tag) => {
                  const tagVideos = videos.filter((v) => parseTags(v.tags).includes(tag));
                  if (tagVideos.length === 0) return null;
                  return <MovieRow key={tag} title={`Topic: #${tag}`} videos={tagVideos}
                    onPlay={handlePlayWebview} onOpenDetails={(v) => setSelectedVideoModal(v)} onDeleteVideo={handleDeleteVideo} />;
                })}
              </>
            ) : null}
          </>
        )}
      </div>

      <MovieModal video={selectedVideoModal} playlists={playlists} onClose={() => setSelectedVideoModal(null)}
        onPlay={handlePlayWebview} onDelete={handleDeleteVideo} onSetPlaylist={handleSetVideoPlaylist} onUpdateCover={handleUpdateVideoCover} />
      <ContentLandingModal contentId={selectedContentId} onClose={() => setSelectedContentId(null)} onPlay={handlePlayContent} />
      <AddVideoModal isOpen={isAddVideoOpen} onClose={() => setIsAddVideoOpen(false)} onAddVideo={handleAddVideo} />
      <AddPlaylistModal isOpen={isAddPlaylistOpen} onClose={() => setIsAddPlaylistOpen(false)} onAddPlaylist={handleAddPlaylist} />
    </div>
  );
}
