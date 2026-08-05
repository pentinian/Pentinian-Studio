'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ConsoleDesk from './ConsoleDesk';
import Curation from './Curation';
import Studies from './Studies';
import Health from './Health';
import HomePage from './HomePage';
import Passkeys from './Passkeys';
import Correspondence from './Correspondence';
import People from './People';
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
  id: string; name: string; phase: string | null; progress: number | null;
  client_facing: boolean; linked: boolean;
  client: { name: string; has_login: boolean } | null;
  quarry: number; released: number; held: number;
};

export default function AtelierPage() {
  const [tab, setTab] = useState<'curation' | 'console' | 'replies' | 'site' | 'access' | 'home' | 'post' | 'studies'>('curation');
  // Two domains, not one list. Editing the public site is not managing a client's build,
  // and putting both in the same rail meant every project row sat next to two controls
  // that had nothing to do with any project.
  const [domain, setDomain] = useState<'studio' | 'project'>('project');
  const [waiting, setWaiting] = useState(0);
  const [knocking, setKnocking] = useState(0);
  // Letters that have arrived and nobody has opened. Distinct from `waiting`, which
  // counts clients waiting on an answer inside their own Window.
  const [letters, setLetters] = useState(0);
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
  // The two lines a client reads above everything else. Held as a draft so a half
  // typed phase is not saved on every keystroke.
  const [head, setHead] = useState<{ phase: string; progress: string } | null>(null);

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

  /* Letters arrive while you are looking at something else, and a letter nobody knows
     about is the same as a letter that did not arrive. So the count is fetched on
     arrival and kept current, and the moment it goes up the studio says so out loud
     rather than waiting to be asked.
     Only while the tab is actually in front of someone: polling a hidden tab spends
     someone's battery to tell nobody anything. */
  const [landed, setLanded] = useState(0);
  useEffect(() => {
    let alive = true;
    let last: number | null = null;

    async function look(force = false) {
      // The first look always happens. Skipping it in a tab that opened in the
      // background would mean no badge at all until something else woke it, and the
      // number of letters waiting is true whether or not anyone is watching.
      if (!force && document.hidden) return;
      try {
        const r = await fetch('/api/mail', { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const n = (await r.json()).waiting ?? 0;
        // First look only learns the number. Announcing on arrival would announce
        // every letter already sitting there as though it had just come in.
        if (last !== null && n > last) setLanded(n - last);
        last = n;
        setLetters(n);
      } catch {}
    }

    look(true);
    const id = setInterval(() => look(), 60000);
    const onShow = () => look();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);

  // Said once, then gone. A notice that has to be dismissed is a chore.
  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => setLanded(0), 9000);
    return () => clearTimeout(t);
  }, [landed]);

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

  /* What the client sees at the top of their own Window.
   *
   * Both stay empty until said, because empty and zero are different claims: empty is
   * nobody has put a number on it, zero is none of it is done. The Window shows the
   * hours actually released when there is no percentage, which is a fact rather than
   * an estimate, so leaving this alone is a reasonable thing to do rather than a gap. */
  async function saveHead() {
    if (!project || !head) return;
    setMsg('');
    const res = await fetch('/api/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project.id, phase: head.phase, progress: head.progress === '' ? null : head.progress }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(j.error ?? 'That did not save.');
    setMsg('Saved. That is what they read at the top of their Window.');
    setHead(null);
    load();
  }

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

      {/* A letter has arrived. Says so where you are, and takes you to it. */}
      {landed > 0 && (
        <button
          className="post-toast"
          onClick={() => { setDomain('studio'); setTab('post'); setLanded(0); }}
        >
          <i />
          {landed === 1 ? 'A letter just arrived' : `${landed} letters just arrived`}
          <span>Read it</span>
        </button>
      )}

      <div className="wr-shell">
        <div className="rail">
          <div className="rl-label">Pentinian</div>
          {([
            ['home', 'Home page'],
            ['studies', 'Case studies'],
            ['site', 'Site calibration'],
            ['post', 'Correspondence'],
            ['access', 'Access'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              className={'ri' + (domain === 'studio' && tab === k ? ' sel' : '')}
              onClick={() => { setDomain('studio'); setTab(k); }}
            >
              <span className="st" style={{ background: 'transparent' }} />
              <span className="ri-name">{label}</span>
              {/* The knock is audible from the rail, not only once the tab is open. */}
              {k === 'post' && letters > 0 && <span className="ri-n">{letters}</span>}
              {k === 'access' && knocking > 0 && <span className="ri-n">{knocking}</span>}
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
                if (tab === 'site' || tab === 'access' || tab === 'home' || tab === 'post' || tab === 'studies') setTab('curation');
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
                <button className={tab === 'studies' ? 'on' : ''} onClick={() => setTab('studies')}>
                  Case studies
                </button>
                <button className={tab === 'site' ? 'on' : ''} onClick={() => setTab('site')}>
                  Site calibration
                </button>
                <button className={tab === 'post' ? 'on' : ''} onClick={() => setTab('post')}>
                  Correspondence
                  {letters > 0 && <span className="tab-n">{letters}</span>}
                </button>
                <button className={tab === 'access' ? 'on' : ''} onClick={() => setTab('access')}>
                  Access
                  {knocking > 0 && <span className="tab-n">{knocking}</span>}
                </button>
              </>
            )}
          </div>

          {/* Only where it applies: an internal project has no Window to write a
              heading for. */}
          {domain === 'project' && project?.client_facing && (
            <div className="hd-strip">
              <span className="hd-l">What they read at the top</span>
              <input
                className="hd-phase"
                placeholder="Where it is up to, in their words"
                maxLength={80}
                value={head?.phase ?? project.phase ?? ''}
                onChange={(e) =>
                  setHead((h) => ({ progress: h?.progress ?? (project.progress ?? '').toString(), phase: e.target.value }))
                }
              />
              <input
                className="hd-pct"
                type="number"
                min={0}
                max={100}
                placeholder="%"
                value={head?.progress ?? (project.progress ?? '').toString()}
                onChange={(e) =>
                  setHead((h) => ({ phase: h?.phase ?? project.phase ?? '', progress: e.target.value }))
                }
              />
              <span className="hd-h">
                {head?.progress || project.progress != null
                  ? 'A ring at that percentage'
                  : 'Left empty, they see the hours released instead'}
              </span>
              {head && (
                <button className="mini-btn pri" onClick={saveHead}>Save</button>
              )}
              {head && (
                <button className="mini-btn" onClick={() => setHead(null)}>Discard</button>
              )}
            </div>
          )}

          {msg && <p style={{ fontSize: 12.5, color: 'var(--sage-deep)', margin: '0 0 14px' }}>{msg}</p>}

          {tab === 'curation' && (
            <Curation projectId={selId} projectName={project?.name ?? null} refreshKey={refreshKey} />
          )}

          {tab === 'console' && (
            <ConsoleDesk projectId={selId} projectName={project?.name ?? null} refreshKey={refreshKey} />
          )}

          {tab === 'replies' && <Replies />}

          {tab === 'home' && <HomePage />}

          {tab === 'studies' && <Studies />}

          {tab === 'post' && domain === 'studio' && <Correspondence onWaiting={setLetters} />}
          {tab === 'access' && (
            <>
              {/* The door, in one place: who is asking, who is already through, and
                  the studio's own way in. */}
              <WantsIn onCount={setKnocking} />
              <People />
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
