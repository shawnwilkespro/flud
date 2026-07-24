import React, { useEffect, useState, useCallback } from 'react';
import { X, Globe } from 'lucide-react';

interface Provider {
  id: string;
  name: string;
  base_url: string;
  mask_left: number;
  mask_right: number;
  mask_top: number;
  mask_bottom: number;
  enabled: boolean;
}

interface CategorySetting {
  provider_id: string;
  category: string;
  enabled: boolean;
}

async function callTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<T>(command, args);
    }
  } catch (err) {
    console.warn(`[Tauri] ${command}:`, err);
  }
  return null;
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange, disabled = false, label }) => (
  <button
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    style={{
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      width: '44px',
      height: '24px',
      borderRadius: '12px',
      border: 'none',
      padding: 0,
      cursor: disabled ? 'not-allowed' : 'pointer',
      backgroundColor: checked ? '#4169E1' : 'rgba(255,255,255,0.18)',
      transition: 'background-color 0.2s ease',
      flexShrink: 0,
      opacity: disabled ? 0.5 : 1,
    }}
  >
    <span
      style={{
        position: 'absolute',
        left: checked ? '22px' : '2px',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        backgroundColor: '#ffffff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        transition: 'left 0.2s ease',
      }}
    />
  </button>
);

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ActiveTab = 'providers';

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('providers');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [categorySettings, setCategorySettings] = useState<CategorySetting[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [providerList, catSettings] = await Promise.all([
      callTauri<Provider[]>('list_providers'),
      callTauri<CategorySetting[]>('list_provider_category_settings'),
    ]);
    setProviders(providerList ?? []);
    setCategorySettings(catSettings ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const getCategorySetting = (providerId: string, category: string): boolean => {
    const found = categorySettings.find(
      (s) => s.provider_id === providerId && s.category === category
    );
    return found !== undefined ? found.enabled : true;
  };

  const handleToggle = async (providerId: string, category: string, enabled: boolean) => {
    // Optimistic update
    setCategorySettings((prev) => {
      const existing = prev.find((s) => s.provider_id === providerId && s.category === category);
      if (existing) {
        return prev.map((s) =>
          s.provider_id === providerId && s.category === category ? { ...s, enabled } : s
        );
      }
      return [...prev, { provider_id: providerId, category, enabled }];
    });

    await callTauri<void>('set_provider_category', { providerId, category, enabled });
  };

  if (!isOpen) return null;

  return (
    <div
      className="settings-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-modal-container">
        {/* Header */}
        <div className="settings-modal-header">
          <h1 className="settings-modal-title">Settings</h1>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="settings-modal-body">
          {/* Left sidebar tabs */}
          <nav className="settings-sidebar">
            <button
              className={`settings-tab-btn ${activeTab === 'providers' ? 'active' : ''}`}
              onClick={() => setActiveTab('providers')}
            >
              <Globe size={16} />
              Providers
            </button>
          </nav>

          {/* Tab content */}
          <div className="settings-content">
            {activeTab === 'providers' && (
              <div className="settings-providers-panel">
                <h2 className="settings-panel-heading">Streaming Providers</h2>
                <p className="settings-panel-subheading">
                  Control which content categories each provider serves. The global enabled state is
                  set via the provider&apos;s config file.
                </p>

                {loading ? (
                  <div className="settings-loading">Loading providers...</div>
                ) : providers.length === 0 ? (
                  <div className="settings-loading">
                    No providers configured. Add a <code>config.toml</code> to{' '}
                    <code>src-tauri/core/providers/&lt;slug&gt;/</code> and restart.
                  </div>
                ) : (
                  <div className="settings-provider-grid">
                    {providers.map((p) => {
                      const movieEnabled = getCategorySetting(p.id, 'movie');
                      const tvEnabled = getCategorySetting(p.id, 'tv_show');
                      return (
                        <div
                          key={p.id}
                          className={`settings-provider-card ${!p.enabled ? 'disabled' : ''}`}
                        >
                          <div className="settings-provider-card-header">
                            <Globe size={18} className="settings-provider-icon" />
                            <div className="settings-provider-name-group">
                              <span className="settings-provider-name">{p.name}</span>
                              <a
                                className="settings-provider-url"
                                href={p.base_url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {p.base_url}
                              </a>
                            </div>
                            <span
                              className={`settings-provider-badge ${p.enabled ? 'enabled' : 'disabled'}`}
                            >
                              {p.enabled ? 'Active' : 'Disabled'}
                            </span>
                          </div>

                          <div className="settings-provider-toggles">
                            <div className="settings-toggle-row">
                              <span className="settings-toggle-label">Movies</span>
                              <ToggleSwitch
                                checked={movieEnabled}
                                onChange={(next) => handleToggle(p.id, 'movie', next)}
                                disabled={!p.enabled}
                                label={`Toggle Movies for ${p.name}`}
                              />
                            </div>
                            <div className="settings-toggle-row">
                              <span className="settings-toggle-label">TV Shows</span>
                              <ToggleSwitch
                                checked={tvEnabled}
                                onChange={(next) => handleToggle(p.id, 'tv_show', next)}
                                disabled={!p.enabled}
                                label={`Toggle TV Shows for ${p.name}`}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
