/**
 * The Left Bank — events feed builder
 * Pulls confirmed nights from the Notion Events database and writes:
 *   dist/events.json   — machine-readable feed (site embed, Rockhub, socials)
 *   dist/events.html   — pre-rendered listing fragment (no-JS fallback / debugging)
 *   dist/schema.json   — schema.org Event JSON-LD array
 *
 * Runs in GitHub Actions on a schedule. Read-only against Notion.
 * Env: NOTION_TOKEN (integration secret), NOTION_DATABASE_ID
 */

const fs = require("fs");
const path = require("path");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID || "a503e211-c0f2-49a3-ab6c-3fe33a747ce0";
const OUT = path.join(__dirname, "dist");

const VENUE = {
  name: "The Left Bank",
  streetAddress: "33-35 Gibson Street",
  addressLocality: "Glasgow",
  postalCode: "G12 8NU",
  addressCountry: "GB",
  url: "https://www.theleftbank.co.uk",
};

if (!NOTION_TOKEN) {
  console.error("NOTION_TOKEN is not set");
  process.exit(1);
}

// ---------- Notion helpers ----------

async function notionQuery(cursor) {
  // Status-only filter (Notion compound filters max out at two levels);
  // date and TBA logic is applied in JS below.
  const body = {
    page_size: 100,
    filter: {
      or: [
        { property: "Status", select: { equals: "Confirmed" } },
        { property: "Status", select: { equals: "Published" } },
      ],
    },
    sorts: [{ property: "Date", direction: "ascending" }],
  };
  if (cursor) body.start_cursor = cursor;

  const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Notion API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function todayISO() {
  // Europe/London calendar date, so late-night US-server runs don't drop tonight's event
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

const t = {
  title: (p) => (p?.title || []).map((r) => r.plain_text).join(""),
  text: (p) => (p?.rich_text || []).map((r) => r.plain_text).join(""),
  select: (p) => p?.select?.name || null,
  checkbox: (p) => !!p?.checkbox,
  url: (p) => p?.url || null,
  dateStart: (p) => p?.date?.start || null,
};

// ---------- transform ----------

function toEvent(page) {
  const p = page.properties;
  const start = t.dateStart(p["Date"]);
  return {
    id: page.id,
    title: t.title(p["Event"]),
    start, // ISO datetime or date, or null when TBA
    dateTBA: t.checkbox(p["Date TBA"]) && !start,
    slot: t.text(p["Slot"]) || null,
    act: t.text(p["Selector / Act"]) || null,
    format: t.select(p["Format"]),
    entry: t.select(p["Entry"]) || "Free", // blank is treated as free
    ticketUrl: t.url(p["Ticket URL"]),
    blurb: t.text(p["Web Blurb"]) || null,
    meta: t.text(p["Web Meta"]) || null,
    featuredFlag: t.checkbox(p["Featured"]),
  };
}

function pickFeatured(events) {
  // "If several are ticked, only the soonest is featured."
  const flagged = events.filter((e) => e.featuredFlag && e.start);
  if (!flagged.length) return null;
  flagged.sort((a, b) => a.start.localeCompare(b.start));
  return flagged[0].id;
}

// ---------- rendering ----------

const fmtDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderHTML(events, featuredId) {
  const dated = events.filter((e) => e.start);
  const tba = events.filter((e) => e.dateTBA);

  const li = (e) => {
    const featured = e.id === featuredId;
    const when = e.start ? fmtDay.format(new Date(e.start)) : "date to be announced";
    const bits = [e.slot, e.meta].filter(Boolean).join(" · ");
    return [
      `<li class="lb-ev${featured ? " lb-ev--featured" : ""}">`,
      `<span class="lb-ev-date">${esc(when)}</span>`,
      `<span class="lb-ev-body"><strong>${esc(e.title)}</strong>`,
      e.act && e.act !== e.title ? ` <span class="lb-ev-act">${esc(e.act)}</span>` : "",
      bits ? `<span class="lb-ev-meta">${esc(bits)}</span>` : "",
      e.entry === "Ticketed" ? `<span class="lb-ev-entry">ticketed</span>` : "",
      featured && e.blurb ? `<span class="lb-ev-blurb">${esc(e.blurb)}</span>` : "",
      featured && e.ticketUrl ? `<a class="lb-ev-ticket" href="${esc(e.ticketUrl)}">tickets</a>` : "",
      `</span></li>`,
    ].join("");
  };

  return [
    `<ul class="lb-events">`,
    ...dated.map(li),
    ...tba.map(li),
    `</ul>`,
  ].join("\n");
}

function renderSchema(events) {
  return events
    .filter((e) => e.start)
    .map((e) => ({
      "@context": "https://schema.org",
      "@type": "MusicEvent",
      name: `${e.title} at The Left Bank`,
      startDate: e.start,
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      eventStatus: "https://schema.org/EventScheduled",
      performer: e.act ? { "@type": "PerformingGroup", name: e.act } : undefined,
      description: e.blurb || [e.slot, e.meta].filter(Boolean).join(" · ") || undefined,
      location: {
        "@type": "BarOrPub",
        name: VENUE.name,
        address: {
          "@type": "PostalAddress",
          streetAddress: VENUE.streetAddress,
          addressLocality: VENUE.addressLocality,
          postalCode: VENUE.postalCode,
          addressCountry: VENUE.addressCountry,
        },
      },
      offers: {
        "@type": "Offer",
        price: e.entry === "Ticketed" ? undefined : "0",
        priceCurrency: "GBP",
        url: e.ticketUrl || `${VENUE.url}/upcoming`,
        availability: "https://schema.org/InStock",
      },
      organizer: { "@type": "Organization", name: VENUE.name, url: VENUE.url },
    }));
}

// ---------- main ----------

(async () => {
  const pages = [];
  let cursor;
  do {
    const res = await notionQuery(cursor);
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  const today = todayISO();
  const events = pages
    .map(toEvent)
    .filter((e) => e.title)
    .filter((e) => (e.start ? e.start.slice(0, 10) >= today : e.dateTBA));
  const featuredId = pickFeatured(events);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "events.json"),
    JSON.stringify({ generated: new Date().toISOString(), featuredId, venue: VENUE, events }, null, 2)
  );
  fs.writeFileSync(path.join(OUT, "events.html"), renderHTML(events, featuredId));
  fs.writeFileSync(path.join(OUT, "schema.json"), JSON.stringify(renderSchema(events), null, 2));

  console.log(`Built ${events.length} events (featured: ${featuredId || "none"})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
