# UI Backlog

Items specific to the dashboard and reporting interface.

---

## High Priority

- [ ] **Disable Run Scraper button while scraper is running** — the button currently optimistically disables for 2 seconds then re-enables, regardless of actual scraper state; a `GET /api/scrape/status` endpoint should report whether a run is in progress, and the sidebar button should poll it and remain disabled (with a spinner and "Running…" label) until the job completes; the alert count badge should refresh automatically when the run finishes

---

## Medium Priority

*(none yet)*

---

## Low Priority

*(none yet)*
