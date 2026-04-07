/**
 * Agenda app: Excel (duration-only) + presenter TZ/start → attendee multi-day view.
 * Requires: global `luxon`, `XLSX`
 */

const STORAGE_KEY = "agendaApp_v1";
/** Max distinct calendar days (presenter timezone) for one agenda file. */
const MAX_AGENDA_DAYS = 3;
/** Set this before deployment. Plain client-side check only — not for high-security use. */
const PRESENTER_PASSWORD = "changeme";
const SESSION_PRESENTER_AUTH = "agendaApp_presenterAuth";

function isPresenterAuthenticated() {
  return sessionStorage.getItem(SESSION_PRESENTER_AUTH) === "1";
}

function setPresenterAuthenticated() {
  sessionStorage.setItem(SESSION_PRESENTER_AUTH, "1");
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const items = [];
        let startRow = 0;
        if (rows.length && looksLikeHeaderRow(rows[0])) {
          startRow = 1;
        }
        for (let i = startRow; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const title = String(row[0] ?? "").trim();
          const durRaw = row[1];
          if (!title) continue;
          const durationMinutes = parseDuration(durRaw);
          if (durationMinutes <= 0 || !Number.isFinite(durationMinutes)) continue;
          items.push({ title, durationMinutes });
        }
        if (!items.length) {
          reject(
            new Error(
              "No valid rows found. Use column A = topic, column B = duration (minutes)."
            )
          );
          return;
        }
        resolve(items);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

function looksLikeHeaderRow(row) {
  if (!row || row.length < 2) return false;
  const a = String(row[0]).toLowerCase();
  const b = String(row[1]).toLowerCase();
  return (
    /topic|title|session|agenda|subject/.test(a) &&
    /duration|minutes|min|length|time/.test(b)
  );
}

function parseDuration(val) {
  if (val === "" || val === null || val === undefined) return NaN;
  if (typeof val === "number" && Number.isFinite(val)) return Math.round(val);
  const s = String(val).trim();
  const num = parseFloat(s.replace(",", "."));
  return Number.isFinite(num) ? Math.round(num) : NaN;
}

function buildSessions(items, year, month, day, hour, minute, presenterTz) {
  let t = luxon.DateTime.fromObject(
    { year, month, day, hour, minute },
    { zone: presenterTz }
  );
  if (!t.isValid) throw new Error("Invalid date/time for presenter timezone.");
  const sessions = [];
  for (const item of items) {
    const end = t.plus({ minutes: item.durationMinutes });
    sessions.push({
      title: item.title,
      durationMinutes: item.durationMinutes,
      startISO: t.toUTC().toISO(),
      endISO: end.toUTC().toISO(),
    });
    t = end;
  }
  return sessions;
}

/** Curated IANA timezone identifiers (Region/City), sorted A–Z. */
function getTimeZoneOptions() {
  return [
    "America/Chicago",
    "America/Los_Angeles",
    "America/New_York",
    "America/Sao_Paulo",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Europe/Berlin",
    "Europe/London",
    "Europe/Paris",
    "Pacific/Auckland",
    "UTC",
  ];
}

/**
 * Distinct calendar dates (YYYY-MM-DD) touched by any session start/end in `zone` (IANA).
 */
function countAgendaCalendarDays(sessions, zone) {
  if (!sessions?.length) return 0;
  const tz = zone || "UTC";
  const dates = new Set();
  for (const s of sessions) {
    const start = luxon.DateTime.fromISO(s.startISO).setZone(tz);
    const end = luxon.DateTime.fromISO(s.endISO).setZone(tz);
    if (start.isValid) dates.add(start.toISODate());
    if (end.isValid) dates.add(end.toISODate());
  }
  return dates.size;
}

function assertAgendaWithinMaxDays(sessions, zone) {
  const n = countAgendaCalendarDays(sessions, zone);
  if (n > MAX_AGENDA_DAYS) {
    throw new Error(
      `This agenda spans ${n} calendar days (maximum ${MAX_AGENDA_DAYS}). Shorten the schedule or split it.`
    );
  }
}

function formatSessionRange(startISO, endISO, attendeeTz) {
  const s = luxon.DateTime.fromISO(startISO).setZone(attendeeTz);
  const e = luxon.DateTime.fromISO(endISO).setZone(attendeeTz);
  return `${s.toLocaleString(luxon.DateTime.TIME_SIMPLE)} – ${e.toLocaleString(luxon.DateTime.TIME_SIMPLE)}`;
}

function groupSessionsByDay(sessions, attendeeTz) {
  const map = new Map();
  for (const s of sessions) {
    const start = luxon.DateTime.fromISO(s.startISO).setZone(attendeeTz);
    const dateKey = start.toISODate();
    const label = start.toLocaleString(luxon.DateTime.DATE_HUGE);
    if (!map.has(dateKey)) {
      map.set(dateKey, { dateKey, label, sessions: [] });
    }
    map.get(dateKey).sessions.push(s);
  }
  return Array.from(map.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function showModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
  }
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
  }
}

function fillTimeZoneSelect(selectEl, extraZone) {
  const base = getTimeZoneOptions();
  const merged = [...new Set([...base, extraZone].filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const guess = luxon.DateTime.now().zoneName;
  const current = selectEl.value;
  selectEl.innerHTML = "";
  for (const z of merged) {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z;
    selectEl.appendChild(opt);
  }
  if (current && merged.includes(current)) {
    selectEl.value = current;
  } else if (merged.includes(guess)) {
    selectEl.value = guess;
  }
}

function renderPresenterPreview(items, sessions, presenterTz) {
  const host = document.getElementById("presenter-preview");
  if (!host) return;
  if (!sessions || !sessions.length) {
    host.innerHTML = "";
    const exportBtn = document.getElementById("btn-export-json");
    if (exportBtn) exportBtn.hidden = true;
    return;
  }
  const rows = sessions
    .map((s) => {
      const start = luxon.DateTime.fromISO(s.startISO).setZone(presenterTz);
      const end = luxon.DateTime.fromISO(s.endISO).setZone(presenterTz);
      const timeStr = `${start.toLocaleString(luxon.DateTime.TIME_SIMPLE)} – ${end.toLocaleString(luxon.DateTime.TIME_SIMPLE)}`;
      return `<tr><td>${escapeHtml(timeStr)}</td><td>${escapeHtml(s.title)}</td><td>${s.durationMinutes} min</td></tr>`;
    })
    .join("");
  host.innerHTML = `
    <div class="presenter-preview">
      <h3>Preview (${escapeHtml(presenterTz)})</h3>
      <table class="preview-table">
        <thead><tr><th>Time</th><th>Topic</th><th>Duration</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  const exportBtn = document.getElementById("btn-export-json");
  if (exportBtn) exportBtn.hidden = false;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/** Representative WGS84 [lat, lng] for IANA zones (map labels). */
const IANA_LAT_LNG = {
  "America/Chicago": [41.8781, -87.6298],
  "America/Los_Angeles": [34.0522, -118.2437],
  "America/New_York": [40.7128, -74.006],
  "America/Sao_Paulo": [-23.5505, -46.6333],
  "Asia/Dubai": [25.2048, 55.2708],
  "Asia/Kolkata": [22.5726, 88.3639],
  "Asia/Singapore": [1.3521, 103.8198],
  "Asia/Tokyo": [35.6762, 139.6503],
  "Australia/Sydney": [-33.8688, 151.2093],
  "Europe/Berlin": [52.52, 13.405],
  "Europe/London": [51.5074, -0.1278],
  "Europe/Paris": [48.8566, 2.3522],
  "Pacific/Auckland": [-36.8485, 174.7633],
  UTC: [0, 0],
};

let tzMapInstance = null;
let tzMapResizeCleanup = null;
let tzMapGeneration = 0;

function destroyLeafletMap() {
  if (tzMapResizeCleanup) {
    tzMapResizeCleanup();
    tzMapResizeCleanup = null;
  }
  if (tzMapInstance) {
    try {
      tzMapInstance.remove();
    } catch {
      /* ignore */
    }
    tzMapInstance = null;
  }
}

function getLatLngForIANA(tz) {
  if (tz && IANA_LAT_LNG[tz]) return IANA_LAT_LNG[tz];
  const prefix = tz && tz.includes("/") ? tz.split("/")[0] : "";
  const rough = {
    Africa: [5, 20],
    America: [12, -85],
    Antarctica: [-75, 0],
    Asia: [28, 105],
    Atlantic: [40, -35],
    Australia: [-25, 134],
    Europe: [50, 15],
    Indian: [-20, 70],
    Pacific: [-15, 0],
    UTC: [0, 0],
  };
  return rough[prefix] || [15, 0];
}

/** Short label for map (e.g. America/New_York → New York). */
function formatTimezoneLabelShort(iana) {
  if (!iana) return "";
  if (iana === "UTC") return "UTC";
  const parts = iana.split("/");
  const last = parts[parts.length - 1];
  return last.replace(/_/g, " ");
}

function addTimezoneLabelsToMap(map, selectedTz) {
  const zones = new Set(Object.keys(IANA_LAT_LNG));
  if (selectedTz) zones.add(selectedTz);
  for (const z of zones) {
    const [plat, plng] = getLatLngForIANA(z);
    const isActive = z === selectedTz;
    const shortName = formatTimezoneLabelShort(z);
    const icon = L.divIcon({
      className: `tz-map-label-wrap${isActive ? " tz-map-label-wrap--active" : ""}`,
      html: `<span class="tz-map-label${isActive ? " tz-map-label--active" : ""}" title="${escapeHtml(z)}">${escapeHtml(shortName)}</span>`,
      iconSize: [92, 26],
      iconAnchor: [46, 13],
    });
    L.marker([plat, plng], {
      icon,
      interactive: true,
      zIndexOffset: isActive ? 1000 : 0,
    }).addTo(map);
  }
}

/**
 * OpenStreetMap world map (Leaflet) with timezone labels (Attendee view).
 */
function renderTimezoneMap(tz) {
  const el = document.getElementById("attendee-tz-map-root");
  if (!el) return;
  destroyLeafletMap();
  tzMapGeneration += 1;
  const gen = tzMapGeneration;
  if (!tz || typeof tz !== "string") {
    el.hidden = true;
    el.innerHTML = "";
    el.removeAttribute("aria-label");
    return;
  }

  el.hidden = false;
  const [lat, lng] = getLatLngForIANA(tz);
  el.innerHTML = `
    <div class="tz-map-inner" id="tz-map-leaflet-container"></div>
    <p class="tz-map-id">${escapeHtml(tz)}</p>
    <p class="tz-map-attribution">
      Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
    </p>`;
  el.setAttribute("aria-label", `Selected timezone: ${tz}`);

  const initMap = () => {
    if (gen !== tzMapGeneration) return;
    if (typeof L === "undefined") {
      const inner = el.querySelector(".tz-map-inner");
      if (inner) {
        inner.innerHTML = `<p class="tz-map-fallback">World map could not be loaded. Coordinates (approx.): ${lat.toFixed(2)}°, ${lng.toFixed(2)}°</p>`;
      }
      return;
    }

    const map = L.map("tz-map-leaflet-container", {
      scrollWheelZoom: false,
      attributionControl: false,
    }).setView([15, 0], 2);

    if (gen !== tzMapGeneration) {
      map.remove();
      return;
    }

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    addTimezoneLabelsToMap(map, tz);

    if (gen !== tzMapGeneration) {
      map.remove();
      return;
    }

    tzMapInstance = map;

    const onResize = () => {
      if (tzMapInstance) tzMapInstance.invalidateSize();
    };
    window.addEventListener("resize", onResize);
    tzMapResizeCleanup = () => window.removeEventListener("resize", onResize);

    setTimeout(() => {
      if (tzMapInstance && gen === tzMapGeneration) tzMapInstance.invalidateSize();
    }, 150);
  };

  requestAnimationFrame(initMap);
}

function renderAttendeeAgenda(attendeeTz) {
  renderTimezoneMap(attendeeTz);
  const host = document.getElementById("attendee-agenda");
  const state = loadState();
  if (!host) return;
  if (!state || !state.sessions || !state.sessions.length) {
    host.innerHTML =
      '<p class="empty-state">No agenda yet. The presenter must publish a schedule on this browser / device (max 3 calendar days).</p>';
    return;
  }

  const groups = groupSessionsByDay(state.sessions, attendeeTz);
  const html = groups
    .map((g) => {
      const items = g.sessions
        .map((s) => {
          const range = formatSessionRange(s.startISO, s.endISO, attendeeTz);
          return `
          <li class="session-item">
            <span class="session-time">${escapeHtml(range)}</span>
            <span class="session-title">${escapeHtml(s.title)}</span>
            <span class="session-duration">${s.durationMinutes} min</span>
          </li>`;
        })
        .join("");
      return `
        <section class="day-block">
          <div class="day-header">${escapeHtml(g.label)}</div>
          <ul class="session-list">${items}</ul>
        </section>`;
    })
    .join("");

  host.innerHTML = html;
}

function wirePresenterAuthOnce() {
  const form = document.getElementById("form-presenter-auth");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  const errEl = document.getElementById("presenter-auth-error");
  const pwdInput = document.getElementById("presenter-password");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (errEl) errEl.textContent = "";
    const pwd = pwdInput?.value ?? "";
    if (pwd === PRESENTER_PASSWORD) {
      setPresenterAuthenticated();
      hideModal("modal-presenter-auth");
      const main = document.getElementById("presenter-main");
      if (main) main.hidden = false;
      if (pwdInput) pwdInput.value = "";
      initPresenter();
    } else if (errEl) {
      errEl.textContent = "Invalid password.";
    }
  });
}

function wirePresenterOnce() {
  const form = document.getElementById("form-presenter");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";

  const tzSelect = document.getElementById("presenter-tz");
  const errEl = document.getElementById("presenter-error");
  fillTimeZoneSelect(tzSelect, loadState()?.presenterTimeZone);

  const dateInput = document.getElementById("presenter-date");
  if (dateInput && !dateInput.value) {
    dateInput.value = luxon.DateTime.now().toISODate();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const fileInput = document.getElementById("presenter-file");
    const dateVal = dateInput.value;
    const timeVal = document.getElementById("presenter-time").value;
    const tz = tzSelect.value;

    if (!fileInput.files || !fileInput.files[0]) {
      errEl.textContent = "Please choose an Excel file (.xlsx or .xls).";
      return;
    }
    if (!dateVal || !timeVal) {
      errEl.textContent = "Please set event start date and time.";
      return;
    }

    const [y, m, d] = dateVal.split("-").map(Number);
    const [hh, mm] = timeVal.split(":").map(Number);

    try {
      const items = await parseExcelFile(fileInput.files[0]);
      const sessions = buildSessions(items, y, m, d, hh, mm, tz);
      assertAgendaWithinMaxDays(sessions, tz);
      const presenterStartLabel = `${dateVal}T${timeVal}`;
      saveState({
        items,
        sessions,
        presenterTimeZone: tz,
        presenterStartLabel,
      });
      renderPresenterPreview(items, sessions, tz);
      hideModal("modal-presenter");
    } catch (err) {
      errEl.textContent = err.message || String(err);
    }
  });

  document.getElementById("btn-presenter-cancel")?.addEventListener("click", () => {
    hideModal("modal-presenter");
  });

  document.getElementById("btn-export-json")?.addEventListener("click", () => {
    const st = loadState();
    if (!st || !st.sessions?.length) return;
    const blob = new Blob([JSON.stringify(st, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "agenda.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("btn-presenter-reopen")?.addEventListener("click", () => {
    const st = loadState();
    if (st?.presenterStartLabel) {
      const [datePart, timePart] = st.presenterStartLabel.split("T");
      document.getElementById("presenter-date").value = datePart || "";
      document.getElementById("presenter-time").value = (timePart || "09:00").slice(0, 5);
    }
    if (st?.presenterTimeZone) {
      tzSelect.value = st.presenterTimeZone;
    }
    errEl.textContent = "";
    showModal("modal-presenter");
  });
}

function initPresenter() {
  wirePresenterOnce();
  const state = loadState();
  const tzSelect = document.getElementById("presenter-tz");

  if (state && state.sessions && state.sessions.length) {
    renderPresenterPreview(state.items, state.sessions, state.presenterTimeZone);
    if (state.presenterTimeZone && tzSelect) {
      tzSelect.value = state.presenterTimeZone;
    }
    const exportBtn = document.getElementById("btn-export-json");
    if (exportBtn) exportBtn.hidden = false;
    hideModal("modal-presenter");
  } else {
    const exportBtn = document.getElementById("btn-export-json");
    if (exportBtn) exportBtn.hidden = true;
    showModal("modal-presenter");
  }
}

function initPresenterRoute() {
  wirePresenterAuthOnce();
  const main = document.getElementById("presenter-main");
  if (!main) return;

  if (isPresenterAuthenticated()) {
    main.hidden = false;
    hideModal("modal-presenter-auth");
    initPresenter();
  } else {
    main.hidden = true;
    const errEl = document.getElementById("presenter-auth-error");
    if (errEl) errEl.textContent = "";
    showModal("modal-presenter-auth");
  }
}

function wireAttendeeOnce() {
  const form = document.getElementById("form-attendee");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";

  const tzSelect = document.getElementById("attendee-tz");
  fillTimeZoneSelect(tzSelect, loadState()?.presenterTimeZone);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const tz = tzSelect.value;
    sessionStorage.setItem("agendaApp_attendeeTz", tz);
    renderAttendeeAgenda(tz);
    hideModal("modal-attendee");
  });

  document.getElementById("btn-attendee-change-tz")?.addEventListener("click", () => {
    showModal("modal-attendee");
  });
}

function initAttendee() {
  wireAttendeeOnce();
  const tzSelect = document.getElementById("attendee-tz");
  const savedTz = sessionStorage.getItem("agendaApp_attendeeTz");
  if (savedTz && tzSelect) {
    tzSelect.value = savedTz;
    renderAttendeeAgenda(savedTz);
    hideModal("modal-attendee");
  } else {
    renderTimezoneMap(null);
    showModal("modal-attendee");
  }
}

function route() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "") || "attendee";
  let page = raw.split("/")[0];
  if (page === "home" || (page !== "presenter" && page !== "attendee")) page = "attendee";
  document.querySelectorAll("[data-page]").forEach((el) => {
    el.hidden = el.getAttribute("data-page") !== page;
  });
  if (page !== "attendee") {
    renderTimezoneMap(null);
  }
  if (page === "presenter") initPresenterRoute();
  else if (page === "attendee") initAttendee();
}

document.addEventListener("DOMContentLoaded", () => {
  window.addEventListener("hashchange", route);
  if (!window.location.hash) {
    window.location.hash = "#/attendee";
  }
  route();
});
