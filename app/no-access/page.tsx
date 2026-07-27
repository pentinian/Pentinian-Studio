import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Shown when someone signed in reaches a staff-only route. It says only that the
// door is not theirs, never what is behind it.
export default async function NoAccessPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="eyebrow">Pentinian</div>
        <h1 className="auth-h">Not your door.</h1>
        <p className="auth-sub">
          {user?.email ? (
            <>
              You are signed in as <b>{user.email}</b>, and that account does not have studio
              access. Your own Window is still open.
            </>
          ) : (
            <>That page is for studio staff.</>
          )}
        </p>
        <div className="auth-form">
          <a className="btn-line" href="/window">
            Go to my Window &#8599;
          </a>
          <form action="/auth/signout" method="post">
            <button className="signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
