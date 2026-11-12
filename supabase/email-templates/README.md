# Supabase email templates

Paste each file into Supabase -> Authentication -> Emails -> Templates.

| Supabase template | File | Suggested subject |
|---|---|---|
| Invite user | invite.html | You're invited to join HireNest |
| Confirm sign up | confirm-signup.html | Confirm your HireNest email |
| Reset password | reset-password.html | Reset your HireNest password |
| Magic link | magic-link.html | Your secure HireNest sign-in link |

All use `{{ .ConfirmationURL }}` (Supabase fills it in).
