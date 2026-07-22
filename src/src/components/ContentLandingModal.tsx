import React, { useEffect, useState } from 'react';
import { X, Play, Star, Tv, Film, Pencil } from 'lucide-react';

interface Content {
  id: string;
  tmdb_id?: number | null;
  title: string;
  media_type: string;
  synopsis?: string | null;
  poster_url?: string | null;
  cover_url_override?: string | null;
  year?: number | null;
  genres?: string | null;
  rating?: number | null;
  release_date?: string | null;
}

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

interface ContentLandingModalProps {
  contentId: string | null;
  onClose: () => void;
  onPlay: (url: string, title: string, providerId: string) => void;
  onContentUpdated?: (contentId: string) => Promise<void>;
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

export const ContentLandingModal: React.FC<ContentLandingModalProps> = ({
  contentId,
  onClose,
  onPlay,
  onContentUpdated,
}) => {
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingPoster, setEditingPoster] = useState(false);
  const [posterInput, setPosterInput] = useState('');
  const [localPosterOverride, setLocalPosterOverride] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!contentId) {
      setDetail(null);
      setLocalPosterOverride(undefined);
      return;
    }
    setLoading(true);
    setLocalPosterOverride(undefined);
    setEditingPoster(false);
    callTauri<ContentDetail | null>('get_content_detail', { contentId }).then((d) => {
      setDetail(d ?? null);
      setLoading(false);
    });
  }, [contentId]);

  if (!contentId) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const content = detail?.content;
  const sources = detail?.sources ?? [];
  const isTV = content?.media_type === 'tv_show';
  const genres = content?.genres ? (JSON.parse(content.genres) as string[]) : [];

  const effectivePoster = localPosterOverride !== undefined
    ? localPosterOverride
    : (content?.cover_url_override ?? content?.poster_url ?? null);

  const handleSavePoster = async () => {
    if (!content) return;
    const val = posterInput.trim() || null;
    await callTauri<void>('update_content_cover', { id: content.id, coverUrlOverride: val });
    setLocalPosterOverride(val);
    setEditingPoster(false);
    if (onContentUpdated) {
      await onContentUpdated(content.id);
    }
  };

  return (
    <div
      className="netflix-modal-backdrop"
      onClick={handleBackdropClick}
    >
      <div className="netflix-modal-card content-landing-modal">
        <button className="modal-close-btn" onClick={onClose}>
          <X size={20} />
        </button>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-gray)' }}>
            Loading...
          </div>
        ) : !content ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-gray)' }}>
            Title not found.
          </div>
        ) : (
          <div className="content-landing-body">
            {/* Poster */}
            <div className="content-landing-poster">
              {effectivePoster ? (
                <img src={effectivePoster} alt={content.title} />
              ) : (
                <div className="poster-fallback">
                  {isTV ? <Tv size={48} /> : <Film size={48} />}
                </div>
              )}
              {editingPoster ? (
                <div className="flex flex-col gap-2 mt-2">
                  <input
                    className="modal-select w-full"
                    type="text"
                    value={posterInput}
                    onChange={(e) => setPosterInput(e.target.value)}
                    placeholder="https://..."
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button className="btn-netflix-primary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.8rem' }} onClick={handleSavePoster}>Save</button>
                    <button className="btn-netflix-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.8rem' }} onClick={() => setEditingPoster(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn-netflix-secondary mt-2 w-full"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'center' }}
                  onClick={() => { setPosterInput(effectivePoster ?? ''); setEditingPoster(true); }}
                >
                  <Pencil size={12} />
                  Change Poster
                </button>
              )}
            </div>

            {/* Info */}
            <div className="content-landing-info">
              <h2 className="content-landing-title">{content.title}</h2>

              <div className="content-landing-meta">
                {content.release_date
                  ? <span>{new Date(content.release_date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                  : content.year && <span>{content.year}</span>
                }
                {content.rating && (
                  <span className="rating-pill">
                    <Star size={13} fill="currentColor" />
                    {content.rating.toFixed(1)}
                  </span>
                )}
                {genres.slice(0, 3).map((g) => (
                  <span key={g} className="genre-pill">{g}</span>
                ))}
              </div>

              {content.synopsis && (
                <p className="content-landing-synopsis">{content.synopsis}</p>
              )}

              {/* Movie: provider source buttons */}
              {!isTV && (
                <div className="content-landing-sources">
                  <h3>Watch on:</h3>
                  <div className="source-buttons">
                    {sources.length === 0 ? (
                      <p style={{ color: 'var(--text-gray)' }}>No sources available.</p>
                    ) : (
                      sources.map((src) => (
                        <button
                          key={src.page_url}
                          className="btn-netflix-primary source-btn"
                          onClick={() => onPlay(src.page_url, content.title, src.provider_id)}
                        >
                          <Play size={16} fill="currentColor" />
                          {src.provider_name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TV Show: season list */}
              {isTV && (
                <div className="content-landing-seasons">
                  <h3>Seasons:</h3>
                  {sources.length === 0 ? (
                    <p style={{ color: 'var(--text-gray)' }}>No seasons available.</p>
                  ) : (
                    <div className="season-list">
                      {sources.map((src) => (
                        <button
                          key={`${src.provider_id}-${src.season_number}`}
                          className="season-row-btn"
                          onClick={() => onPlay(src.page_url, `${content.title} S${src.season_number}`, src.provider_id)}
                        >
                          <span className="season-label">
                            {src.season_number != null ? `Season ${src.season_number}` : 'Full Series'}
                          </span>
                          <span className="season-provider">
                            <Play size={12} fill="currentColor" />
                            {src.provider_name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
