import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Info, Globe, Film, Trash2 } from 'lucide-react';
import type { Video } from '../App';
import { parseTags } from '../utils';

interface MovieRowProps {
  title: string;
  videos: Video[];
  onPlay: (video: Video) => void;
  onOpenDetails: (video: Video) => void;
  onDeleteVideo?: (id: string) => void;
}

const getDomain = (urlStr: string) => {
  try {
    const parsed = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    return parsed.hostname.replace('www.', '');
  } catch {
    return 'web';
  }
};

const VideoCard: React.FC<{
  video: Video;
  onPlay: (video: Video) => void;
  onOpenDetails: (video: Video) => void;
  onDeleteVideo?: (id: string) => void;
}> = ({ video, onPlay, onOpenDetails, onDeleteVideo }) => {
  const [imageError, setImageError] = useState(false);
  const domain = getDomain(video.page_url);
  const tags = parseTags(video.tags);

  return (
    <div className="row-card">
      <div className="card-thumbnail" onClick={() => onOpenDetails(video)}>
        {video.cover_url && !imageError ? (
          <img
            src={video.cover_url}
            alt={video.title}
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="thumbnail-fallback">
            <Film size={36} />
          </div>
        )}

        <div className="card-play-overlay">
          <button
            className="card-play-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(video);
            }}
            title="Launch Webview"
          >
            <Play size={20} fill="currentColor" />
          </button>
        </div>
      </div>

      <div className="card-meta">
        <div className="card-top-info">
          <span className="domain-pill">
            <Globe size={11} />
            {domain}
          </span>
        </div>

        <h3 className="card-title-text" onClick={() => onOpenDetails(video)}>
          {video.title}
        </h3>

        {tags.length > 0 && (
          <div className="card-tags-row">
            {tags.slice(0, 3).map((tag, idx) => (
              <span key={idx} className="card-tag-pill">
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="card-bottom-actions">
          <button
            className="card-action-btn primary"
            onClick={() => onPlay(video)}
            title="Play Webview Window"
          >
            <Play size={14} fill="currentColor" />
            <span>Play</span>
          </button>

          <button
            className="card-action-btn secondary"
            onClick={() => onOpenDetails(video)}
            title="More Info"
          >
            <Info size={14} />
          </button>

          {onDeleteVideo && (
            <button
              className="card-action-btn danger"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteVideo(video.id);
              }}
              title="Delete Bookmark"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const MovieRow: React.FC<MovieRowProps> = ({
  title,
  videos,
  onPlay,
  onOpenDetails,
  onDeleteVideo,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);

  const handleScroll = (direction: 'left' | 'right') => {
    if (rowRef.current) {
      const { scrollLeft, clientWidth } = rowRef.current;
      const scrollAmount = direction === 'left' ? scrollLeft - clientWidth * 0.75 : scrollLeft + clientWidth * 0.75;
      rowRef.current.scrollTo({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  if (videos.length === 0) return null;

  return (
    <div className="netflix-row">
      <h2 className="row-header">
        <span>{title}</span>
        <span className="row-count">({videos.length})</span>
      </h2>

      <div className="row-container">
        <button
          className="scroll-arrow left"
          onClick={() => handleScroll('left')}
          aria-label="Scroll left"
        >
          <ChevronLeft size={28} />
        </button>

        <div className="row-cards" ref={rowRef}>
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onPlay={onPlay}
              onOpenDetails={onOpenDetails}
              onDeleteVideo={onDeleteVideo}
            />
          ))}
        </div>

        <button
          className="scroll-arrow right"
          onClick={() => handleScroll('right')}
          aria-label="Scroll right"
        >
          <ChevronRight size={28} />
        </button>
      </div>
    </div>
  );
};
