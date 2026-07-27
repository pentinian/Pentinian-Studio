import { createClient } from '@/lib/supabase/server';

// Always read live from the database, never serve a cached snapshot of the Window.
export const dynamic = 'force-dynamic';

function fmtDate(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default async function WindowPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Staff see a way across to the Atelier. Clients never learn it exists.
  const isAdmin = user?.app_metadata?.role === 'admin';

  // Scaffold: load the first project. In production, map the signed-in user to their project
  // via the clients table (clients.user_id = user.id) and filter by that client's project.
  const { data: projects } = await supabase.from('projects').select('*').limit(1);
  const project: any = projects?.[0] ?? null;

  let released: any[] = [];
  let sessions: any[] = [];
  let questions: any[] = [];

  if (project) {
    const nowIso = new Date().toISOString();
    released =
      (
        await supabase
          .from('work_log_released')
          .select('*')
          .eq('project_id', project.id)
          .eq('visible', true)
          .lte('release_at', nowIso)
          .order('release_at', { ascending: false })
      ).data ?? [];
    sessions =
      (
        await supabase
          .from('sessions')
          .select('*')
          .eq('project_id', project.id)
          .eq('visible', true)
          .order('started_at', { ascending: false })
      ).data ?? [];
    questions =
      (
        await supabase
          .from('questions')
          .select('*')
          .eq('project_id', project.id)
          .eq('status', 'awaiting')
      ).data ?? [];
  }

  const initials = (user?.email ?? 'C').slice(0, 2).toUpperCase();

  return (
    <>
      <div className="topbar">
        <span className="brand">
          <svg viewBox="0 0 32 32" fill="none">
            <g stroke="#7E9270" strokeWidth="1.5">
              <circle cx="16" cy="16" r="10" />
              <circle cx="16" cy="16" r="5.5" />
            </g>
            <circle cx="16" cy="16" r="1.8" fill="#B0805C" />
          </svg>
          Pentinian · Window
        </span>
        <span className="switch">
          Project: <b>{project?.name ?? 'Your project'}</b>
        </span>
        <span className="tb-right">
          {isAdmin && (
            <a className="tb-switch" href="/atelier" title="Studio access">
              Atelier &#8599;
            </a>
          )}
          <span>{user?.email}</span>
          <span className="ava">{initials}</span>
          <form action="/auth/signout" method="post">
            <button className="signout" type="submit">
              Sign out
            </button>
          </form>
        </span>
      </div>

      <div className="body">
        <h2 className="hello">Welcome back.</h2>
        <p className="sub">Here's where things stand on your build.</p>

        <div className="pj-head">
          <div className="ring" style={{ ['--p' as any]: project?.progress ?? 0 }}>
            <b>{project?.progress ?? 0}%</b>
          </div>
          <div className="pj-info">
            <h3>
              {project?.name ?? 'Your project'}
              <span className="pill">
                <span className="sdot" /> {project?.status === 'on_track' ? 'On track' : 'In progress'}
              </span>
            </h3>
            <p className="phase">{project?.phase ?? 'Getting started'}</p>
            <div className="pj-stats">
              <div>
                <div className="k">Updates</div>
                <div className="v">{released.length}</div>
              </div>
              <div>
                <div className="k">Sessions</div>
                <div className="v">{sessions.length}</div>
              </div>
              <div>
                <div className="k">Open questions</div>
                <div className="v">{questions.length}</div>
              </div>
            </div>
          </div>
        </div>

        {questions.map((q) => (
          <div className="panel" key={q.id} style={{ marginBottom: 18 }}>
            <div className="qflag" style={{ margin: 16 }}>
              <div className="qh">
                ◆ A question for you <time>{fmtDate(q.raised_at)}</time>
              </div>
              <p>{q.body}</p>
              <div className="qs">
                <span className="sdot clay" /> Awaiting your approval before this thread continues.
              </div>
              <div className="qa">
                <button className="btn-line sage">Approve, continue</button>
                <button className="mini-btn">Suggest a change</button>
              </div>
            </div>
          </div>
        ))}

        <div className="row-2">
          <div className="panel">
            <div className="ph">
              <h4>Progress log</h4>
              <span className="meta">What you can see</span>
            </div>
            {released.length ? (
              <div className="timeline">
                {released.map((r) => (
                  <div className="tl" key={r.id}>
                    <time>{fmtDate(r.release_at)}</time>
                    <div>
                      <h5>{r.title}</h5>
                      {r.note && <p>{r.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">Nothing released yet. New progress shows up here as it's ready.</div>
            )}
          </div>

          <div>
            <div className="panel">
              <div className="ph">
                <h4>Working Sessions</h4>
                <span className="meta">Hours</span>
              </div>
              {sessions.length ? (
                sessions.map((s) => (
                  <div className="sess" key={s.id}>
                    <div className="when">
                      <div className="date">{fmtDate(s.started_at)}</div>
                      <span className="dur">
                        {Math.floor((s.minutes ?? 0) / 60)}h {(s.minutes ?? 0) % 60}m
                      </span>
                    </div>
                    <div className="what">
                      <h5>{s.label ?? 'Session'}</h5>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">No sessions shared yet.</div>
              )}
            </div>

            <div className="req">
              <h4>Have a thought?</h4>
              <p>Want to adjust or add something? Send it over and I'll review it against our plan.</p>
              <button className="btn-line sage">Request an adjustment</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
