import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// The hallway. Nobody stays here, it just reads who you are and opens the right door.
//
// Passkey sign-in lands here on purpose. The authenticator resolves the account
// itself, so the page never asks for an email and cannot know the role until the
// session already exists.
export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');
  redirect(user.app_metadata?.role === 'admin' ? '/atelier' : '/window');
}
