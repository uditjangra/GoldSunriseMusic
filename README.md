# Our Little Songbook 🎀

A private, two-person music site: you upload and edit albums & singles, she signs in and listens anytime. Changes you make show up on her screen instantly.

**Files**
- `index.html`, `styles.css`, `app.js` — the website
- `config.js` — where your two Supabase keys go
- `supabase-setup.sql` — creates the database, file storage and privacy rules

---

## 1. Create a free Supabase project (~5 min)

1. Go to **supabase.com** → sign up → **New project**. Pick any name, set a database password (save it somewhere), choose a region near you (e.g. Mumbai).
2. Wait a minute for it to finish setting up.

## 2. Run the setup script

1. Open `supabase-setup.sql` and change these two lines near the top:
   - `YOUR_EMAIL@example.com` → your email
   - `HER_EMAIL@example.com` → her email
2. In Supabase: left sidebar → **SQL Editor** → **New query** → paste the whole file → **Run**. You should see “Success. No rows returned”.

## 3. Create the two logins

1. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter your email + a password, tick **Auto Confirm User**, create.
3. Do the same for her email (pick a password you'll give her).
4. Then go to **Authentication** → **Sign In / Providers** and turn **off** “Allow new users to sign up”, so nobody else can make an account.

The emails here must match the ones in step 2 exactly.

## 4. Copy your keys into `config.js`

Left sidebar → **Project Settings** → **API** (sometimes called **Data API** / **API Keys**):
- **Project URL** → `supabaseUrl`
- **anon / publishable key** → `supabaseAnonKey`

(Never use the `service_role` / secret key here.)

## 5. Put it online

Any static host works: Vercel, Netlify, GitHub Pages. Easiest by hand: **app.netlify.com/drop** → drag the whole folder in → you get a link. Send her the link and her password; she stays signed in after the first time. On a phone she can use **Add to Home Screen** so it opens like an app.

---

## Using it

**As the singer (signed in with your email)** you'll see extra buttons:
- **Edit profile** — your name, bio, picture, who it's for, and a little note on the home page
- **+ New album / + New single** — title, description, date, color, cover art, and pick song files right away
- On an album: **Add songs** (pick several files at once), **Edit**, ↑ ↓ to reorder, ✎ on a song to change its title, add a little note or lyrics, replace the recording, or delete it

**As the listener (her)**: play, shuffle, repeat, read lyrics, and tap ♡ on songs she loves. You'll see her favorites on your home page.

## Good to know

- **Free plan limits:** 1 GB of files in total, max 50 MB per song. An MP3 is usually 3–10 MB, so that's roughly 100–300 songs.
- **Inactive projects get paused:** Supabase pauses free projects that get no requests for about a week. Her listening counts as activity. If it does pause, open the Supabase dashboard and click **Restore**.
- **Everything is private:** files sit in a private storage bucket, and the database only answers your two emails. The page itself can be opened by anyone with the link, but without a login it shows only the sign-in screen.
