import React from 'react';

interface GenreGridProps {
  genres: readonly string[];
  onSelectGenre: (genre: string) => void;
}

export const GenreGrid: React.FC<GenreGridProps> = ({ genres, onSelectGenre }) => {
  return (
    <div style={{ padding: '2rem', marginTop: '2rem' }}>
      <h2 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '1.5rem', color: '#fff' }}>
        Browse by Genre
      </h2>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1rem',
      }}>
        {genres.map((genre) => (
          <button
            key={genre}
            onClick={() => onSelectGenre(genre)}
            style={{
              padding: '2rem 1rem',
              backgroundColor: '#4169E1',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              fontSize: '1.1rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#9D00FF';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#4169E1';
            }}
          >
            {genre}
          </button>
        ))}
      </div>
    </div>
  );
};
