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
    <div className={`awa-root ${theme === 'dark' ? 'dark' : ''}`}>
      {/* Floating mark: pilcrow on ink (SIDE-01) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="AI Writing Assistant (Alt+Shift+A)"
          className="fixed bottom-6 right-6 z-[2147483646] flex h-11 w-11 items-center justify-center rounded-xl bg-ink font-draft text-[20px] leading-none text-paper shadow-lg transition-transform hover:scale-105"
          style={{ fontFamily: 'Charter, Georgia, serif' }}
        >
          ¶
        </button>
      )}

      {/* Sidebar overlay — never alters host page layout (SIDE-05) */}
      {open && (
        <aside
          style={{ width }}
          className="fixed right-0 top-0 z-[2147483646] flex h-screen flex-col border-l border-hairline bg-paper text-[14px] text-ink shadow-2xl"
        >
          {/* Resize handle (SIDE-04) */}
          <div
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-ink/20"
          />

          <header className="flex items-center gap-2 border-b border-hairline px-3 py-2.5">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[13px] text-paper"
              style={{ fontFamily: 'Charter, Georgia, serif' }}
            >
              ¶
            </span>
            <span className="awa-eyebrow whitespace-nowrap !text-ink">Assistant</span>
            {usage && (
              <span
                className="awa-eyebrow ml-1 whitespace-nowrap rounded border border-hairline px-1.5 py-0.5"
                title={`Resets ${new Date(usage.resetsAt).toLocaleString()}`}
              >
                {usage.used} / {usage.limit}
              </span>
            )}
            <div className="ml-auto flex items-center gap-0.5">
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
                  <TabButton label="Settings" active={view === 'settings'} onClick={() => set({ view: 'settings' })} />
                </>
              )}
              {/* Collapse keeps state (SIDE-03) — component stays mounted */}
              <button
                onClick={() => setOpen(false)}
                className="ml-1 rounded p-1 text-graphite hover:bg-wash hover:text-ink"
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
      className={`awa-eyebrow rounded px-2 py-1 transition-colors ${
        active ? '!text-paper bg-ink' : 'hover:bg-wash hover:!text-ink'
      }`}
    >
      {label}
    </button>
  );
}
