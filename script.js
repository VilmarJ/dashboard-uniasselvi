/* ============================================================
   CONFIGURAÇÃO
   ============================================================ */
const SPREADSHEET_ID  = "10Lts1kA9GD1bjSlR1HoLi3mIJBBCXc58tf-jCgOq-lc";
const GID_POLO        = "0";           // Aba POLO (primeira aba)
const GID_CONSOLIDADO = "220239882";   // Aba CONSOLIDADO

const URL_POLO        = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID_POLO}`;
const URL_CONSOLIDADO = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID_CONSOLIDADO}`;

/* ============================================================
   ELEMENTOS DOM
   ============================================================ */
const statusDot    = document.getElementById("statusDot");
const statusText   = document.getElementById("statusText");
const refreshBtn   = document.getElementById("refreshBtn");

// Cards do topo: Volume Geral | Meta Móvel | % Meta Móvel | Meta Edital | % Meta Edital
const elPagantes      = document.getElementById("cardPagantes");
const elMetaMovel     = document.getElementById("cardMetaMovel");
const elMetaMovelPct  = document.getElementById("cardMetaMovelPct");
const elMetaEdital    = document.getElementById("cardMetaEdital");
const elMetaEditalPct = document.getElementById("cardMetaEditalPct");

const gerenciaRows    = document.querySelectorAll(".gerencia-row");
const gerenciaExportBtns = document.querySelectorAll(".gerencia-export-btn");

const searchGeralInput      = document.getElementById("searchGeral");
const carteiraSelectTrigger = document.getElementById("carteiraSelectTrigger");
const carteiraDropdown      = document.getElementById("carteiraDropdown");
const clearFiltersBtn       = document.getElementById("clearFiltersBtn");
const polosTableBody        = document.getElementById("polosTableBody");

const prevPageBtn    = document.getElementById("prevPageBtn");
const nextPageBtn    = document.getElementById("nextPageBtn");
const paginationInfo = document.getElementById("paginationInfo");

const exportExcelBtn   = document.getElementById("exportExcelBtn");
const exportExcelLabel = document.getElementById("exportExcelLabel");

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
let dadosPolosGlobais     = [];
let carteirasDisponiveis  = [];
let carteirasSelecionadas = [];
let paginaAtual           = 1;
const itensPorPagina      = 20;

/* ============================================================
   UTILITÁRIOS
   ============================================================ */

/** Parser CSV robusto — lida com campos entre aspas e quebras de linha. */
function parseCSV(text) {
  const rows = [];
  let row = [], value = "", insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i], nextChar = text[i + 1];
    if (char === '"') {
      if (insideQuotes && nextChar === '"') { value += '"'; i++; }
      else insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      row.push(value); value = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      row.push(value); rows.push(row);
      row = []; value = "";
    } else {
      value += char;
    }
  }
  if (value !== "" || row.length > 0) { row.push(value); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

/** Converte número BR ("1.234,56" ou "12,5%") para float. */
function parseNumeroBR(valor) {
  if (valor == null) return 0;
  let v = String(valor).trim().replace("%", "").trim();
  if (v === "") return 0;
  v = v.replace(/\./g, "").replace(",", ".");
  const num = parseFloat(v);
  return isNaN(num) ? 0 : num;
}

function formatarNumero(num) {
  return Math.round(num).toLocaleString("pt-BR");
}

function formatarPercentual(num) {
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + "%";
}

function inlineTrim(str) {
  return str ? String(str).replace(/\s+/g, " ").trim() : "";
}

/** Escapa caracteres HTML perigosos antes de injetar texto vindo da planilha via innerHTML. */
function escapeHTML(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Verifica se o nome de uma carteira "bate" com o termo de busca (data-busca),
 * evitando falso positivo quando um nome é prefixo de outro
 * (ex: "Operações I" é substring de "Operações II").
 * Considera match apenas se for igual, ou se `busca` aparecer como palavra
 * inteira (delimitada por espaço/início/fim) dentro do nome da carteira.
 */
function carteiraCorresponde(nomeCarteira, busca) {
  const nome  = normalizar(nomeCarteira);
  const alvo  = normalizar(busca);
  if (nome === alvo) return true;
  const regex = new RegExp(`(^|\\s)${alvo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`);
  return regex.test(nome);
}

/** Mapeia colunas do cabeçalho por nome normalizado (sem acentos, maiúsculas). */
function mapearColunas(cabecalho) {
  const idx = {};
  cabecalho.forEach((col, i) => {
    const chave = col.trim()
      .toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
    idx[chave] = i;
  });
  return idx;
}

/* ============================================================
   STATUS
   ============================================================ */
function setStatus(tipo) {
  statusDot.classList.remove("ok", "error");
  if (tipo === "ok")    statusDot.classList.add("ok");
  if (tipo === "error") statusDot.classList.add("error");
}

/* ============================================================
   CONSOLIDADO — KPIs do topo e gerências
   ============================================================ */

/**
 * Extrai o código numérico do final de uma string de carteira.
 * Ex: "Gerente Florença - Kelly Strutz (100000090)" → "100000090"
 */
function extrairCodigo(textoCarteira) {
  const match = String(textoCarteira).match(/\((\d+)\)\s*$/);
  return match ? match[1] : null;
}

/** Normaliza texto para comparação: maiúsculas, sem acentos, sem espaços nas pontas. */
function normalizar(str) {
  return String(str).trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Preenche linhas de gerência/carteira a partir do Consolidado.
 *
 * Estratégia de busca (por prioridade):
 * 1. Se o elemento tiver data-busca, usa como substring do nome da linha
 *    — resolve casos onde dois registros têm o mesmo código (ex: Operações I e II).
 * 2. Caso contrário, cai no código numérico via data-codigo.
 */
function preencherGerencias(linhas) {
  if (linhas.length < 2) return;
  const idx   = mapearColunas(linhas[0]);
  const dados = linhas.slice(1);

  gerenciaRows.forEach(row => {
    const busca  = row.dataset.busca  || "";
    const codigo = row.dataset.codigo || "";

    const linhaEncontrada = busca
      ? dados.find(l => carteiraCorresponde(l[idx["CARTEIRA"]], busca))
      : dados.find(l => extrairCodigo(l[idx["CARTEIRA"]]) === codigo);

    const elPag         = row.querySelector(".gerencia-pagantes");
    const elMetaMovel    = row.querySelector(".gerencia-metamovel");
    const elPct          = row.querySelector(".gerencia-pct");
    const elMetaEdital    = row.querySelector(".gerencia-metaedital");
    const elPctEdital    = row.querySelector(".gerencia-pctedital");

    if (!linhaEncontrada) {
      elPag.textContent = "--";
      if (elMetaMovel)  elMetaMovel.textContent  = "--";
      elPct.textContent = "--";
      if (elMetaEdital) elMetaEdital.textContent = "--";
      if (elPctEdital)  elPctEdital.textContent  = "--";
      return;
    }

    elPag.textContent = formatarNumero(parseNumeroBR(linhaEncontrada[idx["PAGANTES"]]));
    if (elMetaMovel)  elMetaMovel.textContent  = formatarNumero(parseNumeroBR(linhaEncontrada[idx["META MOVEL"]]));
    elPct.textContent = formatarPercentual(parseNumeroBR(linhaEncontrada[idx["% META MOVEL"]]));
    if (elMetaEdital) elMetaEdital.textContent = formatarNumero(parseNumeroBR(linhaEncontrada[idx["META EDITAL"]]));
    if (elPctEdital)  elPctEdital.textContent  = formatarPercentual(parseNumeroBR(linhaEncontrada[idx["% META EDITAL"]]));
  });
}

/* ============================================================
   ABA POLO — processa, filtra e pagina
   Colunas: COD_POLO | POLO | PARCEIRO | CARTEIRA | ANALISTA |
            PAGANTES | META EDITAL | % META EDITAL |
            META MOVEL | % META MOVEL | META CICLO | % META CICLO
   ============================================================ */
function processarAbaPolo(linhas) {
  if (linhas.length < 2) return;
  const idx = mapearColunas(linhas[0]);

  dadosPolosGlobais = linhas.slice(1).map(l => ({
    codPolo:    inlineTrim(l[idx["COD_POLO"]]      ?? ""),
    polo:       inlineTrim(l[idx["POLO"]]          ?? ""),
    parceiro:   inlineTrim(l[idx["PARCEIRO"]]      ?? ""),
    carteira:   inlineTrim(l[idx["CARTEIRA"]]      ?? ""),
    analista:   inlineTrim(l[idx["ANALISTA"]]      ?? ""),
    pagantes:   parseNumeroBR(l[idx["PAGANTES"]]        ?? ""),
    metaMovel:  parseNumeroBR(l[idx["META MOVEL"]]      ?? ""),
    pctMovel:   parseNumeroBR(l[idx["% META MOVEL"]]    ?? ""),
    metaEdital: parseNumeroBR(l[idx["META EDITAL"]]     ?? ""),
    pctEdital:  parseNumeroBR(l[idx["% META EDITAL"]]   ?? ""),
    metaCiclo:  parseNumeroBR(l[idx["META CICLO"]]      ?? ""),
    pctCiclo:   parseNumeroBR(l[idx["% META CICLO"]]    ?? ""),
  })).filter(item => item.polo !== "");

  // Carteiras únicas para dropdown
  carteirasDisponiveis = [...new Set(dadosPolosGlobais.map(i => i.carteira))]
    .filter(c => c.trim() !== "")
    .sort();

  renderizarDropdownCarteiras();
  paginaAtual = 1;
  renderizarTabelaPolos();
  renderizarInsights();
}

/* ============================================================
   DROPDOWN DE CARTEIRAS
   ============================================================ */
function renderizarDropdownCarteiras() {
  carteiraDropdown.innerHTML = "";
  carteirasDisponiveis.forEach((carteira, i) => {
    const item = document.createElement("div");
    item.className = "dropdown-item";
    item.innerHTML = `
      <input type="checkbox" id="c_${i}" value="${escapeHTML(carteira)}">
      <label for="c_${i}">${escapeHTML(carteira)}</label>
    `;
    item.querySelector("input").addEventListener("change", e => {
      if (e.target.checked) carteirasSelecionadas.push(e.target.value);
      else carteirasSelecionadas = carteirasSelecionadas.filter(c => c !== e.target.value);
      atualizarTextoTrigger();
      paginaAtual = 1;
      renderizarTabelaPolos();
    });
    carteiraDropdown.appendChild(item);
  });
}

function atualizarTextoTrigger() {
  if (carteirasSelecionadas.length === 0)       carteiraSelectTrigger.textContent = "Todas as carteiras";
  else if (carteirasSelecionadas.length === 1)  carteiraSelectTrigger.textContent = carteirasSelecionadas[0];
  else carteiraSelectTrigger.textContent = `${carteirasSelecionadas.length} carteiras sel.`;
}

/* ============================================================
   TABELA DE POLOS
   ============================================================ */
function getDadosFiltrados() {
  const busca = searchGeralInput.value.toLowerCase().trim();
  return dadosPolosGlobais.filter(item => {
    const bateBusca    = busca === ""
      || item.polo.toLowerCase().includes(busca)
      || item.analista.toLowerCase().includes(busca)
      || item.carteira.toLowerCase().includes(busca);
    const bateCarteira = carteirasSelecionadas.length === 0
      || carteirasSelecionadas.includes(item.carteira);
    return bateBusca && bateCarteira;
  });
}

function renderizarTabelaPolos() {
  const dados  = getDadosFiltrados();
  const total  = dados.length;

  atualizarBotaoExport(total);

  if (total === 0) {
    polosTableBody.innerHTML = `<tr><td colspan="6" class="table-empty">Nenhum polo encontrado com os critérios selecionados.</td></tr>`;
    paginationInfo.textContent = "Mostrando 0–0 de 0 polos";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }

  const totalPags = Math.ceil(total / itensPorPagina);
  if (paginaAtual > totalPags) paginaAtual = totalPags;

  const ini    = (paginaAtual - 1) * itensPorPagina;
  const fim    = Math.min(ini + itensPorPagina, total);
  const pagina = dados.slice(ini, fim);

  polosTableBody.innerHTML = "";
  pagina.forEach(item => {
    const corPct = item.pctMovel >= 100 ? "var(--verde-ok)"
                 : item.pctMovel >= 80  ? "var(--amarelo)"
                 : "var(--vermelho-alerta)";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHTML(item.polo)}</strong></td>
      <td>${escapeHTML(item.carteira)}</td>
      <td>${escapeHTML(item.analista)}</td>
      <td class="txt-right" style="font-weight:700; color:var(--amarelo);">${formatarNumero(item.pagantes)}</td>
      <td class="txt-right">${formatarNumero(item.metaMovel)}</td>
      <td class="txt-right" style="font-weight:700; color:${corPct};">${formatarPercentual(item.pctMovel)}</td>
    `;
    polosTableBody.appendChild(tr);
  });

  paginationInfo.textContent = `Mostrando ${ini + 1}–${fim} de ${total} polos (Pág. ${paginaAtual}/${totalPags})`;
  prevPageBtn.disabled = paginaAtual === 1;
  nextPageBtn.disabled = paginaAtual === totalPags;
}

/* ============================================================
   EXPORTAÇÃO PARA EXCEL
   Duas formas de exportar, ambas usando a mesma planilha-base:
   1. Botão da tabela "Visão Detalhada dos Polos": exporta os
      polos que estão passando pelos filtros ativos (busca +
      carteiras selecionadas).
   2. Botão discreto em cada linha de "Carteiras e Operações":
      exporta todos os polos daquela carteira/operação específica,
      usando o mesmo vínculo (código ou nome) já usado para
      preencher Pagantes/% Meta Móvel da linha.
   Em ambos os casos, todas as colunas da aba POLO são exportadas
   — não apenas as exibidas na tela.
   ============================================================ */
function atualizarBotaoExport(totalFiltrado) {
  if (!exportExcelBtn) return;
  exportExcelBtn.disabled = totalFiltrado === 0;
  exportExcelLabel.textContent = totalFiltrado > 0
    ? `Exportar Excel (${totalFiltrado})`
    : "Exportar Excel";
}

/** Monta e baixa o arquivo .xlsx a partir de uma lista de polos (itens de dadosPolosGlobais). */
function gerarPlanilhaExcel(dados, nomeArquivoBase) {
  const linhasExport = dados.map(item => ({
    "COD_POLO":        item.codPolo,
    "POLO":            item.polo,
    "PARCEIRO":        item.parceiro,
    "CARTEIRA":        item.carteira,
    "ANALISTA":        item.analista,
    "PAGANTES":        item.pagantes,
    "META EDITAL":     item.metaEdital,
    "% META EDITAL":   item.pctEdital / 100,
    "META MÓVEL":      item.metaMovel,
    "% META MÓVEL":    item.pctMovel / 100,
    "META CICLO":      item.metaCiclo,
    "% META CICLO":    item.pctCiclo / 100,
  }));

  const worksheet = XLSX.utils.json_to_sheet(linhasExport);

  // Largura das colunas para leitura confortável
  worksheet["!cols"] = [
    { wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 26 }, { wch: 24 },
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 },
  ];

  // Formata as colunas de percentual como % nativo do Excel
  const colunasPercentual = ["H", "J", "L"]; // % META EDITAL, % META MÓVEL, % META CICLO
  const totalLinhas = linhasExport.length;
  colunasPercentual.forEach(col => {
    for (let r = 2; r <= totalLinhas + 1; r++) {
      const cell = worksheet[`${col}${r}`];
      if (cell) cell.z = "0.00%";
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Polos");

  const agora   = new Date();
  const dataStr = agora.toLocaleDateString("pt-BR").split("/").join("-");
  const horaStr = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");

  XLSX.writeFile(workbook, `${nomeArquivoBase}_${dataStr}_${horaStr}.xlsx`);
}

function exportarPolosParaExcel() {
  const dados = getDadosFiltrados();
  if (dados.length === 0) return;

  const sufixoFiltro = (searchGeralInput.value.trim() || carteirasSelecionadas.length > 0) ? "_filtrado" : "";
  gerarPlanilhaExcel(dados, `polos_uniasselvi${sufixoFiltro}`);
}

exportExcelBtn.addEventListener("click", exportarPolosParaExcel);

/**
 * Filtra os polos (aba POLO) que pertencem à carteira/operação de uma
 * linha de "Carteiras e Operações", usando o mesmo vínculo já usado por
 * preencherGerencias(): data-busca (substring) tem prioridade sobre
 * data-codigo (código numérico entre parênteses no nome da carteira).
 */
function filtrarPolosPorGerencia(row) {
  const busca  = row.dataset.busca  || "";
  const codigo = row.dataset.codigo || "";

  return busca
    ? dadosPolosGlobais.filter(item => carteiraCorresponde(item.carteira, busca))
    : dadosPolosGlobais.filter(item => extrairCodigo(item.carteira) === codigo);
}

/** Converte o nome da gerência em um nome de arquivo seguro. */
function slugificar(texto) {
  return normalizar(texto)
    .replace(/[^A-Z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function exportarPolosDaGerencia(row) {
  const nomeGerencia = row.querySelector(".gerencia-nome").childNodes[0].textContent.trim();

  if (dadosPolosGlobais.length === 0) {
    alert("Os dados ainda estão carregando. Aguarde e tente novamente.");
    return;
  }

  const dados = filtrarPolosPorGerencia(row);
  if (dados.length === 0) {
    alert(`Nenhum polo encontrado na aba POLO para "${nomeGerencia}".`);
    return;
  }

  gerarPlanilhaExcel(dados, `polos_${slugificar(nomeGerencia)}`);
}

gerenciaExportBtns.forEach(btn => {
  btn.addEventListener("click", e => {
    e.stopPropagation();
    exportarPolosDaGerencia(btn.closest(".gerencia-row"));
  });
});

/* ============================================================
   INSIGHTS — Destaques positivos e pontos de melhoria
   Positivos  : polos com pctMovel >= 100% (ordenados por pct desc)
   Melhorias  : polos com pctMovel < 50%   (ordenados por pct asc)
   ============================================================ */
function renderizarInsights() {
  if (dadosPolosGlobais.length === 0) return;

  const elPositivos = document.getElementById("insightPositivos");
  const elMelhorias = document.getElementById("insightMelhorias");
  const total       = dadosPolosGlobais.length;

  /* ══════════════════════════════════════════════
     DADOS PRÉ-CALCULADOS
  ══════════════════════════════════════════════ */

  // Polos acima de 100% da Meta Móvel
  const acimaDaMeta = [...dadosPolosGlobais]
    .filter(i => i.pctMovel >= 100)
    .sort((a, b) => b.pctMovel - a.pctMovel);

  // Maior volume absoluto de pagantes
  const maiorVolume = [...dadosPolosGlobais]
    .sort((a, b) => b.pagantes - a.pagantes)[0];

  // Melhor % Meta Edital
  const maiorPctEdital = [...dadosPolosGlobais]
    .filter(i => i.pctEdital > 0)
    .sort((a, b) => b.pctEdital - a.pctEdital)[0];

  // Melhor % Meta Ciclo (polo mais próximo de bater a Meta Ciclo)
  const maiorPctCiclo = [...dadosPolosGlobais]
    .filter(i => i.pctCiclo > 0)
    .sort((a, b) => b.pctCiclo - a.pctCiclo)[0];

  // Carteira com mais polos acima de 100%
  const contagemPorCarteira = {};
  acimaDaMeta.forEach(p => {
    contagemPorCarteira[p.carteira] = (contagemPorCarteira[p.carteira] || 0) + 1;
  });
  const melhorCarteira = Object.entries(contagemPorCarteira)
    .sort((a, b) => b[1] - a[1])[0];

  // Polos abaixo de 50% da Meta Móvel — considera apenas polos com base
  // relevante (Meta Edital >= CORTE_BASE_MELHORIA), evitando que polos
  // pequenos (ex: 2 alunos) distorçam o percentual e virem "falso alarme"
  const CORTE_BASE_MELHORIA = 70;
  const elegiveisMelhoria   = dadosPolosGlobais.filter(i => i.metaEdital >= CORTE_BASE_MELHORIA);

  const abaixo50 = [...elegiveisMelhoria]
    .filter(i => i.pctMovel < 50)
    .sort((a, b) => a.pctMovel - b.pctMovel);

  // Polo com maior gap absoluto (mais pagantes faltando), só entre relevantes
  const maiorGap = elegiveisMelhoria.length > 0
    ? elegiveisMelhoria
        .map(i => ({ ...i, gap: Math.max(0, i.metaMovel - i.pagantes) }))
        .sort((a, b) => b.gap - a.gap)[0]
    : null;

  // Polo com maior meta mas pior % (potencial desperdiçado), só entre relevantes:
  // entre os polos com metaMovel no quartil superior, pegar o pior pctMovel
  const metaOrdenada = [...elegiveisMelhoria].sort((a, b) => b.metaMovel - a.metaMovel);
  const corteQuartil = Math.floor(metaOrdenada.length * 0.25);
  const grandesMetas = metaOrdenada.slice(0, Math.max(corteQuartil, 5));
  const potencialDesperdico = grandesMetas.length > 0
    ? [...grandesMetas].sort((a, b) => a.pctMovel - b.pctMovel)[0]
    : null;

  // Carteira com mais polos críticos (abaixo de 50%, base relevante)
  const criticosPorCarteira = {};
  abaixo50.forEach(p => {
    criticosPorCarteira[p.carteira] = (criticosPorCarteira[p.carteira] || 0) + 1;
  });
  const piorCarteira = Object.entries(criticosPorCarteira)
    .sort((a, b) => b[1] - a[1])[0];

  /* ══════════════════════════════════════════════
     DESTAQUES POSITIVOS (6 insights fixos)
  ══════════════════════════════════════════════ */
  const positivos = [];

  // 1. Totalizador: polos acima de 100%
  if (acimaDaMeta.length > 0) {
    const s = acimaDaMeta.length === 1;
    positivos.push({
      icone: "✅",
      titulo: `${acimaDaMeta.length} polo${s ? "" : "s"} ${s ? "atingiu" : "atingiram"} 100% da Meta Móvel`,
      detalhe: `${((acimaDaMeta.length / total) * 100).toFixed(1)}% do total de polos ativos estão na meta`,
    });
  } else {
    positivos.push({
      icone: "🎯",
      titulo: "Nenhum polo atingiu 100% ainda",
      detalhe: "Acompanhe o progresso na tabela de polos abaixo",
    });
  }

  // 2. Top 1 polo por % Meta Móvel
  if (acimaDaMeta.length > 0) {
    const top = acimaDaMeta[0];
    positivos.push({
      icone: "🏅",
      titulo: `Destaque Meta Móvel: ${top.polo}`,
      detalhe: `${formatarPercentual(top.pctMovel)} atingido — ${formatarNumero(top.pagantes)} pagantes`,
      sub: top.carteira,
    });
  }

  // 3. Maior volume absoluto de pagantes
  if (maiorVolume) {
    positivos.push({
      icone: "📈",
      titulo: `Maior volume: ${maiorVolume.polo}`,
      detalhe: `${formatarNumero(maiorVolume.pagantes)} pagantes — ${formatarPercentual(maiorVolume.pctMovel)} da Meta Móvel`,
      sub: maiorVolume.carteira,
    });
  }

  // 4. Melhor % Meta Edital
  if (maiorPctEdital) {
    positivos.push({
      icone: "📋",
      titulo: `Melhor % Meta Edital: ${maiorPctEdital.polo}`,
      detalhe: `${formatarPercentual(maiorPctEdital.pctEdital)} da Meta Edital atingido`,
      sub: maiorPctEdital.carteira,
    });
  }

  // 5. Polo mais próximo de bater a Meta Ciclo
  if (maiorPctCiclo) {
    positivos.push({
      icone: "🔄",
      titulo: `Líder na Meta Ciclo: ${maiorPctCiclo.polo}`,
      detalhe: `${formatarPercentual(maiorPctCiclo.pctCiclo)} da Meta Ciclo — ${formatarNumero(maiorPctCiclo.pagantes)} pagantes`,
      sub: maiorPctCiclo.carteira,
    });
  }

  // 6. Carteira com mais polos acima de 100%
  if (melhorCarteira) {
    positivos.push({
      icone: "🗂️",
      titulo: `Carteira destaque: ${melhorCarteira[0]}`,
      detalhe: `${melhorCarteira[1]} polo${melhorCarteira[1] > 1 ? "s" : ""} acima de 100% da Meta Móvel`,
    });
  }

  elPositivos.innerHTML = positivos.map(renderInsightItem).join("");

  /* ══════════════════════════════════════════════
     PONTOS DE MELHORIA (6 insights fixos)
  ══════════════════════════════════════════════ */
  const melhorias = [];

  // 1. Totalizador: polos abaixo de 50% (apenas com base relevante)
  if (abaixo50.length > 0) {
    const s = abaixo50.length === 1;
    const pctBase = elegiveisMelhoria.length > 0
      ? ((abaixo50.length / elegiveisMelhoria.length) * 100).toFixed(1)
      : "0.0";
    melhorias.push({
      icone: "⚠️",
      titulo: `${abaixo50.length} polo${s ? "" : "s"} abaixo de 50% da Meta Móvel`,
      detalhe: `${pctBase}% dos polos com base consolidada precisam de atenção prioritária`,
    });
  } else {
    melhorias.push({
      icone: "👏",
      titulo: "Nenhum polo com base consolidada abaixo de 50% da Meta Móvel",
      detalhe: "Todos os polos com Meta Edital relevante estão acima do limiar crítico",
    });
  }

  // 2. Pior polo por % Meta Móvel (abaixo de 50%)
  if (abaixo50.length > 0) {
    const pior = abaixo50[0];
    const gap  = Math.max(0, pior.metaMovel - pior.pagantes);
    melhorias.push({
      icone: "🔴",
      titulo: `Situação crítica: ${pior.polo}`,
      detalhe: `${formatarPercentual(pior.pctMovel)} atingido — faltam ${formatarNumero(gap)} pagantes para a meta`,
      sub: pior.carteira,
    });
  }

  // 3. Polo com maior gap absoluto de pagantes
  if (maiorGap && maiorGap.gap > 0) {
    melhorias.push({
      icone: "📉",
      titulo: `Maior gap absoluto: ${maiorGap.polo}`,
      detalhe: `Faltam ${formatarNumero(maiorGap.gap)} pagantes para atingir a Meta Móvel`,
      sub: maiorGap.carteira,
    });
  }

  // 4. Polo com grande meta mas baixo aproveitamento
  if (potencialDesperdico) {
    melhorias.push({
      icone: "⚡",
      titulo: `Potencial não aproveitado: ${potencialDesperdico.polo}`,
      detalhe: `Meta Móvel de ${formatarNumero(potencialDesperdico.metaMovel)} pagantes, mas apenas ${formatarPercentual(potencialDesperdico.pctMovel)} atingido`,
      sub: potencialDesperdico.carteira,
    });
  }

  // 5. Carteira com mais polos críticos
  if (piorCarteira) {
    melhorias.push({
      icone: "🗂️",
      titulo: `Carteira com mais críticos: ${piorCarteira[0]}`,
      detalhe: `${piorCarteira[1]} polo${piorCarteira[1] > 1 ? "s" : ""} abaixo de 50% da Meta Móvel nesta carteira`,
    });
  }

  // 6. Quantidade restante de polos críticos além dos já citados
  if (abaixo50.length > 1) {
    melhorias.push({
      icone: "📋",
      titulo: `${abaixo50.length - 1} outros polos abaixo de 50%`,
      detalhe: `Use a busca na tabela abaixo para localizar e filtrar por carteira`,
    });
  } else if (abaixo50.length === 0) {
    melhorias.push({
      icone: "📊",
      titulo: "Monitore os polos entre 50% e 80%",
      detalhe: `${dadosPolosGlobais.filter(i => i.pctMovel >= 50 && i.pctMovel < 80).length} polos ainda abaixo de 80% da Meta Móvel`,
    });
  }

  elMelhorias.innerHTML = melhorias.map(renderInsightItem).join("");
}

function renderInsightItem(item) {
  return `
    <li class="insight-item">
      <span class="insight-icone">${item.icone}</span>
      <div class="insight-body">
        <span class="insight-titulo">${escapeHTML(item.titulo)}</span>
        <span class="insight-detalhe">${escapeHTML(item.detalhe)}</span>
        ${item.sub ? `<span class="insight-sub">${escapeHTML(item.sub)}</span>` : ""}
      </div>
    </li>
  `;
}

/* ============================================================
   CARGA PRINCIPAL
   ============================================================ */
async function carregarDashboard() {
  setStatus("loading");
  try {
    const [resConsolidado, resPolo] = await Promise.all([
      fetch(URL_CONSOLIDADO),
      fetch(URL_POLO),
    ]);
    if (!resConsolidado.ok || !resPolo.ok) throw new Error("Erro de conexão com a planilha.");

    const linhasConsolidado = parseCSV(await resConsolidado.text());
    const linhasPolo        = parseCSV(await resPolo.text());

    // ── KPIs: usa a linha "GERAL - TOTAL (BASE DE DADOS)" (A17) ──
    // Busca pela linha que contém "TOTAL" para garantir robustez
    const linhaGeral = linhasConsolidado.find(l =>
      l[0] && l[0].trim().toUpperCase().includes("TOTAL")
    );
    if (!linhaGeral) throw new Error("Linha GERAL - TOTAL não encontrada no Consolidado.");

    const idxC = mapearColunas(linhasConsolidado[0]);

    // Sequência: Volume Geral | Meta Móvel | % Meta Móvel | Meta Edital | % Meta Edital
    elPagantes.textContent      = formatarNumero(parseNumeroBR(linhaGeral[idxC["PAGANTES"]]));
    elMetaMovel.textContent     = formatarNumero(parseNumeroBR(linhaGeral[idxC["META MOVEL"]]));
    elMetaMovelPct.textContent  = formatarPercentual(parseNumeroBR(linhaGeral[idxC["% META MOVEL"]]));
    elMetaEdital.textContent    = formatarNumero(parseNumeroBR(linhaGeral[idxC["META EDITAL"]]));
    elMetaEditalPct.textContent = formatarPercentual(parseNumeroBR(linhaGeral[idxC["% META EDITAL"]]));

    // ── Gerências ──
    preencherGerencias(linhasConsolidado);

    // ── Polos + Insights ──
    processarAbaPolo(linhasPolo);

    statusText.textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    setStatus("ok");

  } catch (erro) {
    console.error("[Dashboard] Erro ao carregar dados:", erro);
    statusText.textContent = "--:--";
    setStatus("error");
  }
}

/* ============================================================
   EVENTOS
   ============================================================ */
searchGeralInput.addEventListener("input", () => { paginaAtual = 1; renderizarTabelaPolos(); });

carteiraSelectTrigger.addEventListener("click", e => {
  e.stopPropagation();
  carteiraDropdown.classList.toggle("open");
});
document.addEventListener("click", () => carteiraDropdown.classList.remove("open"));
carteiraDropdown.addEventListener("click", e => e.stopPropagation());

clearFiltersBtn.addEventListener("click", () => {
  searchGeralInput.value = "";
  carteirasSelecionadas  = [];
  document.querySelectorAll(".dropdown-item input").forEach(chk => chk.checked = false);
  atualizarTextoTrigger();
  paginaAtual = 1;
  renderizarTabelaPolos();
});

prevPageBtn.addEventListener("click", () => {
  if (paginaAtual > 1) { paginaAtual--; renderizarTabelaPolos(); }
});
nextPageBtn.addEventListener("click", () => {
  if (paginaAtual < Math.ceil(getDadosFiltrados().length / itensPorPagina)) {
    paginaAtual++; renderizarTabelaPolos();
  }
});

refreshBtn.addEventListener("click", () => {
  refreshBtn.classList.add("spinning");
  carregarDashboard().finally(() => setTimeout(() => refreshBtn.classList.remove("spinning"), 500));
});

document.addEventListener("DOMContentLoaded", carregarDashboard);