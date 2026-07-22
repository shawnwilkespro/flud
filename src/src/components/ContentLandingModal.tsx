import React, { useEffect, useState } from 'react';
import { X, Play, Star, Tv, Film } from 'lucide-react';

interface Content {
  id: string;
  tmdb_id?: number | null;
  title: string;
  media_type: string;
  synopsis?: string | null;
  poster_url?: string | null;
  year?: number | null;
  genres?: string | null;
  rating?: number | null;
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
}) => {
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contentId) {
      setDetail(null);
      return;
    }
    setLoading(true);
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

  return (
    <div
      className="modal-backdrop"
      onClick={handleBackdropClick}
      style={{ zIndex: 1000 }}
    >
      <div className="modal-content content-landing-modal">
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
              {content.poster_url ? (
                <img src={content.poster_url} alt={content.title} />
              ) : (
                <div className="poster-fallback">
                  {isTV ? <Tv size={48} /> : <Film size={48} />}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="content-landing-info">
              <h2 className="content-landing-title">{content.title}</h2>

              <div className="content-landing-meta">
                {content.year && <span>{content.year}</span>}
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
                          key={src.provider_id}
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
