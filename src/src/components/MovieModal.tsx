import React from 'react';
import { X, Play, ExternalLink, Trash2, Folder, Globe, Calendar, Pencil } from 'lucide-react';
import type { Video, Playlist } from '../App';
import { parseTags } from '../utils';

interface MovieModalProps {
  video: Video | null;
  playlists: Playlist[];
  onClose: () => void;
  onPlay: (video: Video) => void;
  onDelete: (id: string) => void;
  onSetPlaylist: (videoId: string, playlistId: string | null) => void;
  onUpdateCover: (id: string, coverUrl: string) => Promise<void>;
}

export const MovieModal: React.FC<MovieModalProps> = ({
  video,
  playlists,
  onClose,
  onPlay,
  onDelete,
  onSetPlaylist,
  onUpdateCover,
}) => {
  const [bgError, setBgError] = React.useState(false);
  const [editingCover, setEditingCover] = React.useState(false);
  const [coverInput, setCoverInput] = React.useState('');
  const [localCoverUrl, setLocalCoverUrl] = React.useState<string | null | undefined>(undefined);

  if (!video) return null;

  const effectiveCoverUrl = localCoverUrl !== undefined ? localCoverUrl : video.cover_url;

  const handleSaveCover = async () => {
    await onUpdateCover(video.id, coverInput.trim());
    setLocalCoverUrl(coverInput.trim() || null);
    setBgError(false);
    setEditingCover(false);
  };

  const getDomain = (urlStr: string) => {
    try {
      const parsed = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
      return parsed.hostname.replace('www.', '');
    } catch {
      return 'web';
    }
  };
  const tags = parseTags(video.tags);
  const domain = getDomain(video.page_url);
  const fallbackBackdrop = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80';
  const backdropImage = (!bgError && effectiveCoverUrl) ? effectiveCoverUrl : fallbackBackdrop;

  return (
    <div className="netflix-modal-backdrop" onClick={onClose}>
      <div className="netflix-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button className="modal-close-btn" onClick={onClose}>
          <X size={20} />
        </button>

        {/* Media Header */}
        <div className="modal-hero">
          <img src={backdropImage} alt={video.title} onError={() => setBgError(true)} />
          <div className="modal-hero-overlay" />

          <div className="modal-hero-content">
            <div className="modal-domain-badge">
              <Globe size={14} />
              <span>{domain}</span>
            </div>
            <h2 className="modal-title">{video.title}</h2>

            <div className="modal-hero-actions">
              <button
                className="btn-modal-play"
                onClick={() => {
                  onPlay(video);
                  onClose();
                }}
              >
                <Play size={20} fill="currentColor" />
                <span>Play Webview Window</span>
              </button>

              <a
                href={video.page_url}
                target="_blank"
                rel="noreferrer"
                className="btn-modal-external"
                title="Open in System Browser"
              >
                <ExternalLink size={18} />
              </a>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          <div className="modal-info-grid">
            <div className="modal-info-left">
              <div className="modal-meta-row">
                <span className="match-pill">98% Match</span>
                <span className="meta-text">
                  <Calendar size={13} style={{ display: 'inline', marginRight: '4px' }} />
                  {new Date(video.added_at).toLocaleDateString()}
                </span>
                <span className="hd-badge">HD 4K</span>
              </div>

              <p className="modal-description">
                Url: <a href={video.page_url} target="_blank" rel="noreferrer" className="modal-link">{video.page_url}</a>
              </p>

              {tags.length > 0 && (
                <div className="modal-tags-container">
                  <span className="modal-section-label">Tags:</span>
                  <div className="modal-tags-list">
                    {tags.map((t, i) => (
                      <span key={i} className="modal-tag-chip">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-info-right">
              {/* Cover URL Editor */}
              <div className="modal-setting-box">
                <label className="setting-label">
                  <Pencil size={15} />
                  <span>Cover Image URL:</span>
                </label>
                {editingCover ? (
                  <div className="flex gap-2 mt-1">
                    <input
                      className="modal-select flex-1"
                      type="text"
                      value={coverInput}
                      onChange={(e) => setCoverInput(e.target.value)}
                      placeholder="https://..."
                      autoFocus
                    />
                    <button className="btn-modal-play" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={handleSaveCover}>Save</button>
                    <button className="btn-modal-external" style={{ padding: '0.4rem 0.8rem' }} onClick={() => setEditingCover(false)}>Cancel</button>
                  </div>
                ) : (
                  <button
                    className="btn-modal-external mt-1"
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                    onClick={() => { setCoverInput(effectiveCoverUrl ?? ''); setEditingCover(true); }}
                  >
                    <Pencil size={13} />
                    <span>Change Cover</span>
                  </button>
                )}
              </div>

              {/* Playlist Selection */}
              <div className="modal-setting-box">
                <label className="setting-label">
                  <Folder size={15} />
                  <span>Assign to Playlist Shelf:</span>
                </label>
                <select
                  className="modal-select"
                  value={video.playlist_id || ''}
                  onChange={(e) => onSetPlaylist(video.id, e.target.value || null)}
                >
                  <option value="">No Playlist (General)</option>
                  {playlists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Danger Actions */}
              <div style={{ marginTop: '1.5rem' }}>
                <button
                  className="btn-modal-delete"
                  onClick={() => {
                    onDelete(video.id);
                    onClose();
                  }}
                >
                  <Trash2 size={16} />
                  <span>Delete Bookmark</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
