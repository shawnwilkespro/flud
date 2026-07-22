import { useState, useEffect, useMemo } from 'react';
import { Navbar } from './components/Navbar';
import { HeroBanner } from './components/HeroBanner';
import { MovieRow } from './components/MovieRow';
import { MovieModal } from './components/MovieModal';
import { AddVideoModal } from './components/AddVideoModal';
import { AddPlaylistModal } from './components/AddPlaylistModal';
import { Sparkles, Film, Plus } from 'lucide-react';
import { parseTags } from './utils';
import { ContentRow } from './components/ContentRow';
import type { Content } from './components/ContentRow';
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

  // Modals state
  const [isAddVideoOpen, setIsAddVideoOpen] = useState(false);
  const [isAddPlaylistOpen, setIsAddPlaylistOpen] = useState(false);
  const [selectedVideoModal, setSelectedVideoModal] = useState<Video | null>(null);
  const [catalog, setCatalog] = useState<Content[]>([]);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  // Refresh data from Tauri SQLite database or LocalStorage fallback
  const refreshData = async () => {
    setLoading(true);
    const vList = await callTauri<Video[]>('list_videos');
    const pList = await callTauri<Playlist[]>('list_playlists');

    if (vList !== null && vList.length > 0) {
      setVideos(vList);
    } else {
      const savedV = localStorage.getItem('flud_netflix_videos');
      setVideos(savedV ? JSON.parse(savedV) : DEMO_VIDEOS);
    }

    if (pList !== null && pList.length > 0) {
      setPlaylists(pList);
    } else {
      const savedP = localStorage.getItem('flud_netflix_playlists');
      setPlaylists(savedP ? JSON.parse(savedP) : DEMO_PLAYLISTS);
    }

    const cList = await callTauri<Content[]>('list_content', {
      search: searchQuery.trim() || null,
    });
    if (cList !== null) setCatalog(cList);

    setLoading(false);
  };

  useEffect(() => {
    refreshData();
  }, []);

  const updateLocalVideos = (newV: Video[]) => {
    setVideos(newV);
    localStorage.setItem('flud_netflix_videos', JSON.stringify(newV));
  };

  const updateLocalPlaylists = (newP: Playlist[]) => {
    setPlaylists(newP);
    localStorage.setItem('flud_netflix_playlists', JSON.stringify(newP));
  };

  // Actions
  const handleAddVideo = async (title: string, pageUrl: string, coverUrl: string, tagsInput: string) => {
    const tagsArray = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const res = await callTauri<void>('add_video', {
      title,
      pageUrl,
      coverUrl: coverUrl.trim() ? coverUrl.trim() : null,
      tags: tagsArray
    });

    if (res !== null) {
      await refreshData();
    } else {
      const newVItem: Video = {
        id: `v-${Date.now()}`,
        title,
        page_url: pageUrl,
        cover_url: coverUrl.trim() || null,
        tags: JSON.stringify(tagsArray),
        playlist_id: null,
        added_at: new Date().toISOString()
      };
      updateLocalVideos([newVItem, ...videos]);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    const res = await callTauri<void>('delete_video', { id });
    if (res !== null) {
      await refreshData();
    } else {
      updateLocalVideos(videos.filter((v) => v.id !== id));
    }
    if (selectedVideoModal?.id === id) setSelectedVideoModal(null);
  };

  const handleAddPlaylist = async (name: string) => {
    const res = await callTauri<string>('create_playlist', { name });
    if (res !== null) {
      await refreshData();
    } else {
      const newP: Playlist = {
        id: `pl-${Date.now()}`,
        name
      };
      updateLocalPlaylists([...playlists, newP]);
    }
  };

  const handleSetVideoPlaylist = async (videoId: string, playlistId: string | null) => {
    const res = await callTauri<void>('set_video_playlist', {
      videoId,
      playlistId: playlistId || null
    });

    if (res !== null) {
      await refreshData();
    } else {
      updateLocalVideos(
        videos.map((v) => (v.id === videoId ? { ...v, playlist_id: playlistId } : v))
      );
    }

    if (selectedVideoModal && selectedVideoModal.id === videoId) {
      setSelectedVideoModal({ ...selectedVideoModal, playlist_id: playlistId });
    }
  };

  const handlePlayWebview = async (video: Video) => {
    const res = await callTauri<void>('open_video_player', {
      url: video.page_url,
      title: video.title,
      providerId: null, // manual bookmarks have no provider
    });
    if (res === null) {
      window.open(video.page_url, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePlayContent = async (url: string, title: string, providerId: string) => {
    setSelectedContentId(null);
    const res = await callTauri<void>('open_video_player', {
      url,
      title,
      providerId,
    });
    if (res === null) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSeedData = () => {
    updateLocalVideos(DEMO_VIDEOS);
    updateLocalPlaylists(DEMO_PLAYLISTS);
  };

  // Search filtered videos
  const filteredVideos = useMemo(() => {
    if (!searchQuery.trim()) return videos;
    const q = searchQuery.toLowerCase();
    return videos.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.page_url.toLowerCase().includes(q) ||
        parseTags(v.tags).some((t) => t.toLowerCase().includes(q))
    );
  }, [videos, searchQuery]);

  // Featured video for Hero Banner
  const heroVideo = useMemo(() => {
    if (filteredVideos.length === 0) return null;
    return filteredVideos[0];
  }, [filteredVideos]);

  // Tags list
  const allTags = useMemo(() => {
    const set = new Set<string>();
    videos.forEach((v) => parseTags(v.tags).forEach((t) => set.add(t)));
    return Array.from(set);
  }, [videos]);

  return (
    <div className="flud-netflix-app">
      {/* Navbar */}
      <Navbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenAddVideo={() => setIsAddVideoOpen(true)}
        onOpenAddPlaylist={() => setIsAddPlaylistOpen(true)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Hero Banner */}
      {!searchQuery && heroVideo && (
        <HeroBanner
          video={heroVideo}
          onPlay={handlePlayWebview}
          onOpenDetails={(v) => setSelectedVideoModal(v)}
        />
      )}

      {/* Rows Wrapper */}
      <div className="rows-wrapper" style={{ marginTop: searchQuery ? '90px' : undefined }}>
        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-gray)' }}>
            Loading Netflix Video Shell...
          </div>
        ) : filteredVideos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 2rem' }}>
            <Film size={48} color="var(--netflix-red)" style={{ margin: '0 auto 1rem' }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
              No Bookmarks Found
            </h2>
            <p style={{ color: 'var(--text-gray)', marginBottom: '1.5rem' }}>
              {searchQuery ? 'No bookmarks matched your search.' : 'Add your first video link to populate your Netflix shell.'}
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <button className="btn-netflix-primary" onClick={() => setIsAddVideoOpen(true)}>
                <Plus size={18} />
                <span>Add Video</span>
              </button>
              <button className="btn-netflix-secondary" onClick={handleSeedData}>
                <Sparkles size={18} />
                <span>Load Demo Data</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Search Results — override tab filtering when query is active */}
            {searchQuery ? (
              <>
                <MovieRow
                  title={`Search Results for "${searchQuery}"`}
                  videos={filteredVideos}
                  onPlay={handlePlayWebview}
                  onOpenDetails={(v) => setSelectedVideoModal(v)}
                  onDeleteVideo={handleDeleteVideo}
                />

                {playlists.map((pl) => {
                  const plVideos = filteredVideos.filter((v) => v.playlist_id === pl.id);
                  if (plVideos.length === 0) return null;
                  return (
                    <MovieRow
                      key={pl.id}
                      title={`Shelf: ${pl.name}`}
                      videos={plVideos}
                      onPlay={handlePlayWebview}
                      onOpenDetails={(v) => setSelectedVideoModal(v)}
                      onDeleteVideo={handleDeleteVideo}
                    />
                  );
                })}

                {allTags.map((tag) => {
                  const tagVideos = filteredVideos.filter((v) => parseTags(v.tags).includes(tag));
                  if (tagVideos.length === 0) return null;
                  return (
                    <MovieRow
                      key={tag}
                      title={`Topic: #${tag}`}
                      videos={tagVideos}
                      onPlay={handlePlayWebview}
                      onOpenDetails={(v) => setSelectedVideoModal(v)}
                      onDeleteVideo={handleDeleteVideo}
                    />
                  );
                })}
              </>
            ) : activeTab === 'home' ? (
              <>
                {/* Trending Row */}
                <MovieRow
                  title="Trending & Recently Added"
                  videos={filteredVideos}
                  onPlay={handlePlayWebview}
                  onOpenDetails={(v) => setSelectedVideoModal(v)}
                  onDeleteVideo={handleDeleteVideo}
                />

                {/* Playlist Shelves */}
                {playlists.map((pl) => {
                  const plVideos = videos.filter((v) => v.playlist_id === pl.id);
                  return (
                    <MovieRow
                      key={pl.id}
                      title={`Shelf: ${pl.name}`}
                      videos={plVideos}
                      onPlay={handlePlayWebview}
                      onOpenDetails={(v) => setSelectedVideoModal(v)}
                      onDeleteVideo={handleDeleteVideo}
                    />
                  );
                })}

                {/* Tag Shelves */}
                {allTags.map((tag) => {
                  const tagVideos = filteredVideos.filter((v) => parseTags(v.tags).includes(tag));
                  if (tagVideos.length === 0) return null;
                  return (
                    <MovieRow
                      key={tag}
                      title={`Topic: #${tag}`}
                      videos={tagVideos}
                      onPlay={handlePlayWebview}
                      onOpenDetails={(v) => setSelectedVideoModal(v)}
                      onDeleteVideo={handleDeleteVideo}
                    />
                  );
                })}

                {/* Catalog: Movies from all providers */}
                {catalog.filter((c) => c.media_type === 'movie').length > 0 && (
                  <ContentRow
                    title="Catalog: Movies"
                    items={catalog.filter((c) => c.media_type === 'movie')}
                    onOpenDetail={setSelectedContentId}
                  />
                )}

                {/* Catalog: TV Shows from all providers */}
                {catalog.filter((c) => c.media_type === 'tv_show').length > 0 && (
                  <ContentRow
                    title="Catalog: TV Shows"
                    items={catalog.filter((c) => c.media_type === 'tv_show')}
                    onOpenDetail={setSelectedContentId}
                  />
                )}
              </>
            ) : activeTab === 'playlists' ? (
              <>
                {/* Playlist Shelves only */}
                {playlists.map((pl) => {
                  const plVideos = videos.filter((v) => v.playlist_id === pl.id);
                  return (
                    <MovieRow
                      key={pl.id}
                      title={`Shelf: ${pl.name}`}
                      videos={plVideos}
                      onPlay={handlePlayWebview}
                      onOpenDetails={(v) => setSelectedVideoModal(v)}
                      onDeleteVideo={handleDeleteVideo}
                    />
                  );
                })}
              </>
            ) : activeTab === 'tags' ? (
              <>
                {/* Tag Shelves only */}
                {allTags.map((tag) => {
                  const tagVideos = videos.filter((v) => parseTags(v.tags).includes(tag));
                  if (tagVideos.length === 0) return null;
                  return (
                    <MovieRow
                      key={tag}
                      title={`Topic: #${tag}`}
                      videos={tagVideos}
                      onPlay={handlePlayWebview}
                      onOpenDetails={(v) => setSelectedVideoModal(v)}
                      onDeleteVideo={handleDeleteVideo}
                    />
                  );
                })}
              </>
            ) : activeTab === 'providers' ? (
              <ProviderList />
            ) : null}
          </>
        )}
      </div>

      {/* Movie Modal */}
      <MovieModal
        video={selectedVideoModal}
        playlists={playlists}
        onClose={() => setSelectedVideoModal(null)}
        onPlay={handlePlayWebview}
        onDelete={handleDeleteVideo}
        onSetPlaylist={handleSetVideoPlaylist}
      />

      {/* Content Landing Modal — catalog titles */}
      <ContentLandingModal
        contentId={selectedContentId}
        onClose={() => setSelectedContentId(null)}
        onPlay={handlePlayContent}
      />

      {/* Add Video Modal */}
      <AddVideoModal
        isOpen={isAddVideoOpen}
        onClose={() => setIsAddVideoOpen(false)}
        onAddVideo={handleAddVideo}
      />

      {/* Add Playlist Modal */}
      <AddPlaylistModal
        isOpen={isAddPlaylistOpen}
        onClose={() => setIsAddPlaylistOpen(false)}
        onAddPlaylist={handleAddPlaylist}
      />
    </div>
  );
}
