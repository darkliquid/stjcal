export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Simple "hello" at root, ICS at /calendar.ics
    if (url.pathname === "/") {
      return new Response(
        "St Joseph's Infant Calendar ICS proxy\n\nUse /calendar.ics",
        { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    if (url.pathname !== "/calendar.ics") {
      return new Response("Not found", { status: 404 });
    }

    let start, end;
    try {
      ({ start, end } = deriveDateRange(url.searchParams));
    } catch (e) {
      return new Response("Invalid date range: " + e.message, {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const apiUrl = buildRemoteUrl(start, end);

    const upstreamResp = await fetch(apiUrl);
    if (!upstreamResp.ok) {
      return new Response(
        `Failed to fetch remote calendar (status ${upstreamResp.status})`,
        { status: 502 }
      );
    }

    /** @type {any[]} */
    const events = await upstreamResp.json();

    const ics = buildICS(events);

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*", // nice-to-have
      },
    });
  },
};

/**
 * Derive start/end from query params or defaults.
 * Default:
 *   start = first day of (current month - 1), UTC
 *   end   = first day of (current month + 11), UTC
 */
function deriveDateRange(params) {
  const now = new Date();
  const startParam = params.get("start");
  const endParam = params.get("end");

  let start, end;

  if (startParam) {
    start = parseUserDate(startParam);
  } else {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1));
  }

  if (endParam) {
    end = parseUserDate(endParam);
  } else {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 11, 1));
  }

  if (!(end > start)) {
    throw new Error("end must be after start");
  }

  return { start, end };
}

/**
 * Parse user-supplied dates.
 * Accepts:
 *   - YYYY-MM-DD  (interpreted as UTC)
 *   - Any ISO string Date() can handle
 */
function parseUserDate(str) {
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    throw new Error(`cannot parse date: ${str}`);
  }
  return d;
}

// Convert Date → "YYYY-MM-DDT00:00:00" (UTC) for remote API
function toApiDate(dt) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    dt.getUTCFullYear() +
    "-" +
    pad(dt.getUTCMonth() + 1) +
    "-" +
    pad(dt.getUTCDate()) +
    "T00:00:00"
  );
}

function buildRemoteUrl(start, end) {
  const api = new URL("https://www.stjosephsinfant.school/calendar/api.asp");
  api.searchParams.set("pid", "3");
  api.searchParams.set("viewid", "2");
  api.searchParams.set("calid", "1");
  api.searchParams.set("bgedit", "false");
  api.searchParams.set("start", toApiDate(start));
  api.searchParams.set("end", toApiDate(end));
  api.searchParams.set("_", Date.now().toString());
  return api.toString();
}

/**
 * Build an ICS file from the remote events.
 * Remote event shape (based on the API) looks like:
 * {
 *   id, title, desc, date, time, hasAttachment, cf_14, start, end?, allDay?,
 *   url, cals, recurrence
 * }
 */
function buildICS(events) {
  let out = "";
  out += "BEGIN:VCALENDAR\r\n";
  out += "VERSION:2.0\r\n";
  out += "PRODID:-//StJosephsInfantProxy//EN\r\n";
  out += "CALSCALE:GREGORIAN\r\n";
  out += "METHOD:PUBLISH\r\n";

  const now = new Date();
  const dtstamp = formatICSDateTimeUTC(now);

  for (const ev of events) {
    out += "BEGIN:VEVENT\r\n";

    const uid = `${ev.id}@stjosephsinfant.school`;
    out += foldLine("UID", icsEscape(uid));
    out += `DTSTAMP:${dtstamp}\r\n`;

    writeEventTimes(ev, (line) => (out += line));

    if (ev.title) {
      out += foldLine("SUMMARY", icsEscape(ev.title));
    }

    const descParts = [];
    if (ev.desc) descParts.push(ev.desc);
    if (ev.recurrence) descParts.push(ev.recurrence);
    if (descParts.length > 0) {
      out += foldLine("DESCRIPTION", icsEscape(descParts.join("\\n")));
    }

    if (ev.url) {
      out += foldLine("URL", icsEscape(ev.url));
    }

    out += "END:VEVENT\r\n";
  }

  out += "END:VCALENDAR\r\n";
  return out;
}

// ICS helpers

function formatICSDateTimeUTC(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear().toString().padStart(4, "0") +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

// Floating local datetime (no timezone) for DTSTART/DTEND of timed events
function formatICSDateTimeFloating(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getFullYear().toString().padStart(4, "0") +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function icsEscape(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n");
}

// Fold long lines at 75 chars per RFC 5545
function foldLine(prop, value) {
  const line = `${prop}:${value}`;
  const maxLen = 75;
  if (line.length <= maxLen) {
    return line + "\r\n";
  }
  let out = line.slice(0, maxLen) + "\r\n";
  let rest = line.slice(maxLen);
  while (rest.length > 0) {
    out += " " + rest.slice(0, maxLen - 1) + "\r\n";
    rest = rest.slice(maxLen - 1);
  }
  return out;
}

/**
 * Decide DTSTART/DTEND for an event based on:
 *   - allDay boolean
 *   - start (date or datetime)
 *   - end (date or datetime, optional)
 *   - time (string; "All Day" for all-day events)
 */
function writeEventTimes(ev, append) {
  // All-day events
  if (ev.allDay || (ev.time && ev.time.toLowerCase() === "all day")) {
    const startDateStr = normalizeDateOnly(ev.start || ev.date);
    if (!startDateStr) return;

    append(`DTSTART;VALUE=DATE:${startDateStr}\r\n`);

    const endDateStr = normalizeDateOnly(ev.end);
    if (endDateStr) {
      append(`DTEND;VALUE=DATE:${endDateStr}\r\n`);
    }

    return;
  }

  // Timed events
  const start = parseEventDateTime(ev.start || ev.date, ev.time);
  if (!start) return;

  let end = null;

  if (ev.end) {
    const endParsed = parseEventDateTime(ev.end, null);
    if (endParsed) {
      end = endParsed;
    }
  }

  if (!end) {
    // default 1 hour duration if no end available
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  const dtStart = formatICSDateTimeFloating(start);
  const dtEnd = formatICSDateTimeFloating(end);

  append(`DTSTART:${dtStart}\r\n`);
  append(`DTEND:${dtEnd}\r\n`);
}

// "2025-12-19" → "20251219"
function normalizeDateOnly(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return m[1] + m[2] + m[3];
}

/**
 * Try to create a Date from:
 *  - ISO datetime like "2025-12-12T15:30:00"
 *  - Date-only plus a time string like "3:30pm"
 */
function parseEventDateTime(dateOrStart, timeStr) {
  if (!dateOrStart) return null;
  const s = String(dateOrStart).trim();

  // If it already looks like "YYYY-MM-DDTHH:mm:ss", rely on Date
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // Date-only; if we have a time string, combine them
  const dateMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;
  const [_, y, m, d] = dateMatch.map(Number);
  if (!timeStr) {
    // treat as midnight
    return new Date(y, m - 1, d, 0, 0, 0);
  }

  const time = parseClockTime(timeStr);
  if (!time) {
    return new Date(y, m - 1, d, 0, 0, 0);
  }

  return new Date(y, m - 1, d, time.hour, time.minute, 0);
}

// Parse "3:30pm", "3pm", "15:04"
function parseClockTime(str) {
  str = String(str).trim().toLowerCase();

  // 3:30pm, 3pm
  let m = str.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (m) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const ampm = m[3];
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return { hour, minute };
  }

  // 24h "15:04"
  m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
  }

  return null;
}
