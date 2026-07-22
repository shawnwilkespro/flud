import React, { useState } from 'react';
import { X, FolderPlus } from 'lucide-react';

interface AddPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddPlaylist: (name: string) => void;
}

export const AddPlaylistModal: React.FC<AddPlaylistModalProps> = ({
  isOpen,
  onClose,
  onAddPlaylist,
}) => {
  const [name, setName] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAddPlaylist(name);
    setName('');
    onClose();
  };

  return (
    <div className="netflix-modal-backdrop" onClick={onClose}>
      <div className="netflix-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Create New Playlist Shelf</h2>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog-form">
          <div className="form-field">
            <label>Playlist Name *</label>
            <div className="input-with-icon">
              <FolderPlus size={16} />
              <input
                type="text"
                placeholder="e.g. Web Development & Design"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="dialog-footer">
            <button type="button" className="btn-netflix-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-netflix-primary">
              Create Shelf
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
