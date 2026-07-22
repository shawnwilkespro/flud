import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Film } from 'lucide-react';
import { ContentRow } from './ContentRow';
import type { Content } from './ContentRow';

const PAGE_SIZE = 50;

interface GenreCatalogProps {
  genre: string;
  onOpenDetail: (id: string) => void;
  onPlay: (id: string) => void;
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

export const GenreCatalog: React.FC<GenreCatalogProps> = ({ genre, onOpenDetail, onPlay }) => {
  const [items, setItems] = useState<Content[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  const fetchGenreContent = useCallback(async (pageNum: number) => {
    setLoading(true);
    const offset = pageNum * PAGE_SIZE;
    // Capitalize genre name to match database format (Drama not drama)
    const capitalizedGenre = genre.charAt(0).toUpperCase() + genre.slice(1);
    const result = await callTauri<Content[]>('list_content_by_genre', {
      genre: capitalizedGenre,
      limit: PAGE_SIZE,
      offset,
    });
    const newItems = result ?? [];
    setItems(newItems);
    setHasMore(newItems.length === PAGE_SIZE);
    setLoading(false);
  }, [genre]);

  useEffect(() => {
    fetchGenreContent(page);
  }, [page, genre, fetchGenreContent]);

  const handleNextPage = () => {
    if (hasMore) setPage((p) => p + 1);
  };

  const handlePrevPage = () => {
    if (page > 0) setPage((p) => p - 1);
  };

  const chunks = chunkArray(items, 24);

  return (
    <div style={{ padding: '0 2rem 2rem' }}>
      <h1 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '2rem', color: '#fff' }}>
        {genre}
      </h1>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-gray)' }}>
          Loading...
        </div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-gray)' }}>
          <Film size={48} color="var(--netflix-red)" style={{ margin: '0 auto 1rem' }} />
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
            No content found
          </h2>
          <p>Try another genre.</p>
        </div>
      ) : (
        <>
          {chunks.map((chunk, i) => (
            <ContentRow
              key={i}
              title={i === 0 ? `${genre} · ${items.length} items` : `Page ${i + 1}`}
              items={chunk}
              onOpenDetail={onOpenDetail}
              onPlay={onPlay}
              providerLabel="FMovies"
            />
          ))}

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '2rem' }}>
            <button
              className="btn-netflix-secondary"
              onClick={handlePrevPage}
              disabled={page === 0}
              style={{ gap: '0.5rem' }}
            >
              ← Previous
            </button>
            <span style={{ color: 'var(--text-gray)', display: 'flex', alignItems: 'center' }}>
              Page {page + 1}
            </span>
            <button
              className="btn-netflix-secondary"
              onClick={handleNextPage}
              disabled={!hasMore || loading}
              style={{ gap: '0.5rem' }}
            >
              <span>Next</span>
              <ChevronDown size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
