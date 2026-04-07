# Agenda app (Presenter & Attendee)

Single-page web app: upload an Excel agenda with **topic + duration only**, set the **first session start** and **presenter timezone**. Attendees choose their timezone and see **session start/end times** in local time, grouped by **calendar day** (multi-day).

## Run locally

```bash
cd agenda-app
python3 -m http.server 8080
```

Open `http://localhost:8080/index.html`.

> Use a local server so browser APIs work reliably; opening `index.html` as `file://` may block modules or storage in some browsers.

## Deploy on GitHub Pages (project site / subdirectory)

The app uses **relative** asset URLs and **hash** routing (`#/attendee`, `#/presenter`), so it works at a project URL such as `https://<user>.github.io/<repository>/` without extra configuration.

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment**: set **Source** to **GitHub Actions**.
3. Push to `main` (or `master`) or run the workflow manually — the workflow in `.github/workflows/deploy-pages.yml` publishes `index.html`, `app.js`, `styles.css`, and `.nojekyll`.

The empty `.nojekyll` file disables Jekyll so static files are served as-is.

## Excel format

| Column A (topic) | Column B (duration) |
|------------------|---------------------|
| Welcome          | 30                  |
| Keynote          | 45                  |

- First row can be a header like `Topic` / `Duration` (auto-detected).
- Durations are **minutes** (integer or decimal).

## Presenter flow

1. Open **Presenter** view.
2. In the dialog: choose `.xlsx` / `.xls`, **date** and **time** of the first session, and **your timezone**.
3. **Save & build agenda** – schedule is stored in `localStorage`.
4. Optional: **Download agenda.json** and share with attendees on other devices.

## Attendee flow

1. Open **Attendee** view.
2. Choose **your timezone** in the dialog → **Show agenda**.
3. **Change timezone** reopens the dialog.

## Same browser vs other devices

- **Same browser:** Presenter save is visible to Attendee automatically (`localStorage`).

## Stack

- [SheetJS (xlsx)](https://sheetjs.com/) – Excel parsing  
- [Luxon](https://moment.github.io/luxon/) – dates and IANA timezones  

## Files

- `index.html` – UI + hash routes `#/attendee`, `#/presenter`
- `app.js` – logic
- `styles.css` – styles
