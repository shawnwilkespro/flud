import React from 'react';
import { Play, Info, Globe } from 'lucide-react';
import type { Video } from '../App';
import { parseTags } from '../utils';

interface HeroBannerProps {
  video: Video | null;
  onPlay: (video: Video) => void;
  onOpenDetails: (video: Video) => void;
}

const getDomain = (urlStr: string) => {
  try {
    const parsed = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    return parsed.hostname.replace('www.', '');
  } catch {
    return 'web';
  }
};

export const HeroBanner: React.FC<HeroBannerProps> = ({ video, onPlay, onOpenDetails }) => {
  const [bgError, setBgError] = React.useState(false);

  if (!video) return null;

  const tagsList = parseTags(video.tags);

  const fallbackBackdrop = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1600&q=80';
  const backdropImage = (!bgError && video.cover_url) ? video.cover_url : fallbackBackdrop;

  return (
    <div className="hero-banner">
      {/* Background Media */}
      <div className="hero-backdrop">
        <img src={backdropImage} alt={video.title} onError={() => setBgError(true)} />
        <div className="hero-vignette-top" />
        <div className="hero-vignette-bottom" />
        <div className="hero-vignette-left" />
      </div>

      {/* Hero Content */}
      <div className="hero-content">
        <div className="hero-badge">
          <Globe size={13} />
          <span>{getDomain(video.page_url)}</span>
          <span className="badge-divider">•</span>
          <span className="badge-highlight">FEATURED BOOKMARK</span>
        </div>

        <h1 className="hero-title">{video.title}</h1>

        {tagsList.length > 0 && (
          <div className="hero-tags">
            {tagsList.map((tag: string, idx: number) => (
              <span key={idx} className="hero-tag-pill">
                #{tag}
              </span>
            ))}
          </div>
        )}

        <p className="hero-description">
          Stream directly inside your native Tauri webview shell. Click play to open the webpage in an isolated desktop window.
        </p>

        {/* Hero Actions */}
        <div className="hero-actions">
          <button className="btn-hero-play" onClick={() => onPlay(video)}>
            <Play size={20} fill="currentColor" />
            <span>Play Webview</span>
          </button>

          <button className="btn-hero-info" onClick={() => onOpenDetails(video)}>
            <Info size={20} />
            <span>More Info</span>
          </button>
        </div>
      </div>
    </div>
  );
};
