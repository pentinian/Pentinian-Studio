# Getting off the built-in email service

## Why this is not optional

Supabase's built-in email sender allows **two emails per hour across the entire
project**. Not per person. Not per address. Two.

It is the one rate limit that cannot be raised in the dashboard, because it exists to
stop people using Supabase as a mail relay. The only way past it is to bring your own
sender.

That ceiling already locked Pen out once. The part that matters more: it is shared by
everyone. Three clients signing in during the same hour means the third one is refused,
sees an error they cannot act on, and has no way in. **The Window cannot open to real
clients until this is done.**

Passkeys reduce how often anyone needs an email, but they do not remove the need. A
client's very first sign-in is always a link, and a passkey is bound to one device, so
a new laptop means another link.

## What you are setting up

Resend, sending from your own domain. Fifteen minutes, and about ten of those are DNS
propagation. Free tier covers 3,000 emails a month, which is far past what invite-only
access will ever use.

Doing this after you buy `pentinian.com` is easier, because the domain verification and
the DNS records happen in one sitting.

## Steps

**1. Create the sender.** Sign up at [resend.com](https://resend.com), add
`pentinian.com` as a domain, and Resend shows you three DNS records: a DKIM `TXT`, an
SPF `TXT`, and usually a `MX` for bounce handling. Add them at whatever registrar holds
the domain. Verification typically lands within ten minutes.

**2. Make an API key.** In Resend, API Keys, create one with **Sending access** only.
Not full access. It is going into a third-party settings page, so it should be able to
send mail and nothing else.

**3. Point Supabase at it.** Dashboard, Authentication, Emails, SMTP Settings. Enable
custom SMTP and fill in:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key |
| Sender email | `hello@pentinian.com` |
| Sender name | `Pentinian` |

Port 465 is implicit TLS. If your host blocks it, 587 works too and upgrades with
STARTTLS.

**4. Raise the limits that were being held down.** Authentication, Rate Limits. With a
custom sender the email cap is yours to set. Sensible for invite-only access:

- Emails sent per hour: **30**
- OTP requests per hour: **60**
- Minimum time between requests to the same address: leave at 60 seconds

Thirty an hour is generous for a studio with a handful of clients and still low enough
that a mistake in a loop cannot mail thousands of people before you notice.

**5. Check it.** Sign out, request a link, and confirm it arrives from your own domain
rather than `noreply@mail.app.supabase.io`. Then send a second one a minute later, which
under the old ceiling would have been your last of the hour.

## While you are in there

Authentication, Emails, Templates. The default magic-link email is Supabase's, not
yours: it says "Magic Link" and "Follow this link to login". A client's first impression
of the Window is that email. Worth rewriting in your own voice, and the only required
part is keeping `{{ .ConfirmationURL }}` intact.

## The escape hatch

If you are ever locked out again, this does not need email at all:

```
cd ~/Downloads/Pentinian-Studio
set -a; source .env.local; set +a
node scripts/sign-in-link.mjs you@example.com
```

It mints the same link through the admin API, so nothing is sent and nothing is counted.
The line it prints is a live credential: terminal only, single use, and treat it exactly
as you would treat the email.
