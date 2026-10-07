# Daybook – setup guide

Daybook is your personal and work planner as a free website you own. It runs on **GitHub Pages** (free hosting) and keeps your data in your own **Supabase** project (free database). It does not use Claude or any paid service.

- **Cost:** ₹0. Both free plans are enough for one person (500 MB database, 1 GB files).
- **Privacy:** the website's code is public (that's how free GitHub Pages works), but your data is not. Only your signed-in account can read it, and new sign-ups are switched off.
- **Time:** about 30 minutes, once.

You'll need: a computer with Chrome or Edge, your iPhone, and an email address.

---

## Part A — Create your database (Supabase, ~10 min)

1. Go to **supabase.com** → **Start your project** → sign up with your email.
2. Click **New project**.
   - Name: `daybook`
   - Database password: click **Generate**, then save it in your password manager (you won't need it day to day).
   - Region: **South Asia (Mumbai)**
   - Click **Create new project** and wait about 2 minutes.
3. In the left menu open **SQL Editor** → **New query**. Open the file `supabase/setup.sql` from this folder in Notepad, copy everything, paste it in, and click **Run**. You should see *Success. No rows returned*.
4. Left menu → **Authentication** → **Users** → **Add user** → **Create new user**. Enter your email and a strong password, tick **Auto Confirm User**, and create it. This is the login you'll use in Daybook.
5. Still in Authentication, open **Sign In / Providers** (on some dashboards: **Settings**) and turn **off** “Allow new users to sign up”. Save. Now nobody else can create an account on your database.
6. Left menu → **Project Settings** → **API Keys** (or **API**). Copy two things into a note:
   - **Project URL**, e.g. `https://abcd1234.supabase.co`
   - **Publishable key** (`sb_publishable_…`), or on older projects the **anon public** key (long `eyJ…` text).
   - Never use the **secret** / **service_role** key in Daybook.
7. Calendar reminders function:
   - Left menu → **Edge Functions** → **Deploy a new function** → **Via Editor**.
   - Name it exactly `calendar`.
   - Delete the sample code. Open `supabase/functions/calendar/index.ts` from this folder in Notepad, copy everything and paste it in. Click **Deploy**.
   - Open the function's **Details / Settings** and switch **off** “Verify JWT” (may be called “Enforce JWT verification”). Save. Calendar apps can't sign in, so the long secret link protects your data instead.

## Part B — Publish the website (GitHub, ~10 min)

1. Go to **github.com/signup** and create a free account. Verify your email.
2. Top right **+** → **New repository**.
   - Name: `daybook`
   - Choose **Public** (free GitHub Pages needs a public repository; your data is not stored there).
   - Click **Create repository**.
3. On the new repository page click **uploading an existing file**. Unzip `daybook.zip` on your PC, open the folder, select **everything inside it** (including the `.github` folder, `.nojekyll` and the `icons`, `vendor` and `supabase` folders) and drag it onto the page. Click **Commit changes**.
4. Repository **Settings** → **Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
5. After 1–2 minutes the page shows your site address, for example `https://yourname.github.io/daybook/`. Bookmark it.
6. (Recommended) Save your keys so each device skips the connect screen: in the repository open `config.js` → pencil icon → paste your Project URL and publishable key between the quotes → **Commit changes**.

### Keep the free database awake (recommended)

Free Supabase projects pause after a week without use. If you use Daybook daily, or your iPhone calendar is subscribed, this rarely matters. To be safe:

1. Repository **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_KEY` = your publishable key
2. Open the **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
3. Open **Keep database awake** → **Run workflow** once to test it. It then runs every 3 days.

If the project ever does pause, open supabase.com → your project → **Restore**. Nothing is lost.

## Part C — Set up your devices

**Windows PC**
1. Open your site in **Edge** or **Chrome**.
2. If asked, paste the Project URL and key, then sign in with the email and password from step A4.
3. Install it as an app: click the **Install** icon at the right of the address bar (Edge: *App available*). Daybook then opens in its own window and can be pinned to the taskbar.

**iPhone**
1. Open your site in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Daybook from the home screen icon** (not Safari) and sign in. The home-screen app keeps its own sign-in, so if you didn't fill in `config.js` you'll enter the URL and key once here too.

**Real reminders (iPhone Calendar alerts)**
1. In Daybook open **Calendar → Reminders** → **Create my calendar link** → **Test link**. It should say *Worked*.
2. Tap **Copy link**.
3. On the iPhone: **Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar**. Paste the link → **Next** → **Save**.
4. Settings → Calendar → Accounts → **Fetch New Data** → set **Fetch** to **Every 15 Minutes**.
5. Back in Daybook, tick **iPhone Calendar** under *Where have you subscribed?* Reminders now show **Scheduled**.

What appears in your calendar: open task deadlines (with your reminder as the alert), appointments and repeating events, habit reminders, bills (alert at 9:00 am on the due day), document expiry and renewal (alert 7 days before) and project deadlines. The calendar is read-only; edit things in Daybook. Changes reach the phone at its next refresh, so set reminders at least 15–30 minutes ahead.

Outlook can subscribe to the same link (Calendar → Add calendar → Subscribe from web), but Outlook only refreshes every few hours. Use it to see the schedule and rely on the iPhone for alerts.

---

## Daily use

- **Quick add** (the + button): type naturally, e.g. `Call bank tmrw 4pm #work !high`, `250 lunch`, `2 kg rice`. Check what it understood, then press Enter.
- **Top 3:** star up to three tasks each morning.
- **Habits:** one tap = done, again = skipped, again = clear.
- **Shopping:** Home → Shopping mode, then **Finish trip** to keep prices in history.
- **Weekly:** Reviews & Analytics shows recorded facts and simple suggestions.
- The **All / Personal / Work** switch filters every section.
- Works offline: changes are kept on the device and sync when you're back online. The top-right indicator shows Synced, Saving…, Offline · N waiting or Save failed.

## Backup and restore

- **Back up:** Settings → **Download full backup (JSON)**. On iPhone this opens the share sheet; choose *Save to Files*. Doing this once a month is a good habit.
- **Restore:** Settings → **Restore from backup…** → choose the file → check the summary → **Import**. Restoring merges and never deletes; links between records are kept.
- **Moving from the Claude version:** download a backup there (Settings → Download full backup) and restore it here. The format is the same.
- Uploaded files live in Supabase Storage → `files` bucket and are not inside the JSON backup.
- **CSV exports** for tasks, expenses, bills, grocery purchases, habit log, goals and documents are in Settings.

## Updating Daybook later

Replace the changed files in your GitHub repository (Add file → Upload files → Commit). The site updates within a couple of minutes. Your data is untouched because it lives in Supabase.

## Troubleshooting

| Problem | Fix |
|---|---|
| “Email or password is wrong” | Use the user from step A4. Reset it in Supabase → Authentication → Users. |
| “Can't reach your database” | Check the Project URL; the project may be paused (Supabase → Restore). |
| Calendar test says *asking for sign-in* | Turn off Verify JWT for the `calendar` function (step A7). |
| Calendar test says *not found* | Function must be named exactly `calendar`; wait a minute after creating the link. |
| A reminder didn't alert | Check iPhone Settings → Calendar → Accounts → Fetch New Data is every 15 minutes and Calendar notifications are allowed. |
| Link leaked | Calendar → Reminders → **Make a new link**, then re-subscribe. |
| Sign out of a lost device | Supabase → Authentication → Users → your user → **Sign out all sessions** (or change the password). |
