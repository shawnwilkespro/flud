import React, { useState } from 'react';
import { X, Film, Link, Image as ImageIcon, Tag } from 'lucide-react';

interface AddVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddVideo: (title: string, pageUrl: string, coverUrl: string, tagsInput: string) => void;
}

export const AddVideoModal: React.FC<AddVideoModalProps> = ({
  isOpen,
  onClose,
  onAddVideo,
}) => {
  const [title, setTitle] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !pageUrl.trim()) return;
    onAddVideo(title, pageUrl, coverUrl, tagsInput);
    setTitle('');
    setPageUrl('');
    setCoverUrl('');
    setTagsInput('');
    onClose();
  };

  return (
    <div className="netflix-modal-backdrop" onClick={onClose}>
      <div className="netflix-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Add New Video Bookmark</h2>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog-form">
          <div className="form-field">
            <label>Video Title *</label>
            <div className="input-with-icon">
              <Film size={16} />
              <input
                type="text"
                placeholder="e.g. Next-Gen Tauri v2 Desktop Framework"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-field">
            <label>Webpage / Video URL *</label>
            <div className="input-with-icon">
              <Link size={16} />
              <input
                type="url"
                placeholder="https://youtube.com/watch?v=..."
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-field">
            <label>Cover / Backdrop Image URL (Optional)</label>
            <div className="input-with-icon">
              <ImageIcon size={16} />
              <input
                type="url"
                placeholder="https://images.unsplash.com/..."
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="form-field">
            <label>Tags (comma separated)</label>
            <div className="input-with-icon">
              <Tag size={16} />
              <input
                type="text"
                placeholder="react, tauri, rust, design"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </div>
          </div>

          <div className="dialog-footer">
            <button type="button" className="btn-netflix-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-netflix-primary">
              Add Bookmark
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
