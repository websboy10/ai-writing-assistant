import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { AuthView } from './AuthView';
import { ChatView } from './ChatView';
import { HistoryView } from './HistoryView';
import { SettingsView } from './SettingsView';

const MIN_W = 300;
const MAX_W = 640;

export function App() {
  const { email, view, theme, usage, set, loadSession } = useStore();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(380);
  const dragging = useRef(false);

  useEffect(() => {
    void loadSession();
    void chrome.storage.local.get('sidebarWidth').then(({ sidebarWidth }) => {
      if (typeof sidebarWidth === 'number') setWidth(sidebarWidth);
    });
    const onMsg = (msg: { type?: string }) => {
      if (msg?.type === 'toggle-sidebar') setOpen((o) => !o);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [loadSession]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const w = Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - e.clientX));
      setWidth(w);
    };
    const up = () => {
      if (dragging.current) {
        dragging.current = false;
        void chrome.storage.local.set({ sidebarWidth: width });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [width]);

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
      {/* Floating action button (SIDE-01) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="AI Writing Assistant (Alt+Shift+A)"
          className="fixed bottom-6 right-6 z-[2147483646] flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition hover:scale-105 hover:bg-indigo-500"
        >
          <PenIcon />
        </button>
      )}

      {/* Sidebar overlay — never alters host page layout (SIDE-05) */}
      {open && (
        <aside
          style={{ width }}
          className="fixed right-0 top-0 z-[2147483646] flex h-screen flex-col border-l border-zinc-200 bg-white text-[14px] text-zinc-900 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {/* Resize handle (SIDE-04) */}
          <div
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-400/40"
          />

          <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <PenIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="font-semibold">Writing Assistant</span>
            {usage && (
              <span
                className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                title={`Resets ${new Date(usage.resetsAt).toLocaleString()}`}
              >
                {usage.used} / {usage.limit}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {email && (
                <>
                  <TabButton label="Chat" active={view === 'chat'} onClick={() => set({ view: 'chat' })} />
                  <TabButton
                    label="History"
                    active={view === 'history'}
                    onClick={() => {
                      set({ view: 'history' });
                      void useStore.getState().loadHistory();
                    }}
                  />
                  <TabButton label="⚙" active={view === 'settings'} onClick={() => set({ view: 'settings' })} />
                </>
              )}
              {/* Collapse keeps state (SIDE-03) — component stays mounted */}
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="Collapse sidebar"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1">
            {!email ? <AuthView /> : view === 'history' ? <HistoryView /> : view === 'settings' ? <SettingsView /> : <ChatView />}
          </div>
        </aside>
      )}
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 text-[12px] ${
        active
          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300'
          : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      {label}
    </button>
  );
}

function PenIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" strokeLinecap="round" />
      <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinejoin="round" />
    </svg>
  );
}
