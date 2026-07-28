'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Curation from './Curation';

const ALL_PROJECTS = ['Artinian', 'Caveman', 'LimIcon', 'UnImpact', 'Studiolo'];

export default function AtelierPage() {
  const [tab, setTab] = useState<'curation' | 'site'>('curation');
  const [raw, setRaw] = useState<any[]>([]);
  const [released, setReleased] = useState<any[]>([]);
  const [project, setProject] = useState<any>(null);
  const [config, setConfig] = useState<any>({
    open_for_work: true,
    availability: 'One slot, Q3',
    public_projects: ALL_PROJECTS,
  });
  const [msg, setMsg] = useState('');

  // Note: the client is created inside functions (never at render), so nothing
  // touches Supabase during the static build, only at runtime in the browser.
  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: projects } = await supabase.from('projects').select('*').limit(1);
    setProject(projects?.[0] ?? null);
    // work_log_raw is unreachable from the browser by design; Curation reads it
    // through /api/quarry, which checks staff and then uses the service key.
    const { data: relData } = await supabase
      .from('work_log_released')
      .select('*')
      .order('release_at', { ascending: false })
      .limit(50);
    setReleased(relData ?? []);
    const { data: cfg } = await supabase.from('site_config').select('config').eq('id', 1).single();
    if (cfg?.config) setConfig((c: any) => ({ ...c, ...cfg.config }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(entry: any) {
    const supabase = createClient();
    // Idempotent: if this raw entry was already approved, do nothing.
    const { data: existing } = await supabase
      .from('work_log_released')
      .select('id')
      .eq('raw_id', entry.id)
      .limit(1);
    if (existing && existing.length) {
      setMsg('Already approved.');
      return;
    }
    const { error } = await supabase.from('work_log_released').insert({
      project_id: entry.project_id,
      raw_id: entry.id,
      title: (entry.body ?? '').slice(0, 120),
      note: '',
      release_at: new Date().toISOString(),
      visible: true,
    });
    if (!error) load();
    else setMsg(error.message);
  }

  async function toggleVisible(r: any) {
    const supabase = createClient();
    const { error } = await supabase
      .from('work_log_released')
      .update({ visible: !r.visible })
      .eq('id', r.id);
    if (!error) load();
  }

  async function sync() {
    setMsg('Syncing from Notion…');
    const res = await fetch('/api/notion-sync', { method: 'POST' });
    const j = await res.json();
    setMsg(res.ok ? `Pulled ${j.pulled} entries into the Quarry.` : `Sync error: ${j.error}`);
    load();
  }

  function toggleProject(name: string) {
    const set = new Set<string>(config.public_projects ?? []);
    set.has(name) ? set.delete(name) : set.add(name);
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
          <button className="ri live sel">
            <span className="st" /> {project?.name ?? 'No project yet'}
          </button>
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
            <span className="pill">
              <span className="sdot" /> live
            </span>
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

          {tab === 'curation' && <Curation />}

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
                    <small>Toggle which of the five show on the site.</small>
                  </span>
                  <div className="chips-edit">
                    {ALL_PROJECTS.map((name) => {
                      const on = (config.public_projects ?? []).includes(name);
                      return (
                        <button key={name} className={`pchip${on ? ' on' : ''}`} onClick={() => toggleProject(name)}>
                          {on ? '●' : '○'} {name}
                        </button>
                      );
                    })}
                  </div>
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
