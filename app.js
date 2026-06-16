/* ============================================================
   app.js — Dashboard de Metas · Polos
   Lê Google Sheets (publicado como CSV) e renderiza o dashboard.
   ============================================================

   CONFIGURAÇÃO RÁPIDA:
   1. No Google Sheets → Arquivo → Compartilhar → Publicar na web
   2. Escolha a aba "ABERTURA" → CSV → Publicar. Copie o link.
   3. Faça o mesmo para a aba "CONSOLIDADO".
   4. Cole os links nas constantes SHEET_URL_ABERTURA e SHEET_URL_CONSOLIDADO abaixo.
      OU: Informe apenas o SHEET_ID e os nomes das abas (recomendado).
   ============================================================ */

// ── CONFIGURAÇÃO ─────────────────────────────────────────────
// Substitua pelo ID da sua planilha (a parte longa da URL do Sheets)
// Exemplo: https://docs.google.com/spreadsheets/d/SEU_ID_AQUI/edit
const CONFIG = {
  SHEET_ID:          '10Lts1kA9GD1bjSlR1HoLi3mIJBBCXc58tf-jCgOq-lc',   // ← SUBSTITUA
  ABA_ABERTURA:      'ABERTURA',             // nome exato da aba
  ABA_CONSOLIDADO:   'CONSOLIDADO',          // nome exato da aba
  ROWS_PER_PAGE:     50,
};
// ─────────────────────────────────────────────────────────────

// Estado global
const state = {
  abertura:     [],
  consolidado:  [],
  filtered:     [],
  page:         1,
  sortCol:      'polo',
  sortDir:      'asc',
};

// ── URLS DO SHEETS ────────────────────────────────────────────
function buildCsvUrl(sheetId, tabName) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tenta recuperar ID salvo no localStorage
  const savedId = localStorage.getItem('dashboard_sheet_id');
  if (savedId) CONFIG.SHEET_ID = savedId;

  // Configura eventos de UI antes de carregar
  setupEventListeners();

  // Carrega os dados
  loadDashboard();
});

function setupEventListeners() {
  // Botão atualizar
  document.getElementById('btn-refresh').addEventListener('click', () => {
    loadDashboard();
    const btn = document.getElementById('btn-refresh');
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';
    setTimeout(() => { btn.style.opacity = ''; btn.style.pointerEvents = ''; }, 2000);
  });

  // Salvar ID na tela de erro
  document.getElementById('btn-save-id').addEventListener('click', () => {
    const val = document.getElementById('sheet-id-input').value.trim();
    if (!val) return;
    // Aceita URL completa ou só o ID
    CONFIG.SHEET_ID = extractSheetId(val);
    localStorage.setItem('dashboard_sheet_id', CONFIG.SHEET_ID);
    loadDashboard();
  });

  // Atualizar ID inline
  document.getElementById('btn-update-id')?.addEventListener('click', () => {
    const val = document.getElementById('inline-sheet-id').value.trim();
    if (!val) return;
    CONFIG.SHEET_ID = extractSheetId(val);
    localStorage.setItem('dashboard_sheet_id', CONFIG.SHEET_ID);
    loadDashboard();
  });

  // Filtros e busca
  document.getElementById('search-input').addEventListener('input', () => { state.page = 1; applyFiltersAndRender(); });
  document.getElementById('filter-carteira').addEventListener('change', () => { state.page = 1; applyFiltersAndRender(); });
  document.getElementById('filter-status').addEventListener('change', () => { state.page = 1; applyFiltersAndRender(); });
  document.getElementById('btn-clear-filters').addEventListener('click', clearFilters);

  // Paginação
  document.getElementById('btn-prev').addEventListener('click', () => { state.page--; renderTable(); });
  document.getElementById('btn-next').addEventListener('click', () => { state.page++; renderTable(); });

  // Ordenação da tabela
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = 'asc';
      }
      state.page = 1;
      applyFiltersAndRender();
      updateSortUI();
    });
  });
}

function extractSheetId(input) {
  // Aceita URL completa ou só o ID
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : input;
}

// ── CARREGAMENTO DE DADOS ─────────────────────────────────────
async function loadDashboard() {
  showLoading();

  try {
    const [abertura, consolidado] = await Promise.all([
      fetchCsv(buildCsvUrl(CONFIG.SHEET_ID, CONFIG.ABA_ABERTURA)),
      fetchCsv(buildCsvUrl(CONFIG.SHEET_ID, CONFIG.ABA_CONSOLIDADO)),
    ]);

    state.abertura    = parseAbertura(abertura);
    state.consolidado = parseConsolidado(consolidado);

    if (state.abertura.length === 0) throw new Error('Nenhum dado encontrado na aba ABERTURA.');

    showDashboard();
    renderAll();
    updateTimestamp();
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    showError(err.message || 'Falha ao conectar com a planilha.');
  }
}

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erro HTTP ${res.status} ao buscar dados.`);
  return res.text();
}

// ── PARSING ───────────────────────────────────────────────────
function parseCsvLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  cols.push(cur.trim());
  return cols;
}

function parsePct(val) {
  if (!val) return 0;
  return parseFloat(val.replace('%', '').replace(',', '.')) || 0;
}

function parseNum(val) {
  if (!val || val === '' || val === '-') return 0;
  return parseInt(val.replace(/\./g, '').replace(',', '.')) || 0;
}

function parseAbertura(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  // Primeira linha = cabeçalho
  return lines.slice(1).map(line => {
    const c = parseCsvLine(line);
    return {
      cod_polo:   c[0]  || '',
      polo:       c[1]  || '',
      parceiro:   c[2]  || '',
      carteira:   c[3]  || '',
      analista:   c[4]  || '',
      pagantes:   parseNum(c[5]),
      meta_edital:parseNum(c[6]),
      pct_edital: parsePct(c[7]),
      meta_movel: parseNum(c[8]),
      pct_movel:  parsePct(c[9]),
    };
  }).filter(r => r.polo && r.polo !== 'POLO');
}

function parseConsolidado(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  const results = [];

  lines.forEach(line => {
    const c = parseCsvLine(line);
    // Detecta linhas de carteira (contém "Gerente" no campo A)
    if (!c[0] || !c[0].includes('Gerente')) return;

    const pagantes   = parseNum(c[1]);
    const metaMovel  = parseNum(c[2]);
    const pctMovel   = parsePct(c[3]);
    const metaEdital = parseNum(c[6]);
    const pctEdital  = parsePct(c[7]);

    if (pagantes === 0 && metaMovel === 0) return;

    results.push({
      carteira:   c[0],
      pagantes,
      meta_movel: metaMovel,
      pct_movel:  pctMovel,
      meta_edital:metaEdital,
      pct_edital: pctEdital,
    });
  });

  // Tenta extrair linha GERAL SEM FILTROS (linha 14 aproximadamente)
  const geralLine = lines.find(l => l.toUpperCase().includes('GERAL SEM FILTROS'));
  if (geralLine) {
    const c = parseCsvLine(geralLine);
    results._geral = {
      pagantes:   parseNum(c[1]),
      meta_movel: parseNum(c[2]),
      pct_movel:  parsePct(c[3]),
      meta_edital:parseNum(c[6]),
      pct_edital: parsePct(c[7]),
    };
  }

  return results;
}

// ── RENDERIZAÇÃO ──────────────────────────────────────────────
function renderAll() {
  renderKPIs();
  renderCarteiras();
  renderRanking();
  populateFilterCarteira();
  state.filtered = [...state.abertura];
  applyFiltersAndRender();
}

function renderKPIs() {
  const geral = state.consolidado._geral;

  // Tenta usar dados do GERAL SEM FILTROS, senão soma da ABERTURA
  let pagantes, metaTotal, pctMovel, pctEdital;

  if (geral && geral.pagantes > 0) {
    pagantes  = geral.pagantes;
    metaTotal = geral.meta_movel;
    pctMovel  = geral.pct_movel;
    pctEdital = geral.pct_edital;
  } else {
    pagantes  = state.abertura.reduce((s, r) => s + r.pagantes, 0);
    metaTotal = state.abertura.reduce((s, r) => s + r.meta_movel, 0);
    pctMovel  = metaTotal > 0 ? (pagantes / metaTotal * 100) : 0;
    pctEdital = state.abertura.reduce((s, r) => s + r.meta_edital, 0);
    pctEdital = pctEdital > 0 ? (pagantes / pctEdital * 100) : 0;
  }

  const polosAtivos  = state.abertura.filter(r => r.pagantes > 0).length;
  const acimaMeta    = state.abertura.filter(r => r.pct_movel >= 100).length;

  setText('kpi-pagantes',   fmt(pagantes));
  setText('kpi-meta-total', `Meta: ${fmt(metaTotal)}`);
  setText('kpi-pct-movel',  fmtPct(pctMovel));
  setText('kpi-pct-edital', fmtPct(pctEdital));
  setText('kpi-polos',      polosAtivos);
  setText('kpi-acima-meta', `${acimaMeta} acima de 100%`);

  // Barras animadas
  requestAnimationFrame(() => {
    setWidth('bar-movel',  Math.min(pctMovel, 100));
    setWidth('bar-edital', Math.min(pctEdital, 100));
  });

  // Data
  setText('hero-date', new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }));
}

function renderCarteiras() {
  const grid = document.getElementById('carteiras-grid');
  const carteiras = state.consolidado.filter(c => typeof c === 'object' && c.carteira);

  document.getElementById('badge-carteiras').textContent = `${carteiras.length} carteiras`;

  grid.innerHTML = carteiras.map(c => {
    const cls   = statusClass(c.pct_movel);
    const barW  = Math.min(c.pct_movel, 100);
    return `
      <div class="carteira-card ${cls}">
        <div class="carteira-name">${c.carteira}</div>
        <div class="carteira-stats">
          <div class="stat-item">
            <span class="stat-label">Pagantes</span>
            <span class="stat-value">${fmt(c.pagantes)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Meta</span>
            <span class="stat-value">${fmt(c.meta_movel)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">% Móvel</span>
            <span class="stat-value pct">
              <span class="pct-badge">${fmtPct(c.pct_movel)}</span>
            </span>
          </div>
        </div>
        <div class="carteira-bar-wrap">
          <div class="carteira-bar" data-width="${barW}" style="width:0%"></div>
        </div>
      </div>`;
  }).join('');

  // Anima barras
  requestAnimationFrame(() => {
    document.querySelectorAll('.carteira-bar[data-width]').forEach(bar => {
      setTimeout(() => { bar.style.width = bar.dataset.width + '%'; }, 100);
    });
  });
}

function renderRanking() {
  const list = document.getElementById('ranking-list');
  const carteiras = state.consolidado
    .filter(c => typeof c === 'object' && c.carteira)
    .sort((a, b) => b.pct_movel - a.pct_movel);

  const maxPct = carteiras[0]?.pct_movel || 100;

  list.innerHTML = carteiras.map((c, i) => {
    const pos     = i + 1;
    const posClass = pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : '';
    const barW    = (c.pct_movel / maxPct) * 100;
    const barColor = statusColor(c.pct_movel);
    const posLabel = pos <= 3 ? ['🥇','🥈','🥉'][i] : pos;

    return `
      <div class="ranking-item">
        <div class="ranking-pos ${posClass}">${posLabel}</div>
        <div class="ranking-name">${c.carteira}</div>
        <div class="ranking-bar-wrap">
          <div class="ranking-bar" data-width="${barW}" style="width:0%;background:${barColor}"></div>
        </div>
        <div class="ranking-pct" style="color:${barColor}">${fmtPct(c.pct_movel)}</div>
      </div>`;
  }).join('');

  requestAnimationFrame(() => {
    document.querySelectorAll('.ranking-bar[data-width]').forEach((bar, i) => {
      setTimeout(() => { bar.style.width = bar.dataset.width + '%'; }, 80 * i);
    });
  });
}

function populateFilterCarteira() {
  const sel = document.getElementById('filter-carteira');
  const carteiras = [...new Set(state.abertura.map(r => r.carteira))].sort();
  carteiras.forEach(c => {
    if (!c) return;
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

// ── FILTROS + TABELA ──────────────────────────────────────────
function applyFiltersAndRender() {
  const search   = document.getElementById('search-input').value.toLowerCase().trim();
  const carteira = document.getElementById('filter-carteira').value;
  const status   = document.getElementById('filter-status').value;

  state.filtered = state.abertura.filter(row => {
    if (carteira && row.carteira !== carteira) return false;
    if (status === 'above'  && row.pct_movel <  100) return false;
    if (status === 'near'   && (row.pct_movel < 80 || row.pct_movel >= 100)) return false;
    if (status === 'below'  && row.pct_movel >= 80) return false;
    if (search) {
      const hay = `${row.polo} ${row.parceiro} ${row.analista} ${row.carteira}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Ordenação
  const numCols = ['pagantes','meta_edital','pct_edital','pct_movel'];
  state.filtered.sort((a, b) => {
    let va = a[state.sortCol], vb = b[state.sortCol];
    if (numCols.includes(state.sortCol)) {
      va = Number(va); vb = Number(vb);
    } else {
      va = String(va || '').toLowerCase();
      vb = String(vb || '').toLowerCase();
    }
    if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  document.getElementById('badge-polos-total').textContent = `${state.filtered.length} polos`;
  document.getElementById('footer-records').textContent    = `${state.abertura.length} registros totais`;

  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('polos-tbody');
  const total = state.filtered.length;
  const pages = Math.ceil(total / CONFIG.ROWS_PER_PAGE) || 1;

  state.page = Math.max(1, Math.min(state.page, pages));

  const start = (state.page - 1) * CONFIG.ROWS_PER_PAGE;
  const rows  = state.filtered.slice(start, start + CONFIG.ROWS_PER_PAGE);

  tbody.innerHTML = rows.map(r => {
    const cls   = pillClass(r.pct_movel);
    const label = pctLabel(r.pct_movel);
    return `
      <tr>
        <td class="td-polo">${r.polo}</td>
        <td>${r.parceiro || '—'}</td>
        <td class="td-carteira" title="${r.carteira}">${shortName(r.carteira, 30)}</td>
        <td class="td-analista" title="${r.analista}">${shortName(r.analista, 28)}</td>
        <td class="num">${fmt(r.pagantes)}</td>
        <td class="num">${fmt(r.meta_edital)}</td>
        <td class="num">${fmtPct(r.pct_edital)}</td>
        <td class="num">${fmtPct(r.pct_movel)}</td>
        <td class="num"><span class="pill ${cls}">${label}</span></td>
      </tr>`;
  }).join('');

  // Paginação
  setText('pagination-info', `${start + 1}–${Math.min(start + CONFIG.ROWS_PER_PAGE, total)} de ${total}`);
  setText('page-indicator',  `Pág. ${state.page} / ${pages}`);
  document.getElementById('btn-prev').disabled = state.page <= 1;
  document.getElementById('btn-next').disabled = state.page >= pages;
}

function clearFilters() {
  document.getElementById('search-input').value  = '';
  document.getElementById('filter-carteira').value = '';
  document.getElementById('filter-status').value   = '';
  state.page = 1;
  applyFiltersAndRender();
}

function updateSortUI() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === state.sortCol) {
      th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// ── ESTADOS DE UI ─────────────────────────────────────────────
function showLoading() {
  document.getElementById('loading-screen').classList.remove('hidden');
  document.getElementById('error-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('error-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
}

function showError(msg) {
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('error-screen').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('error-message').textContent = msg;
}

function updateTimestamp() {
  const now = new Date();
  const str = `Atualizado ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  setText('last-updated', str);
}

// ── HELPERS ───────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min(pct, 100) + '%';
}

function fmt(n) {
  return Number(n).toLocaleString('pt-BR');
}

function fmtPct(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function shortName(str, max) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function statusClass(pct) {
  if (pct >= 100) return 'above';
  if (pct >= 80)  return 'near';
  return 'below';
}

function statusColor(pct) {
  if (pct >= 100) return 'var(--green)';
  if (pct >= 80)  return 'var(--yellow)';
  return 'var(--red)';
}

function pillClass(pct) {
  if (pct >= 100) return 'pill-green';
  if (pct >= 80)  return 'pill-yellow';
  return 'pill-red';
}

function pctLabel(pct) {
  if (pct >= 100) return '✓ Meta';
  if (pct >= 80)  return '~ Próx.';
  return '✗ Baixo';
}
