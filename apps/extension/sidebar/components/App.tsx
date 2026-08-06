import { useEffect, useRef, useState } from 'react';
// Inlined as a data URI: the content script renders inside host pages, where
// chrome-extension:// image URLs would need web_accessible_resources.
import logo from '../assets/logo.png?inline';
import { useStore } from '../store';
import { addFilesToContext } from '../ingest';
import { AuthView } from './AuthView';
import { ChatView } from './ChatView';
import { HistoryView } from './HistoryView';
import { PaywallView } from './PaywallView';

const SERIF = { fontFamily: 'Charter, Georgia, serif' };

/**
 * Shell: a circular button pinned to the right edge at all times.
 * - Drag files anywhere → it swells to attract the drop; over it → bigger.
 * - Drop → files land in context, it settles back with a count badge.
 * - Click → a modal attached to the right edge (left corners rounded).
 */
export function App() {
  const { email, view, theme, usage, context, billing, set, loadSession } = useStore();
  const [open, setOpen] = useState(false);
  // Discreetly dismissed: the circle collapses to a hairline sliver on the
  // edge. Persisted, so the choice holds across every tab and window.
  const [hidden, setHidden] = useState(false);
  // 'idle' → files dragged anywhere on the page → 'attract' → over the button → 'hover'
  const [dragState, setDragState] = useState<'idle' | 'attract' | 'hover'>('idle');
  const [justDropped, setJustDropped] = useState(false);
  const dragDepth = useRef(0);

  function dismiss(v: boolean) {
    setHidden(v);
    void chrome.storage.local.set({ fabHidden: v });
  }

  useEffect(() => {
    void loadSession();
    void chrome.storage.local.get('fabHidden').then(({ fabHidden }) => setHidden(!!fabHidden));
    const onMsg = (msg: { type?: string }) => {
      if (msg?.type === 'toggle-sidebar') setOpen((o) => !o);
    };
    chrome.runtime.onMessage.addListener(onMsg);

    // Page-level drag tracking: the button announces itself the moment files
    // enter the window, so the drop target isn't a 48px needle in a haystack.
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragState((s) => (s === 'hover' ? s : 'attract'));
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragState('idle');
    };
    const onDrop = () => {
      dragDepth.current = 0;
      setDragState('idle');
    };
    document.addEventListener('dragenter', onEnter, true);
    document.addEventListener('dragleave', onLeave, true);
    document.addEventListener('drop', onDrop, true);
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      document.removeEventListener('dragenter', onEnter, true);
      document.removeEventListener('dragleave', onLeave, true);
      document.removeEventListener('drop', onDrop, true);
    };
  }, [loadSession]);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragState('idle');
    if (!e.dataTransfer.files.length) return;
    const added = await addFilesToContext(e.dataTransfer.files);
    if (added > 0) {
      setJustDropped(true);
      setTimeout(() => setJustDropped(false), 1600);
    } else {
      // A failed ingest sets a specific store error — open so it's seen (QUOT-07).
      setOpen(true);
    }
  }

  const scale =
    dragState === 'hover' ? 'scale-150' : dragState === 'attract' ? 'scale-125' : justDropped ? 'scale-110' : '';

  return (
    <div className={`awa-root ${theme === 'dark' ? 'dark' : ''}`}>
      {/* Dismissed state: a near-invisible sliver on the edge brings it back.
          Dragging files temporarily reveals the circle so drop keeps working. */}
      {!open && hidden && dragState === 'idle' && (
        <button
          onClick={() => dismiss(false)}
          title="Vis assistenten"
          className="group fixed right-0 top-[42%] z-[2147483646] flex h-12 w-[10px] items-center justify-start rounded-l-full transition-colors hover:bg-ink/10"
        >
          <span className="ml-[3px] h-7 w-[3px] rounded-full bg-ink/30 transition-all group-hover:h-9 group-hover:bg-ink/70" />
        </button>
      )}

      {/* The edge circle — present at all times unless dismissed or the modal replaces it */}
      {!open && (!hidden || dragState !== 'idle') && (
        <div className="group/fab fixed right-3 top-[42%] z-[2147483646]">
        <button
          onClick={() => setOpen(true)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragState('hover');
          }}
          onDragLeave={() => setDragState((s) => (s === 'hover' ? 'attract' : s))}
          onDrop={(e) => void handleDrop(e)}
          title="AI Skriveassistent (Alt+Shift+A) — slip filer her for at vedhæfte dem"
          className={`flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-paper text-[19px] leading-none text-ink shadow-xl shadow-black/25 transition-all duration-200 ease-out hover:scale-110 ${scale} ${
            dragState !== 'idle' ? 'ring-4 ring-ink/25' : ''
          } ${justDropped ? 'ring-4 ring-ink/40' : ''}`}
          style={SERIF}
        >
          {justDropped ? '✓' : dragState !== 'idle' ? '+' : <img src={logo} alt="" className="h-7 w-7" />}
          {context.length > 0 && !justDropped && dragState === 'idle' && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full border-2 border-paper bg-ink px-1 py-px font-sans text-[9px] font-bold text-paper">
              {context.length}
            </span>
          )}
        </button>
        {/* one-click discreet dismiss, revealed on hover */}
        {dragState === 'idle' && !justDropped && (
          <button
            onClick={() => dismiss(true)}
            title="Skjul knappen — en lille stribe i kanten henter den frem igen"
            className="absolute -left-1.5 -top-1.5 hidden h-[18px] w-[18px] items-center justify-center rounded-full border border-hairline bg-paper text-[10px] font-bold leading-none text-graphite shadow-md hover:text-ink group-hover/fab:flex"
          >
            ×
          </button>
        )}
        </div>
      )}

      {/* Right-attached modal: flush right edge, rounded left corners */}
      {open && (
        <aside className="fixed right-0 top-1/2 z-[2147483646] flex h-[min(86vh,700px)] w-[400px] max-w-[92vw] -translate-y-1/2 flex-col overflow-hidden rounded-l-[26px] border border-r-0 border-hairline bg-paper/95 text-[14px] text-ink shadow-2xl shadow-black/30 backdrop-blur-xl">
          {/* The ✕ and tabs are shrink-0; the chips in the middle give way
              instead — the close button must never be pushed off the edge. */}
          <header className="flex items-center gap-1.5 border-b border-hairline py-3 pl-3 pr-2">
            <img src={logo} alt="AI Skriveassistent" className="h-7 w-7 shrink-0" />
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {usage && (
                <span
                  className="awa-eyebrow whitespace-nowrap rounded-full border border-hairline px-2 py-0.5"
                  title={`Nulstilles ${new Date(usage.resetsAt).toLocaleString('da-DK')}`}
                >
                  {usage.used} / {usage.limit}
                </span>
              )}
              {billing?.status === 'trialing' && billing.active && (
                <span
                  className="awa-eyebrow whitespace-nowrap rounded-full border border-hairline px-2 py-0.5"
                  title={`Din gratis prøveperiode slutter ${new Date(billing.trialEndsAt).toLocaleDateString('da-DK')}`}
                >
                  {billing.trialDaysLeft} {billing.trialDaysLeft === 1 ? 'dag' : 'dage'}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {email && (
                <>
                  <TabButton label="Chat" active={view === 'chat'} onClick={() => set({ view: 'chat' })} />
                  <TabButton
                    label="Historik"
                    active={view === 'history'}
                    onClick={() => {
                      set({ view: 'history' });
                      void useStore.getState().loadHistory();
                    }}
                  />
                  <TabButton
                    label="Log ud"
                    active={false}
                    onClick={() => void useStore.getState().signOut()}
                    title={`Log ud (${email})`}
                  />
                </>
              )}
              {/* Collapse keeps state (SIDE-03) — store lives outside the tree */}
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-graphite transition-colors hover:bg-wash hover:text-ink"
                title="Skjul panelet"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1">
            {!email ? (
              <AuthView />
            ) : view === 'history' ? (
              <HistoryView />
            ) : billing && !billing.active ? (
              <PaywallView />
            ) : (
              <ChatView />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`awa-eyebrow whitespace-nowrap rounded-full px-2 py-1 transition-colors ${
        active ? '!text-paper bg-ink' : 'hover:bg-wash hover:!text-ink'
      }`}
    >
      {label}
    </button>
  );
}
