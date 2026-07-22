import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Film, Tv, Star, Info, Globe } from 'lucide-react';

export interface Content {
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

interface ContentCardProps {
  item: Content;
  onOpenDetail: (id: string) => void;
  onPlay?: (id: string) => void;
  providerLabel?: string;
}

const ContentCard: React.FC<ContentCardProps> = ({ item, onOpenDetail, onPlay, providerLabel }) => {
  const [imgError, setImgError] = React.useState(false);
  const isTV = item.media_type === 'tv_show';

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPlay) {
      onPlay(item.id);
    } else {
      onOpenDetail(item.id);
    }
  };

  return (
    <div className="row-card" onClick={() => onOpenDetail(item.id)}>
      <div className="card-thumbnail">
        {item.poster_url && !imgError ? (
          <img
            src={item.poster_url}
            alt={item.title}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="thumbnail-fallback">
            {isTV ? <Tv size={36} /> : <Film size={36} />}
          </div>
        )}

        <div className="card-play-overlay">
          <button
            className="card-play-btn"
            onClick={handlePlay}
            title="Play"
          >
            <Play size={20} fill="currentColor" />
          </button>
        </div>
      </div>

      <div className="card-meta">
        <div className="card-top-info">
          {providerLabel && (
            <span className="domain-pill">
              <Globe size={11} />
              {providerLabel}
            </span>
          )}
          {item.rating && (
            <span className="domain-pill" style={{ color: '#f5c518' }}>
              <Star size={11} fill="currentColor" />
              {item.rating.toFixed(1)}
            </span>
          )}
          {item.year && (
            <span className="domain-pill">{item.year}</span>
          )}
        </div>

        <h3 className="card-title-text">{item.title}</h3>

        <div className="card-bottom-actions">
          <button
            className="card-action-btn primary"
            onClick={handlePlay}
          >
            <Play size={14} fill="currentColor" />
            <span>Play</span>
          </button>
          <button
            className="card-action-btn secondary"
            onClick={(e) => { e.stopPropagation(); onOpenDetail(item.id); }}
            title="Details & Sources"
          >
            <Info size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

interface ContentRowProps {
  title: string;
  items: Content[];
  onOpenDetail: (contentId: string) => void;
  onPlay?: (contentId: string) => void;
  providerLabel?: string;
}

export const ContentRow: React.FC<ContentRowProps> = ({ title, items, onOpenDetail, onPlay, providerLabel }) => {
  const rowRef = useRef<HTMLDivElement>(null);

  const handleScroll = (dir: 'left' | 'right') => {
    if (rowRef.current) {
      const { scrollLeft, clientWidth } = rowRef.current;
      rowRef.current.scrollTo({
        left: dir === 'left' ? scrollLeft - clientWidth * 0.75 : scrollLeft + clientWidth * 0.75,
        behavior: 'smooth',
      });
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="netflix-row">
      <h2 className="row-header">
        <span>{title}</span>
        <span className="row-count">({items.length})</span>
      </h2>

      <div className="row-container">
        <button className="scroll-arrow left" onClick={() => handleScroll('left')}>
          <ChevronLeft size={28} />
        </button>

        <div className="row-cards" ref={rowRef}>
          {items.map((item) => (
            <ContentCard key={item.id} item={item} onOpenDetail={onOpenDetail} onPlay={onPlay} providerLabel={providerLabel} />
          ))}
        </div>

        <button className="scroll-arrow right" onClick={() => handleScroll('right')}>
          <ChevronRight size={28} />
        </button>
      </div>
    </div>
  );
};
