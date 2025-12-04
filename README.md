# St Joseph’s Infant School Calendar – Cloudflare Worker (ICS Proxy)

This project provides a Cloudflare Worker that converts the St Joseph’s Infant School calendar JSON API into a **standard iCalendar (`.ics`) feed** that can be subscribed to by any calendar app (Google Calendar, Apple Calendar, Outlook, etc.).

The Worker runs entirely on Cloudflare’s global edge network and requires **no backend server**.

---

## Overview

The Worker:

1. Accepts a request to `/calendar.ics`
2. Fetches the school’s calendar data in JSON format
3. Converts the events to an iCalendar v2.0 feed
4. Returns the `.ics` file with appropriate headers for calendar subscription

You can host it on your own Cloudflare Worker URL, then subscribe to:

```
https://<your-worker>.<subdomain>.workers.dev/calendar.ics
```

---

## Default Behaviour

If you **do not** specify any query parameters, the Worker automatically fetches a wide, stable date range:

- **Start** → first day of the **previous month**, UTC  
- **End** → first day of **11 months in the future**, UTC

This gives ~12 months of coverage, and importantly **does not shift daily**, only at the beginning of each month. This is ideal for subscription feeds.

---

## API Usage

### Endpoint

```
GET /calendar.ics
```

Returns a fully-formed ICS feed based on the specified or default date range.

Example:

```
https://your-worker.workers.dev/calendar.ics
```

---

## Query Parameters

The Worker supports optional parameters:

### `start` (optional)

Defines the start of the fetch window.

Accepted formats:
- `YYYY-MM-DD`
- Full ISO: `YYYY-MM-DDTHH:mm:ssZ` or anything valid for `new Date()`

Example:

```
?start=2025-12-01
```

If omitted, uses the **first day of last month (UTC)**.

---

### `end` (optional)

Defines the end of the fetch window.

Accepted formats match `start`.

Example:

```
?end=2026-01-12
```

If omitted, uses the **first day of 11 months in the future (UTC)**.

---

### Complete Example

Fetch events from Dec 1st 2025 to Jan 12th 2026:

```
https://your-worker.workers.dev/calendar.ics?start=2025-12-01&end=2026-01-12
```

---

## Output Format

The Worker returns:

- `Content-Type: text/calendar; charset=utf-8`
- Fully valid **iCalendar 2.0** format
- Includes:
  - `UID`
  - `DTSTAMP`
  - `DTSTART` / `DTEND` (date-only for all-day events)
  - `SUMMARY`
  - `DESCRIPTION`
  - `URL`
- Calendar clients can **subscribe** to it and automatically refresh it periodically.

---

## Deployment Instructions

### 1. Install Wrangler

Cloudflare’s CLI tool:

```sh
npm install -g wrangler
```

Log in:

```sh
wrangler login
```

---

### 2. Project Structure

Example:

```
/project
  worker.js
  wrangler.toml
```

Your `wrangler.toml` should look like:

```toml
name = "stjosephs-calendar-ics"
main = "worker.js"
compatibility_date = "2025-12-03"
```

(Some arbitrary recent date is fine.)

---

### 3. Develop Locally

You can run the Worker locally using:

```sh
wrangler dev
```

Then open:

```
http://127.0.0.1:8787/calendar.ics
```

---

### 4. Deploy to Cloudflare

Deploy the Worker globally:

```sh
wrangler deploy
```

You will receive a URL like:

```
https://stjosephs-calendar-ics.<yourname>.workers.dev/calendar.ics
```

Use that URL in your calendar app to subscribe.

---

## Using the ICS Feed in Calendar Applications

### Google Calendar
1. Open Google Calendar  
2. “Other Calendars” → “From URL”  
3. Paste your Worker URL  

### Apple Calendar
1. File → New Calendar Subscription  
2. Paste the URL  

### Outlook
1. Add Calendar → “Subscribe from Web”  
2. Paste the URL  
