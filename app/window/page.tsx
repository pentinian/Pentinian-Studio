import { createClient } from '@/lib/supabase/server';
import Log from './Log';

// Always read live from the database, never serve a cached snapshot of the Window.
export const dynamic = 'force-dynamic';

export default async function WindowPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Staff see a way across to the Atelier. Clients never learn it exists.
  const isAdmin = user?.app_metadata?.role === 'admin';

  // Their projects, not the first project in the table. This used to be .limit(1),
  // which happened to work only because there was one client. RLS would have caught
  // it, but relying on the database to save the interface from itself is not a plan.
  const { data: projects } = await supabase
    .from('projects')
    .select('id,name,phase,progress,status')
    .order('name');
  const project: any = projects?.[0] ?? null;

  const questions = project
    ? (
        await supabase
          .from('questions')
          .select('*')
          .eq('project_id', project.id)
          .eq('status', 'awaiting')
      ).data ?? []
    : [];

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
        <p className="sub">Here is where things stand on your build.</p>

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
          </div>
        </div>

        {questions.map((q: any) => (
          <div className="panel" key={q.id} style={{ marginBottom: 18 }}>
            <div className="qflag" style={{ margin: 16 }}>
              <div className="qh">◆ A question for you</div>
              <p>{q.body}</p>
              <div className="qs">
                <span className="sdot clay" /> Awaiting your approval before this thread continues.
              </div>
            </div>
          </div>
        ))}

        <div className="panel">
          <div className="ph">
            <h4>The work</h4>
            <span className="meta">Days worked, and the hours inside them</span>
          </div>
          <div style={{ padding: 16 }}>
            <Log projectId={project?.id ?? null} />
          </div>
        </div>

        <div className="req">
          <h4>Have a thought?</h4>
          <p>
            You can reply on any entry above, and it lands with me directly. For anything
            bigger than a note, say so there and we will find the time.
          </p>
        </div>
      </div>
    </>
  );
}
