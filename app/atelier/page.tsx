'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Curation from './Curation';

// The six cards on the public site. These are portfolio pieces, which is a different
// set from the projects below: those are client work with logs and Windows attached.
// Same word, two meanings, so they are kept deliberately apart.
const SITE_CARDS = [
  { key: 'artinian', label: 'Artinian Gems' },
  { key: 'caveman', label: 'Caveman Gems' },
  { key: 'limicon', label: 'LimIcon' },
  { key: 'unimpact', label: 'UnImpact' },
  { key: 'studiolo', label: 'Studiolo' },
  { key: 'pentinian', label: 'Pentinian' },
];

type Proj = {
  id: string; name: string; phase: string | null;
  client_facing: boolean; linked: boolean;
  client: { name: string; has_login: boolean } | null;
  quarry: number; released: number; held: number;
};

export default function AtelierPage() {
  const [tab, setTab] = useState<'curation' | 'site'>('curation');
  const [projects, setProjects] = useState<Proj[]>([]);
  const [orphaned, setOrphaned] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [config, setConfig] = useState<any>({
    open_for_work: true,
    availability: 'One slot, Q3',
    public_projects: SITE_CARDS.map((c) => c.key),
  });
  const [msg, setMsg] = useState('');

  const project = projects.find((p) => p.id === selId) ?? null;

  // Note: the client is created inside functions (never at render), so nothing
  // touches Supabase during the static build, only at runtime in the browser.
  const load = useCallback(async () => {
    // Projects come through /api/projects rather than straight from the browser,
    // because the counts need work_log_raw, which no browser JWT can read.
    const res = await fetch('/api/projects', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setProjects(d.projects ?? []);
      setOrphaned(d.orphaned ?? 0);
      setSelId((cur) => cur ?? d.projects?.[0]?.id ?? null);
    }
    const supabase = createClient();
    const { data: cfg } = await supabase.from('site_config').select('config').eq('id', 1).single();
    if (cfg?.config) setConfig((c: any) => ({ ...c, ...cfg.config }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleFacing(p: Proj) {
    setMsg('');
    const res = await fetch('/api/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, client_facing: !p.client_facing }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error);
    setMsg(
      d.project.client_facing
        ? `${d.project.name} can now receive released work.`
        : d.stillLive
          ? `${d.project.name} is internal again. ${d.stillLive} already-released entr${d.stillLive === 1 ? 'y stays' : 'ies stay'} visible until pulled back.`
          : `${d.project.name} is internal. Nothing can be released to it.`
    );
    load();
  }

  async function sync() {
    setMsg('Syncing from Notion…');
    const res = await fetch('/api/notion-sync', { method: 'POST' });
    const j = await res.json();
    setMsg(res.ok ? `Pulled ${j.pulled} entries into the Quarry.` : `Sync error: ${j.error}`);
    load();
  }

  function toggleProject(key: string) {
    const set = new Set<string>(config.public_projects ?? []);
    set.has(key) ? set.delete(key) : set.add(key);
    setConfig({ ...config, public_projects: Array.from(set) });
  }

  async function saveConfig() {
    const supabase = createClient();
    setMsg('Saving…');
    const { error } = await supabase
      .from('site_config')
      .update({ config, updated_at: new Date().toISOString() })
      .eq('id', 1);
    setMsg(error ? `Save error: ${error.message}` : 'Saved. The public site reads this config.');
  }

  return (
    <>
      <div className="wr-top">
        <span className="brand">
          <svg viewBox="0 0 32 32" fill="none">
            <g stroke="#7E9270" strokeWidth="1.5">
              <circle cx="16" cy="16" r="10" />
              <circle cx="16" cy="16" r="5.5" />
            </g>
            <circle cx="16" cy="16" r="1.8" fill="#B0805C" />
          </svg>
          Pentinian · Atelier
        </span>
        <span className="wr-search">⌕ Search projects, logs, notes…</span>
        <button className="mini-btn pri" onClick={sync}>
          Sync Notion
        </button>
        <a className="tb-switch" href="/window" style={{ marginLeft: 10 }} title="See it as a client does">
          Window &#8599;
        </a>
        <form action="/auth/signout" method="post" style={{ marginLeft: 10 }}>
          <button className="signout" type="submit">
            Sign out
          </button>
        </form>
      </div>

      <div className="wr-shell">
        <div className="rail">
          <div className="rl-label">Projects · The Spine</div>

          {projects.length === 0 && <p className="rl-none">No projects yet.</p>}

          {projects.map((p) => (
            <button
              key={p.id}
              className={'ri' + (p.client_facing ? ' live' : '') + (p.id === selId ? ' sel' : '')}
              onClick={() => setSelId(p.id)}
              title={p.client_facing ? 'Client-facing' : 'Internal'}
            >
              <span className="st" style={p.client_facing ? undefined : { background: 'transparent' }} />
              <span className="ri-name">{p.name}</span>
              {p.quarry > 0 && <span className="ri-n">{p.quarry}</span>}
            </button>
          ))}

          {orphaned > 0 && (
            <p className="rl-note" title="Synced from Notion with no project attached">
              {orphaned} unplaced entr{orphaned === 1 ? 'y' : 'ies'}
            </p>
          )}

          <div className="rl-sec" />
          <div className="rl-label">Workspace</div>
          <button className="ri">
            <span className="st" style={{ background: 'transparent' }} /> Clients
          </button>
          <button className="ri">
            <span className="st" style={{ background: 'transparent' }} /> Field Notes
          </button>
        </div>

        <div className="wr-main">
          <div className="wr-h">
            <h2>{project?.name ?? 'Atelier'}</h2>
            {project && (
              <>
                <button
                  className={'facing-tog' + (project.client_facing ? ' on' : '')}
                  onClick={() => toggleFacing(project)}
                  title="Whether work can be released to this project's client"
                >
                  {project.client_facing ? 'Client-facing' : 'Internal'}
                </button>
                <span className="wr-sub">
                  {project.client
                    ? project.client.has_login
                      ? project.client.name
                      : `${project.client.name}, not invited yet`
                    : 'no client linked'}
                  {project.released > 0 && ` · ${project.released} released`}
                </span>
              </>
            )}
          </div>

          <div className="tabs">
            <button className={tab === 'curation' ? 'on' : ''} onClick={() => setTab('curation')}>
              Curation
            </button>
            <button className={tab === 'site' ? 'on' : ''} onClick={() => setTab('site')}>
              The Window (site calibration)
            </button>
          </div>

          {msg && <p style={{ fontSize: 12.5, color: 'var(--sage-deep)', margin: '0 0 14px' }}>{msg}</p>}

          {tab === 'curation' && <Curation projectId={selId} projectName={project?.name ?? null} />}

          {tab === 'site' && (
            <div className="wp">
              <div className="wph">
                <h4>Site calibration</h4>
                <span className="tag sage">Governs pentinian.com</span>
              </div>
              <div className="wpb">
                <div className="calib-row">
                  <span className="lead">
                    <b>Open for work</b>
                    <small>Shows the availability signal on the public site.</small>
                  </span>
                  <button
                    className={`toggle${config.open_for_work ? ' on' : ''}`}
                    onClick={() => setConfig({ ...config, open_for_work: !config.open_for_work })}
                    aria-label="open for work"
                  />
                </div>
                <div className="calib-row" style={{ display: 'block' }}>
                  <span className="lead">
                    <b>Availability text</b>
                  </span>
                  <input
                    className="uline"
                    style={{ marginTop: 8 }}
                    value={config.availability ?? ''}
                    onChange={(e) => setConfig({ ...config, availability: e.target.value })}
                  />
                </div>
                <div className="calib-row" style={{ display: 'block' }}>
                  <span className="lead">
                    <b>Public project cards</b>
                    <small>
                      Which of the six Selected Work rows appear on pentinian.com. These are
                      portfolio pieces, not the client projects in the rail. Removing one takes
                      it out of the list, not off the web: its case study still answers at its
                      own link.
                    </small>
                  </span>
                  <div className="chips-edit">
                    {SITE_CARDS.map((c) => {
                      const on = (config.public_projects ?? []).includes(c.key);
                      return (
                        <button
                          key={c.key}
                          className={`pchip${on ? ' on' : ''}`}
                          onClick={() => toggleProject(c.key)}
                        >
                          {on ? '●' : '○'} {c.label}
                        </button>
                      );
                    })}
                  </div>
                  {(config.public_projects ?? []).length === 0 && (
                    <p className="calib-warn">
                      With none selected, Selected Work disappears from the public site entirely.
                    </p>
                  )}
                </div>
                <div style={{ marginTop: 18 }}>
                  <button className="btn-line sage" onClick={saveConfig}>
                    Save calibration
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
