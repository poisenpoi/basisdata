/* TokoKita - client-side API helper + formatters */

const API = {
  async request(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);

    if (res.status === 401 && !location.pathname.startsWith('/login')) {
      location.href = '/login';
      return;
    }

    let data = null;
    try { data = await res.json(); } catch (_) { /* empty body */ }

    if (!res.ok) {
      const msg = (data && data.error) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  },
  get(url)         { return this.request('GET',    url); },
  post(url, body)  { return this.request('POST',   url, body); },
  put(url, body)   { return this.request('PUT',    url, body); },
  patch(url, body) { return this.request('PATCH',  url, body); },
  del(url)         { return this.request('DELETE', url); }
};

/* ===== Formatters (mirror server-side helpers.js) ===== */

function rupiah(n) {
  const v = Number(n || 0);
  return 'Rp ' + v.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

function rupiahShort(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000_000) return 'Rp ' + (v / 1_000_000_000).toFixed(1).replace('.0', '') + 'M';
  if (v >= 1_000_000)     return 'Rp ' + (v / 1_000_000).toFixed(0) + 'jt';
  if (v >= 1_000)         return 'Rp ' + (v / 1_000).toFixed(0) + 'rb';
  return rupiah(v);
}

const _monthsId = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatTanggal(d) {
  if (!d) return '-';
  const dt = (d instanceof Date) ? d : new Date(String(d).replace(' ', 'T'));
  if (isNaN(dt)) return String(d);
  return `${String(dt.getDate()).padStart(2, '0')} ${_monthsId[dt.getMonth()]} ${dt.getFullYear()}`;
}

function formatTanggalJam(d) {
  if (!d) return '-';
  const dt = (d instanceof Date) ? d : new Date(String(d).replace(' ', 'T'));
  if (isNaN(dt)) return String(d);
  const tgl = `${String(dt.getDate()).padStart(2, '0')} ${_monthsId[dt.getMonth()]} ${dt.getFullYear()}`;
  const jam = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  return `${tgl}, ${jam}`;
}

function metodeLabel(metode, penyedia) {
  if (!metode) return '-';
  if (metode === 'transfer_bank') return penyedia ? `Transfer ${penyedia}` : 'Transfer Bank';
  if (metode === 'e_wallet')      return penyedia || 'E-Wallet';
  if (metode === 'cod')           return 'COD';
  return metode;
}

function statusLabel(map, key) {
  return (map && map[key]) || key || '-';
}

/* ===== DOM helpers ===== */

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class')      e.className = v;
      else if (k === 'html')  e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else                    e.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

function txt(s) { return document.createTextNode(s == null ? '' : String(s)); }

function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

function showError(msg) {
  const box = document.getElementById('flash');
  if (!box) { alert(msg); return; }
  const div = el('div', { class: 'alert alert-error' }, msg);
  clear(box);
  box.appendChild(div);
}

function showSuccess(msg) {
  const box = document.getElementById('flash');
  if (!box) return;
  const div = el('div', { class: 'alert alert-success' }, msg);
  clear(box);
  box.appendChild(div);
}

function updatePanelToggle(btn, panel) {
  const isOpen = !panel.classList.contains('is-hidden');
  const section = panel.classList.contains('section-body') ? panel.closest('.section') : null;
  if (section) section.classList.toggle('section-collapsed', !isOpen);
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  btn.textContent = isOpen
    ? (btn.getAttribute('data-open-label') || 'Tutup')
    : (btn.getAttribute('data-closed-label') || 'Buka');
}

function initPanelToggles(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-toggle-panel]').forEach((btn) => {
    if (btn.getAttribute('data-panel-bound') === 'true') return;
    const panel = document.getElementById(btn.getAttribute('data-toggle-panel'));
    if (!panel) return;
    btn.setAttribute('data-panel-bound', 'true');
    updatePanelToggle(btn, panel);
    btn.addEventListener('click', () => {
      panel.classList.toggle('is-hidden');
      updatePanelToggle(btn, panel);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => initPanelToggles());
