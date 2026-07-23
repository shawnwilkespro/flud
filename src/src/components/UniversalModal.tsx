import React, { useEffect, useState } from 'react';
import { X, Play, ExternalLink, Trash2, Pencil, Star, Tv, Film, ChevronDown, ListPlus } from 'lucide-react';
import type { Content } from './ContentRow';
import type { Video, Playlist } from '../App';

interface ContentSource {
  provider_id: string;
  provider_name: string;
  page_url: string;
  season_number?: number | null;
}

export type ModalItem =
  | { kind: 'content'; data: Content; sources: ContentSource[] }
  | { kind: 'video'; data: Video }

interface UniversalModalProps {
  item: ModalItem | null;
  playlists: Playlist[];
  onClose: () => void;
  onContentUpdated?: (contentId: string) => Promise<void>;
  onVideoUpdated?: (videoId: string) => Promise<void>;
  onDeleteVideo: (id: string) => void;
}

async function callTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<T>(command, args);
    }
  } catch (err) {
    console.warn(`[Tauri] ${command}:`, err);
  }
  return null;
}

export const UniversalModal: React.FC<UniversalModalProps> = ({
  item,
  playlists,
  onClose,
  onContentUpdated,
  onVideoUpdated,
  onDeleteVideo,
}) => {
  const [editingCover, setEditingCover] = useState(false);
  const [coverInput, setCoverInput] = useState('');
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null | undefined>(undefined);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false);
  const [playlistDropdownOpen, setPlaylistDropdownOpen] = useState(false);

  useEffect(() => {
    if (!item) return;
    setEditingCover(false);
    setCoverInput('');
    setLocalCoverUrl(undefined);
    setSeasonDropdownOpen(false);
    setPlaylistDropdownOpen(false);

    if (item.kind === 'video') {
      setPlaylistId(item.data.playlist_id ?? null);
    } else {
      callTauri<string | null>('get_content_playlist', { contentId: item.data.id }).then((pid) => {
        setPlaylistId(pid ?? null);
      });
    }
  }, [item]);

  if (!item) return null;

  const isContent = item.kind === 'content';
  const isVideo = item.kind === 'video';
  const isTV = isContent && item.data.media_type === 'tv_show';

  const rawCoverUrl = isContent
    ? (item.data.cover_url_override ?? item.data.poster_url ?? null)
    : (item.data.cover_url ?? null);
  const effectiveCoverUrl = localCoverUrl !== undefined ? localCoverUrl : rawCoverUrl;

  // Deduplicate movie providers by provider_id, keeping first URL per provider
  const uniqueProviders = isContent && !isTV
    ? (() => {
        const seen = new Set<string>();
        return item.sources.filter((src) => {
          if (seen.has(src.provider_id)) return false;
          seen.add(src.provider_id);
          return true;
        });
      })()
    : [];

  const genres: string[] = isContent
    ? (() => { try { return JSON.parse(item.data.genres ?? '[]') as string[]; } catch { return []; } })()
    : [];

  const handleSaveCover = async () => {
    const val = coverInput.trim() || null;
    if (isContent) {
      await callTauri<void>('update_content_cover', { id: item.data.id, coverUrlOverride: val });
      setLocalCoverUrl(val);
      setEditingCover(false);
      if (onContentUpdated) await onContentUpdated(item.data.id);
    } else {
      await callTauri<void>('update_video_cover', { id: item.data.id, coverUrl: val ?? '' });
      setLocalCoverUrl(val);
      setEditingCover(false);
      if (onVideoUpdated) await onVideoUpdated(item.data.id);
    }
  };

  const handleSetPlaylist = async (pid: string | null) => {
    setPlaylistId(pid);
    setPlaylistDropdownOpen(false);
    if (isContent) {
      await callTauri<void>('set_content_playlist', { contentId: item.data.id, playlistId: pid });
      if (onContentUpdated) await onContentUpdated(item.data.id);
    } else {
      await callTauri<void>('set_video_playlist', { videoId: item.data.id, playlistId: pid });
      if (onVideoUpdated) await onVideoUpdated(item.data.id);
    }
  };

  const handlePlayUrl = async (url: string, label: string, providerId: string | null, isFMovies: boolean) => {
    if (isFMovies) {
      await callTauri<void>('open_in_browser', { url });
    } else {
      const res = await callTauri<void>('open_video_player', { url, title: label, providerId });
      if (res === null) window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleExternalLink = async () => {
    const url = isContent ? (item.sources[0]?.page_url ?? '') : item.data.page_url;
    if (!url) return;
    await callTauri<void>('open_in_browser', { url });
  };

  const currentPlaylistName = playlists.find((pl) => pl.id === playlistId)?.name ?? null;

  return (
    <div
      className="netflix-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="um-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        {/* Hero — blurred backdrop */}
        <div className="um-hero">
          {effectiveCoverUrl ? (
            <div
              className="um-hero-bg"
              style={{ backgroundImage: `url(${effectiveCoverUrl})` }}
            />
          ) : (
            <div className="um-hero-bg um-hero-bg--gradient" />
          )}
          <div className="um-hero-fade" />
        </div>

        {/* Info row: poster + meta */}
        <div className="um-info-row">
          {/* Poster area */}
          <div className="um-poster-wrapper">
            {editingCover ? (
              <div className="um-cover-editor">
                <p className="um-cover-editor-label">Cover image URL:</p>
                <input
                  className="modal-select"
                  type="text"
                  value={coverInput}
                  onChange={(e) => setCoverInput(e.target.value)}
                  placeholder="https://..."
                  autoFocus
                />
                <div className="um-cover-editor-actions">
                  <button
                    className="btn-netflix-primary um-cover-editor-btn"
                    onClick={handleSaveCover}
                  >
                    Save
                  </button>
                  <button
                    className="btn-netflix-secondary um-cover-editor-btn"
                    onClick={() => setEditingCover(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="um-poster"
                onClick={() => { setCoverInput(effectiveCoverUrl ?? ''); setEditingCover(true); }}
                title="Click to change cover image"
              >
                {effectiveCoverUrl ? (
                  <img src={effectiveCoverUrl} alt={item.data.title} />
                ) : (
                  <div className="um-poster-fallback">
                    {isTV ? <Tv size={36} /> : <Film size={36} />}
                  </div>
                )}
                <div className="um-poster-overlay">
                  <Pencil size={22} />
                </div>
              </div>
            )}
          </div>

          {/* Title + meta + actions */}
          <div className="um-meta">
            <h2 className="um-title">{item.data.title}</h2>

            <div className="um-meta-row">
              {isContent && item.data.year && <span>{item.data.year}</span>}
              {isContent && item.data.rating && (
                <span className="rating-pill">
                  <Star size={12} fill="currentColor" />
                  {item.data.rating.toFixed(1)}
                </span>
              )}
              {genres.slice(0, 3).map((g) => (
                <span key={g} className="genre-pill">{g}</span>
              ))}
            </div>

            {/* Action bar */}
            <div className="um-actions">
              {/* Catalog movie: one button per unique provider */}
              {isContent && !isTV && uniqueProviders.map((src) => {
                const isFMovies = src.provider_name.toLowerCase().includes('fmovies');
                return (
                  <button
                    key={src.provider_id}
                    className="btn-modal-play"
                    onClick={() => handlePlayUrl(src.page_url, item.data.title, src.provider_id, isFMovies)}
                  >
                    <Play size={15} fill="currentColor" />
                    <span>{isFMovies ? 'Watch · FMovies' : `Watch · ${src.provider_name}`}</span>
                  </button>
                );
              })}

              {/* Catalog TV: choose season dropdown */}
              {isContent && isTV && (
                <div className="um-dropdown-wrapper">
                  <button
                    className="btn-modal-play"
                    onClick={() => setSeasonDropdownOpen((o) => !o)}
                  >
                    <Play size={15} fill="currentColor" />
                    <span>Choose Season</span>
                    <ChevronDown size={13} />
                  </button>
                  {seasonDropdownOpen && (
                    <div className="um-dropdown-menu">
                      {item.sources.length === 0 ? (
                        <div className="um-dropdown-empty">No seasons available</div>
                      ) : (
                        item.sources.map((src) => {
                          const isFMovies = src.provider_name.toLowerCase().includes('fmovies');
                          const label = src.season_number != null
                            ? `${item.data.title} S${src.season_number}`
                            : item.data.title;
                          return (
                            <button
                              key={`${src.provider_id}-${src.season_number}`}
                              className="um-dropdown-item"
                              onClick={() => {
                                setSeasonDropdownOpen(false);
                                handlePlayUrl(src.page_url, label, src.provider_id, isFMovies);
                              }}
                            >
                              <span>{src.season_number != null ? `Season ${src.season_number}` : 'Full Series'}</span>
                              <span className="um-dropdown-sub">{src.provider_name}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Video bookmark: play in webview */}
              {isVideo && (
                <button
                  className="btn-modal-play"
                  onClick={() => handlePlayUrl(item.data.page_url, item.data.title, null, false)}
                >
                  <Play size={15} fill="currentColor" />
                  <span>Play Webview</span>
                </button>
              )}

              {/* External link — always opens in system browser */}
              <button
                className="btn-modal-external"
                title="Open in system browser"
                onClick={handleExternalLink}
              >
                <ExternalLink size={17} />
              </button>

              {/* Playlist picker */}
              <div className="um-dropdown-wrapper">
                <button
                  className="btn-modal-external um-playlist-btn"
                  title={currentPlaylistName ? `Playlist: ${currentPlaylistName}` : 'Add to playlist'}
                  onClick={() => setPlaylistDropdownOpen((o) => !o)}
                >
                  <ListPlus size={17} />
                  {currentPlaylistName && (
                    <span className="um-playlist-label">{currentPlaylistName}</span>
                  )}
                </button>
                {playlistDropdownOpen && (
                  <div className="um-dropdown-menu um-dropdown-menu--right">
                    <button
                      className={`um-dropdown-item ${!playlistId ? 'um-dropdown-item--active' : ''}`}
                      onClick={() => handleSetPlaylist(null)}
                    >
                      No Playlist
                    </button>
                    {playlists.map((pl) => (
                      <button
                        key={pl.id}
                        className={`um-dropdown-item ${playlistId === pl.id ? 'um-dropdown-item--active' : ''}`}
                        onClick={() => handleSetPlaylist(pl.id)}
                      >
                        {pl.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="um-body">
          {isContent && item.data.synopsis && (
            <p className="um-synopsis">{item.data.synopsis}</p>
          )}
          {isVideo && (
            <>
              <p className="um-url">
                <a href={item.data.page_url} target="_blank" rel="noreferrer" className="modal-link">
                  {item.data.page_url}
                </a>
              </p>
              {(() => {
                try {
                  const tags = JSON.parse(item.data.tags ?? '[]') as string[];
                  if (tags.length === 0) return null;
                  return (
                    <div className="modal-tags-container um-tags-section">
                      <span className="modal-section-label">Tags:</span>
                      <div className="modal-tags-list">
                        {tags.map((t) => <span key={t} className="modal-tag-chip">#{t}</span>)}
                      </div>
                    </div>
                  );
                } catch { return null; }
              })()}
            </>
          )}
        </div>

        {/* Footer — delete action for bookmarks only */}
        {isVideo && (
          <div className="um-footer">
            <button
              className="btn-modal-delete"
              onClick={() => { onDeleteVideo(item.data.id); onClose(); }}
            >
              <Trash2 size={15} />
              <span>Delete Bookmark</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
