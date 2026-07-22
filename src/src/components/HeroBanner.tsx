import React, { useState, useEffect, useCallback } from 'react';
import { Play, Info, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Content } from './ContentRow';

interface HeroBannerProps {
  items: Content[];
  onPlay: (contentId: string) => void;
  onOpenDetail: (contentId: string) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({ items, onPlay, onOpenDetail }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [bgError, setBgError] = useState(false);

  const current = items[activeIndex];

  // Auto-rotate every 8 seconds
  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % items.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [items.length]);

  // Reset bg error when slide changes
  useEffect(() => {
    setBgError(false);
  }, [activeIndex]);

  const goTo = useCallback((idx: number) => {
    setActiveIndex(idx);
  }, []);

  const goPrev = useCallback(() => {
    setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
  }, [items.length]);

  const goNext = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % items.length);
  }, [items.length]);

  if (!current) return null;

  const genres: string[] = current.genres ? (() => { try { return JSON.parse(current.genres) as string[]; } catch { return []; } })() : [];

  return (
    <div className="hero-banner">
      {/* Background poster */}
      <div className="hero-backdrop">
        {current.poster_url && !bgError ? (
          <img
            src={current.poster_url}
            alt={current.title}
            onError={() => setBgError(true)}
          />
        ) : (
          <div className="hero-backdrop-fallback" />
        )}
        <div className="hero-vignette-top" />
        <div className="hero-vignette-bottom" />
        <div className="hero-vignette-left" />
      </div>

      {/* Content */}
      <div className="hero-content">
        <div className="hero-badge">
          {current.rating && (
            <>
              <Star size={13} fill="currentColor" />
              <span>{current.rating.toFixed(1)}</span>
              <span className="badge-divider">·</span>
            </>
          )}
          {current.year && (
            <>
              <span style={{ color: '#fff' }}>{current.year}</span>
              <span className="badge-divider">·</span>
            </>
          )}
          <span className="badge-highlight">FEATURED</span>
        </div>

        <h1 className="hero-title">{current.title}</h1>

        {genres.length > 0 && (
          <div className="hero-tags">
            {genres.slice(0, 4).map((g) => (
              <span key={g} className="hero-tag-pill">{g}</span>
            ))}
          </div>
        )}

        {current.synopsis && (
          <p className="hero-description">{current.synopsis}</p>
        )}

        <div className="hero-actions">
          <button className="btn-hero-play" onClick={() => onPlay(current.id)}>
            <Play size={20} fill="currentColor" />
            <span>Play</span>
          </button>

          <button className="btn-hero-info" onClick={() => onOpenDetail(current.id)}>
            <Info size={20} />
            <span>More Info</span>
          </button>
        </div>
      </div>

      {/* Carousel navigation */}
      {items.length > 1 && (
        <>
          <button className="hero-arrow hero-arrow-left" onClick={goPrev} aria-label="Previous">
            <ChevronLeft size={32} />
          </button>
          <button className="hero-arrow hero-arrow-right" onClick={goNext} aria-label="Next">
            <ChevronRight size={32} />
          </button>

          <div className="hero-indicators">
            {items.map((_, idx) => (
              <button
                key={idx}
                className={`hero-dot${idx === activeIndex ? ' active' : ''}`}
                onClick={() => goTo(idx)}
                aria-label={`Slide ${idx + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
