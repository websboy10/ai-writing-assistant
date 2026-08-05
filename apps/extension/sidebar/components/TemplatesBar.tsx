import { useEffect, useState } from 'react';
import { call } from '../api';
import { useStore } from '../store';

interface Template {
  id: string;
  name: string;
  instructions: string;
}

const MONO = { fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" };

/**
 * Saved prompt templates (PROD-01). Picking one fills the composer; saving
 * captures the composer's current text under a name. Templates are per-user
 * and server-stored, so they follow the account across devices.
 */
export function TemplatesBar({
  input,
  onApply,
}: {
  input: string;
  onApply: (text: string) => void;
}) {
  const s = useStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const res = await call({ kind: 'api', path: '/api/templates' });
    if (res.ok) setTemplates(res.data as Template[]);
  }

  async function save() {
    if (!name.trim() || !input.trim()) return;
    setBusy(true);
    const res = await call({
      kind: 'api',
      path: '/api/templates',
      method: 'POST',
      body: { name: name.trim(), instructions: input },
    });
    setBusy(false);
    if (!res.ok) {
      s.set({ error: res.error ?? 'Could not save the template.' });
      return;
    }
    setName('');
    setSaving(false);
    void refresh();
  }

  async function remove(id: string) {
    const res = await call({ kind: 'api', path: `/api/templates/${id}`, method: 'DELETE' });
    if (res.ok) setTemplates((t) => t.filter((x) => x.id !== id));
    else s.set({ error: res.error ?? 'Could not delete the template.' });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {templates.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value);
            if (t) onApply(t.instructions);
          }}
          className="max-w-[150px] rounded-lg border border-hairline bg-paper px-2 py-1 text-[11px] text-ink outline-none focus:border-ink"
          style={MONO}
          title="Insert a saved template into the composer"
        >
          <option value="" disabled>
            Template…
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      {!saving ? (
        <button
          onClick={() => setSaving(true)}
          disabled={!input.trim()}
          className="rounded-full border border-hairline px-2.5 py-1 text-[11px] text-graphite hover:border-ink hover:text-ink disabled:opacity-40"
          style={MONO}
          title={input.trim() ? 'Save the composer text as a reusable template' : 'Type something first, then save it as a template'}
        >
          Save as template
        </button>
      ) : (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') setSaving(false);
            }}
            placeholder="Template name"
            className="w-32 rounded-lg border border-ink bg-paper px-2 py-1 text-[11px] outline-none"
            style={MONO}
          />
          <button onClick={() => void save()} disabled={busy || !name.trim()} className="rounded-full bg-ink px-2.5 py-1 text-[11px] text-paper disabled:opacity-40" style={MONO}>
            Save
          </button>
          <button onClick={() => setSaving(false)} className="px-1 text-[11px] text-graphite hover:text-ink" style={MONO}>
            ✕
          </button>
        </span>
      )}

      {templates.length > 0 && (
        <TemplateManager templates={templates} onDelete={remove} />
      )}
    </div>
  );
}

function TemplateManager({ templates, onDelete }: { templates: Template[]; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[11px] text-graphite underline-offset-2 hover:text-ink hover:underline" style={MONO}>
        manage
      </button>
    );
  }
  return (
    <div className="w-full space-y-1 rounded-xl border border-hairline p-2">
      {templates.map((t) => (
        <div key={t.id} className="flex items-center gap-2 text-[12px]">
          <span className="min-w-0 flex-1 truncate" title={t.instructions}>
            {t.name}
          </span>
          <button onClick={() => onDelete(t.id)} className="text-graphite underline-offset-2 hover:text-ink hover:underline">
            Delete
          </button>
        </div>
      ))}
      <button onClick={() => setOpen(false)} className="awa-eyebrow" >
        Close
      </button>
    </div>
  );
}
