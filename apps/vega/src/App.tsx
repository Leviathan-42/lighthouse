import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Search } from './screens/Search';
import { Library } from './screens/Library';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

type Tab = 'search' | 'library';

export function App() {
  const [tab, setTab] = useState<Tab>('search');

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app">
        <div className="app-content">
          {tab === 'search' ? <Search /> : <Library />}
        </div>

        <nav className="tab-bar">
          <button className={`tab-btn${tab === 'search' ? ' active' : ''}`} onClick={() => setTab('search')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            Search
          </button>
          <button className={`tab-btn${tab === 'library' ? ' active' : ''}`} onClick={() => setTab('library')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            Library
          </button>
        </nav>
      </div>
    </QueryClientProvider>
  );
}
