'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ConsoleDesk from './ConsoleDesk';
import Curation from './Curation';
import Health from './Health';
import HomePage from './HomePage';
import Passkeys from './Passkeys';
import WantsIn from './WantsIn';
import Replies from './Replies';
import StudioHeader from '../StudioHeader';

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
  const [tab, setTab] = useState<'curation' | 'console' | 'replies' | 'site' | 'access' | 'home'>('curation');
  // Two domains, not one list. Editing the public site is not managing a client's build,
  // and putting both in the same rail meant every project row sat next to two controls
  // that had nothing to do with any project.
  const [domain, setDomain] = useState<'studio' | 'project'>('project');
  const [waiting, setWaiting] = useState(0);
  const [knocking, setKnocking] = useState(0);
  const [projects, setProjects] = useState<Proj[]>([]);
  const [orphaned, setOrphaned] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [config, setConfig] = useState<any>({
    open_for_work: true,
    availability: 'One slot, Q3',
    public_projects: SITE_CARDS.map((c) => c.key),
  });
  const [msg, setMsg] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  // Bumped after a sync so the queue below reloads with it, rather than reporting a
  // pull that the list it sits above never reflects.
  const [refreshKey, setRefreshKey] = useState(0);

  const project = projects.find((p) => p.id === selId) ?? null;

  // A badge that only appears after its tab has been opened is not a badge. Count the
  // people at the door on arrival, from anywhere in the Atelier; WantsIn keeps the
  // number honest once the tab itself is open.
  useEffect(() => {
    fetch('/api/access-request', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setKnocking(j.waiting ?? 0))
      .catch(() => {});
  }, []);

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
      // Open on whatever has the most waiting for you, not on whatever sorts first.
      // Alphabetical order put an empty project in front of the one with six entries
      // in it, so the Atelier opened on nothing at all.
      setSelId((cur) => {
        if (cur) return cur;
        const busiest = [...(d.projects ?? [])].sort((a: Proj, b: Proj) => b.quarry - a.quarry)[0];
        return busiest?.id ?? null;
      });
    }
    // The count sits on the tab so an unanswered client is visible from anywhere in
    // the Atelier, rather than only once you think to go and look.
    const rep = await fetch('/api/comments', { cache: 'no-store' });
    if (rep.ok) setWaiting((await rep.json()).waiting ?? 0);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setEmail(user?.email ?? null);
    setName((user?.user_metadata?.name as string) ?? null);
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
    setMsg(
      res.ok
        ? `Pulled ${j.pulled} entries into the Quarry.` +
            (j.unmatchedProjects?.length
              ? ` ${j.unmatchedProjects.length} named a project that does not exist here, so those cannot reach anyone: ${j.unmatchedProjects.join(', ')}.`
              : '') +
            (j.console
              ? ` ${j.console.pulled} console item${j.console.pulled === 1 ? '' : 's'}, staged.` +
                (j.console.skipped > 0 ? ` ${j.console.skipped} had no project and went nowhere.` : '') +
                (j.console.skipped === -1 ? ' The Console database could not be read: check NOTION_CONSOLE_DB and that it is shared with the integration.' : '') +
                (j.console.error ? ` Console write failed: ${j.console.error}` : '')
              : '')
        : `Sync error: ${j.error}`
    );
    load();
    setRefreshKey((n) => n + 1);
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
      {/* Same header the Window uses, so the two read as rooms rather than products. */}
      <StudioHeader room="atelier" staff email={email} name={name}>
        <button className="mini-btn pri" onClick={sync} style={{ marginLeft: 'auto' }}>
          Sync Notion
        </button>
      </StudioHeader>

      <div className="wr-shell">
        <div className="rail">
          <div className="rl-label">Pentinian</div>
          {([
            ['home', 'Home page'],
            ['site', 'Site calibration'],
            ['access', 'Access'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              className={'ri' + (domain === 'studio' && tab === k ? ' sel' : '')}
              onClick={() => { setDomain('studio'); setTab(k); }}
            >
              <span className="st" style={{ background: 'transparent' }} />
              <span className="ri-name">{label}</span>
            </button>
          ))}

          <div className="rl-sec" />
          <div className="rl-label">Projects · The Spine</div>

          {projects.length === 0 && <p className="rl-none">No projects yet.</p>}

          {projects.map((p) => (
            <button
              key={p.id}
              className={'ri' + (p.client_facing ? ' live' : '') + (p.id === selId ? ' sel' : '')}
              onClick={() => {
                setSelId(p.id);
                setDomain('project');
                if (tab === 'site' || tab === 'access' || tab === 'home') setTab('curation');
              }}
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
          {/* Above everything, because a failure nobody is looking for has to be in the
              way of what they are looking at. Quiet when things are fine. */}
          <Health />

          <div className="wr-h">
            <h2>{domain === 'studio' ? 'Pentinian' : project?.name ?? 'Atelier'}</h2>
            {domain === 'studio' && (
              <span className="wr-sub">The public site, and who can get in</span>
            )}
            {domain === 'project' && project && (
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

          {/* The tabs belong to whichever domain is open. Showing a project's Curation
              beside the site's Access meant five tabs of which two were about something
              else entirely. */}
          <div className="tabs">
            {domain === 'project' ? (
              <>
                <button className={tab === 'curation' ? 'on' : ''} onClick={() => setTab('curation')}>
                  Curation
                </button>
                <button className={tab === 'console' ? 'on' : ''} onClick={() => setTab('console')}>
                  Console
                </button>
                <button className={tab === 'replies' ? 'on' : ''} onClick={() => setTab('replies')}>
                  Replies
                  {waiting > 0 && <span className="tab-n">{waiting}</span>}
                </button>
              </>
            ) : (
              <>
                <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>
                  Home page
                </button>
                <button className={tab === 'site' ? 'on' : ''} onClick={() => setTab('site')}>
                  Site calibration
                </button>
                <button className={tab === 'access' ? 'on' : ''} onClick={() => setTab('access')}>
                  Access
                  {knocking > 0 && <span className="tab-n">{knocking}</span>}
                </button>
              </>
            )}
          </div>

          {msg && <p style={{ fontSize: 12.5, color: 'var(--sage-deep)', margin: '0 0 14px' }}>{msg}</p>}

          {tab === 'curation' && (
            <Curation projectId={selId} projectName={project?.name ?? null} refreshKey={refreshKey} />
          )}

          {tab === 'console' && (
            <ConsoleDesk projectId={selId} projectName={project?.name ?? null} refreshKey={refreshKey} />
          )}

          {tab === 'replies' && <Replies />}

          {tab === 'home' && <HomePage />}

          {tab === 'access' && (
            <>
              <WantsIn onCount={setKnocking} />
              <Passkeys />
            </>
          )}

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
