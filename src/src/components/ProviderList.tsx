import React, { useEffect, useState } from 'react';
import { Globe, ToggleLeft, ToggleRight } from 'lucide-react';

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

export const ProviderList: React.FC = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    callTauri<Provider[]>('list_providers').then((list) => {
      setProviders(list ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-gray)' }}>
        Loading providers...
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-gray)' }}>
        No providers configured. Add a <code>config.toml</code> to{' '}
        <code>src-tauri/core/providers/&lt;slug&gt;/</code> and restart the app.
      </div>
    );
  }

  return (
    <div className="provider-list-wrapper">
      <h2 className="row-header" style={{ padding: '1.5rem 4% 0' }}>
        <span>Streaming Providers</span>
        <span className="row-count">({providers.length})</span>
      </h2>

      <div className="provider-cards">
        {providers.map((p) => (
          <div key={p.id} className={`provider-card ${p.enabled ? '' : 'disabled'}`}>
            <div className="provider-card-header">
              <Globe size={20} />
              <span className="provider-card-name">{p.name}</span>
              {p.enabled ? (
                <ToggleRight size={22} className="provider-toggle on" />
              ) : (
                <ToggleLeft size={22} className="provider-toggle off" />
              )}
            </div>

            <a
              className="provider-card-url"
              href={p.base_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {p.base_url}
            </a>

            <div className="provider-card-mask">
              <span className="mask-label">Mask</span>
              <span>L:{p.mask_left}</span>
              <span>R:{p.mask_right}</span>
              <span>T:{p.mask_top}</span>
              <span>B:{p.mask_bottom}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
