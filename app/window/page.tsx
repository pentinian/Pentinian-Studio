import { createClient } from '@/lib/supabase/server';
import StudioHeader from '../StudioHeader';
import Log from './Log';

// Always read live from the database, never serve a cached snapshot of the Window.
export const dynamic = 'force-dynamic';

export default async function WindowPage({
  searchParams,
}: {
  searchParams?: { p?: string };
}) {
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

  // A client sees exactly one project here, so this is only ever a choice for staff,
  // who can see all of them and use this page to check what a client would read.
  // Without it the preview showed whichever project sorted first alphabetically,
  // which was somebody else's.
  const wanted = searchParams?.p;
  const project: any =
    (wanted && projects?.find((p: any) => p.id === wanted)) ?? projects?.[0] ?? null;

  // The questions panel used to render here. It said "Awaiting your approval before
  // this thread continues" above two buttons that did nothing, and no staff surface
  // ever raised a question, so the table has always been empty and the promise could
  // only ever have been false. Removed rather than softened: a client can now reply
  // on any entry, which is a real conversation, and that is where a question belongs
  // until there is a deliberate mechanism for one that blocks work.
  //
  // The questions and sessions tables are still in the schema, still under RLS, and
  // still unused. Left in place rather than dropped, because dropping a table is not
  // a decision to make in passing.

  return (
    <>
      <StudioHeader room="window" staff={isAdmin} email={user?.email ?? null}>
        {isAdmin && (projects?.length ?? 0) > 1 ? (
          // Staff only. A client has one project and no choice to make, so they get
          // the plain label rather than a control that does nothing.
          <form className="switch" method="get">
            <label htmlFor="p">Viewing as</label>
            <select id="p" name="p" defaultValue={project?.id} className="proj-pick">
              {projects!.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="submit" className="mini-btn">
              Open
            </button>
          </form>
        ) : (
          <span className="switch">
            Project: <b>{project?.name ?? 'Your project'}</b>
          </span>
        )}
      </StudioHeader>

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

        <div className="panel">
          <div className="ph">
            <h4>The work</h4>
            <span className="meta">Days work landed, and what each piece took</span>
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
