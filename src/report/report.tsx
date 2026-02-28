const rowsEl = document.getElementById("audit-rows");
const stateEl = document.getElementById("audit-state");
const progressEl = document.getElementById("audit-progress");
const compromisedEl = document.getElementById("audit-compromised");
const safeEl = document.getElementById("audit-safe");
const emailPwnedEl = document.getElementById("audit-email-pwned");
const emailSafeEl = document.getElementById("audit-email-safe");
const scheduleLastEl = document.getElementById("schedule-last");
const scheduleNextEl = document.getElementById("schedule-next");
const metaEl = document.getElementById("audit-meta");
const fillEl = document.getElementById("progress-fill");
const refreshBtn = document.getElementById("refresh-btn");

const search = new URLSearchParams(window.location.search);
let auditId = String(search.get("audit") || "").trim();

let pollTimer = null;
let done = false;

const setErrorRow = (message) => {
  rowsEl.textContent = "";
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 10;
  td.className = "muted";
  td.textContent = message;
  tr.appendChild(td);
  rowsEl.appendChild(tr);
};

const formatDate = (epochMs) => {
  if (!epochMs) return "-";
  const d = new Date(epochMs);
  return d.toLocaleString();
};

const formatRemaining = (targetMs, nowMs) => {
  const delta = Math.max(0, targetMs - nowMs);
  const totalMin = Math.ceil(delta / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `${hours}h ${mins}m`;
};

const message = async (type, payload) => {
  const req = payload === undefined ? { type } : { type, payload };
  try {
    const res = await chrome.runtime.sendMessage(req);
    if (!res || typeof res.ok !== "boolean") {
      throw new Error("Respuesta invalida de background");
    }
    return res;
  } catch (error) {
    throw error;
  }
};

const renderSummary = (audit) => {
  stateEl.textContent = audit.state;
  progressEl.textContent = `${audit.processed} / ${audit.total}`;
  compromisedEl.textContent = String(audit.compromised);
  safeEl.textContent = String(audit.safe);
  if (emailPwnedEl) {
    emailPwnedEl.textContent = String(audit.emailPwned ?? 0);
  }
  if (emailSafeEl) {
    emailSafeEl.textContent = String(audit.emailSafe ?? 0);
  }

  const percent = audit.total > 0
    ? Math.min(100, Math.round((audit.processed / audit.total) * 100))
    : 0;
  fillEl.style.width = `${percent}%`;

  const finishedText = audit.finishedAt ? ` | fin: ${formatDate(audit.finishedAt)}` : "";
  metaEl.textContent = `Audit ID: ${audit.auditId} | inicio: ${formatDate(audit.startedAt)}${finishedText}`;
};

const renderSchedule = (schedule) => {
  if (!scheduleLastEl || !scheduleNextEl) {
    return;
  }
  scheduleLastEl.textContent = schedule.lastAuditAt ? formatDate(schedule.lastAuditAt) : "Nunca";
  if (schedule.nextAuditAt) {
    const remaining = formatRemaining(schedule.nextAuditAt, schedule.now || Date.now());
    scheduleNextEl.textContent = `${formatDate(schedule.nextAuditAt)} (${remaining})`;
  } else {
    scheduleNextEl.textContent = "-";
  }
};

const badge = (item) => {
  const span = document.createElement("span");
  span.className = "badge";

  if (item.status === "error") {
    span.classList.add("badge--err");
    span.textContent = "ERROR";
    return span;
  }
  if (item.compromised) {
    span.classList.add("badge--warn");
    span.textContent = "PWNED";
    return span;
  }

  span.classList.add("badge--ok");
  span.textContent = "OK";
  return span;
};

const domainBadge = (item) => {
  const span = document.createElement("span");
  span.className = "badge";
  if (item.domainStatus === "pwned") {
    span.classList.add("badge--warn");
    span.textContent = "PWNED";
    return span;
  }
  if (item.domainStatus === "safe") {
    span.classList.add("badge--ok");
    span.textContent = "OK";
    return span;
  }
  if (item.domainStatus === "error") {
    span.classList.add("badge--err");
    span.textContent = "ERROR";
    return span;
  }
  span.textContent = "-";
  return span;
};

const emailBadge = (item) => {
  const span = document.createElement("span");
  span.className = "badge";
  if (item.emailStatus === "pwned") {
    span.classList.add("badge--warn");
    span.textContent = "PWNED";
    return span;
  }
  if (item.emailStatus === "safe") {
    span.classList.add("badge--ok");
    span.textContent = "OK";
    return span;
  }
  if (item.emailStatus === "error") {
    span.classList.add("badge--err");
    span.textContent = "ERROR";
    return span;
  }
  span.textContent = "-";
  return span;
};

const renderRows = (items) => {
  rowsEl.textContent = "";
  if (!Array.isArray(items) || items.length === 0) {
    setErrorRow("No hay resultados todavía.");
    return;
  }

  const sorted = [...items].sort((a, b) => {
    const score = (item) => {
      if (item.status === "error") return 0;
      if (item.compromised) return 1;
      if (item.emailStatus === "error") return 2;
      if (item.emailStatus === "pwned") return 3;
      if (item.domainStatus === "error") return 4;
      if (item.domainStatus === "pwned") return 5;
      return 6;
    };
    const delta = score(a) - score(b);
    if (delta !== 0) return delta;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });

  for (const item of sorted) {
    const tr = document.createElement("tr");

    const titleTd = document.createElement("td");
    titleTd.textContent = item.title || "(sin titulo)";
    tr.appendChild(titleTd);

    const resultTd = document.createElement("td");
    resultTd.appendChild(badge(item));
    tr.appendChild(resultTd);

    const countTd = document.createElement("td");
    countTd.textContent = item.status === "ok" ? String(item.count ?? 0) : "-";
    tr.appendChild(countTd);

    const domainTd = document.createElement("td");
    domainTd.textContent = item.domain || "-";
    tr.appendChild(domainTd);

    const domainStateTd = document.createElement("td");
    domainStateTd.appendChild(domainBadge(item));
    tr.appendChild(domainStateTd);

    const domainBreachesTd = document.createElement("td");
    if (Array.isArray(item.domainBreaches) && item.domainBreaches.length > 0) {
      domainBreachesTd.textContent = `${item.domainBreachCount ?? item.domainBreaches.length} (${item.domainBreaches.join(", ")})`;
    } else if (item.domainStatus === "safe") {
      domainBreachesTd.textContent = "0";
    } else if (item.domainStatus === "error") {
      domainBreachesTd.textContent = "-";
    } else {
      domainBreachesTd.textContent = "-";
    }
    tr.appendChild(domainBreachesTd);

    const emailTd = document.createElement("td");
    emailTd.textContent = item.email || item.username || "-";
    tr.appendChild(emailTd);

    const emailStateTd = document.createElement("td");
    emailStateTd.appendChild(emailBadge(item));
    tr.appendChild(emailStateTd);

    const emailBreachesTd = document.createElement("td");
    if (Array.isArray(item.emailBreaches) && item.emailBreaches.length > 0) {
      emailBreachesTd.textContent = `${item.emailBreachCount ?? item.emailBreaches.length} (${item.emailBreaches.join(", ")})`;
    } else if (item.emailStatus === "safe") {
      emailBreachesTd.textContent = "0";
    } else if (item.emailStatus === "error") {
      emailBreachesTd.textContent = "-";
    } else {
      emailBreachesTd.textContent = "-";
    }
    tr.appendChild(emailBreachesTd);

    const errorTd = document.createElement("td");
    errorTd.textContent = item.error || item.domainError || item.emailError || "-";
    tr.appendChild(errorTd);

    rowsEl.appendChild(tr);
  }
};

const fetchResult = async () => {
  const res = await message("HIBP_AUDIT_RESULT", { auditId });
  if (!res.ok) {
    throw new Error(res.error?.message || "No se pudo obtener el resultado.");
  }
  renderSummary(res.data.audit);
  renderRows(res.data.items);
};

const fetchStatus = async () => {
  const res = await message("HIBP_AUDIT_STATUS", { auditId });
  if (!res.ok) {
    throw new Error(res.error?.message || "No se pudo obtener el estado.");
  }

  renderSummary(res.data.audit);
  const state = res.data.audit.state;
  if (state === "done" || state === "failed" || state === "aborted") {
    done = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    await fetchResult();
  }
};

const fetchSchedule = async () => {
  const res = await message("HIBP_AUDIT_SCHEDULE");
  if (!res.ok) {
    throw new Error(res.error?.message || "No se pudo obtener el scheduler.");
  }
  renderSchedule(res.data.schedule);
};

const refresh = async () => {
  refreshBtn.disabled = true;
  try {
    await fetchSchedule();
    if (done) {
      await fetchResult();
    } else {
      await fetchStatus();
    }
  } catch (error) {
    setErrorRow(String(error?.message || error));
  } finally {
    refreshBtn.disabled = false;
  }
};

const rerunAuditNow = async () => {
  refreshBtn.disabled = true;
  try {
    const res = await message("HIBP_AUDIT_START");
    if (!res.ok) {
      throw new Error(res.error?.message || "No se pudo lanzar una nueva auditoría.");
    }

    const nextAuditId = String(res.data?.auditId || "").trim();
    if (!nextAuditId) {
      throw new Error("No se recibió auditId al relanzar.");
    }

    auditId = nextAuditId;
    done = false;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("audit", auditId);
    history.replaceState({}, "", nextUrl.toString());
    setErrorRow("Re-ejecutando auditoría...");
    await refresh();
  } finally {
    refreshBtn.disabled = false;
  }
};

if (!auditId) {
  setErrorRow("Falta auditId en la URL.");
  stateEl.textContent = "invalid";
} else {
  refresh().catch(() => undefined);
  pollTimer = setInterval(() => {
    refresh().catch(() => undefined);
  }, 1200);
}

refreshBtn.addEventListener("click", () => {
  rerunAuditNow().catch((error) => {
    setErrorRow(String(error?.message || error));
  });
});
