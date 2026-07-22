import React, { useState, useEffect } from 'react';
import { Search, Plus, FolderPlus, MonitorPlay } from 'lucide-react';

interface NavbarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onOpenAddVideo: () => void;
  onOpenAddPlaylist: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  searchQuery,
  setSearchQuery,
  onOpenAddVideo,
  onOpenAddPlaylist,
  activeTab,
  setActiveTab,
}) => {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 40) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav className={`netflix-navbar ${isScrolled ? 'scrolled' : ''}`}>
      <div className="navbar-left">
        <div className="brand-logo-group" onClick={() => setActiveTab('home')}>
          <div className="brand-icon">
            <MonitorPlay size={22} color="#fff" />
          </div>
          <span className="brand-name">FLUD</span>
        </div>

        <div className="nav-links">
          <button
            className={`nav-link ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => setActiveTab('home')}
          >
            Home
          </button>
          <button
            className={`nav-link ${activeTab === 'movies' ? 'active' : ''}`}
            onClick={() => setActiveTab('movies')}
          >
            Movies
          </button>
          <button
            className={`nav-link ${activeTab === 'tv' ? 'active' : ''}`}
            onClick={() => setActiveTab('tv')}
          >
            TV Shows
          </button>
          <button
            className={`nav-link ${activeTab === 'playlists' ? 'active' : ''}`}
            onClick={() => setActiveTab('playlists')}
          >
            Playlists
          </button>
          <button
            className={`nav-link ${activeTab === 'tags' ? 'active' : ''}`}
            onClick={() => setActiveTab('tags')}
          >
            Tags & Topics
          </button>
          <button
            className={`nav-link ${activeTab === 'providers' ? 'active' : ''}`}
            onClick={() => setActiveTab('providers')}
          >
            Providers
          </button>
        </div>
      </div>

      <div className="navbar-right">
        {/* Search Bar */}
        <div className="netflix-search">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Titles, tags, URLs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Action Buttons */}
        <button className="btn-netflix-secondary" onClick={onOpenAddPlaylist} title="Create Playlist Shelf">
          <FolderPlus size={16} />
          <span className="btn-text">New Shelf</span>
        </button>

        <button className="btn-netflix-primary" onClick={onOpenAddVideo} title="Add New Video Bookmark">
          <Plus size={18} />
          <span className="btn-text">Add Video</span>
        </button>
      </div>
    </nav>
  );
};
