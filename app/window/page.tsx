import { createClient } from '@/lib/supabase/server';
import Body from './Body';

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
  const wanted = searchParams?.p;
  const project: any =
    (wanted && projects?.find((p: any) => p.id === wanted)) ?? projects?.[0] ?? null;

  // The questions panel used to render here, saying work was awaiting approval above
  // buttons that did nothing. Removed: a client can now reply on any entry and raise a
  // request from the header, which are real. The questions and sessions tables remain
  // in the schema under RLS, unused, because dropping a table is not a decision to
  // make in passing.

  return (
    <Body
      project={project}
      projects={(projects as any[]) ?? []}
      isAdmin={isAdmin}
      email={user?.email ?? null}
      name={(user?.user_metadata?.name as string) ?? null}
    />
  );
}
