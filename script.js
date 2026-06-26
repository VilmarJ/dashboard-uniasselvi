/* ============================================================
   CONFIGURAÇÃO
   ============================================================ */
const SPREADSHEET_ID = "10Lts1kA9GD1bjSlR1HoLi3mIJBBCXc58tf-jCgOq-lc";
const GID_CONSOLIDADO = "220239882";
const GID_ABERTURA = "0"; // ID da aba ABERTURA

const URL_CONSOLIDADO = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID_CONSOLIDADO}`;
const URL_ABERTURA = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID_ABERTURA}`;

/* ============================================================
   ELEMENTOS DOM
   ============================================================ */
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const refreshBtn = document.getElementById("refreshBtn");

const elPagantes = document.getElementById("cardPagantes");
const elMetaMovel = document.getElementById("cardMetaMovel");
const elMetaMovelPct = document.getElementById("cardMetaMovelPct");
const elMetaCiclo = document.getElementById("cardMetaCiclo");
const elMetaCicloPct = document.getElementById("cardMetaCicloPct");
const gerenciaRows = document.querySelectorAll(".gerencia-row");

// Elementos dos Filtros Superiores (Atualizados para Carteira)
const searchGeralInput = document.getElementById("searchGeral");
const carteiraSelectTrigger = document.getElementById("carteiraSelectTrigger");
const carteiraDropdown = document.getElementById("carteiraDropdown");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const polosTableBody = document.getElementById("polosTableBody");

// Elementos da Paginação
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const paginationInfo = document.getElementById("paginationInfo");

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
let dadosPolosGlobais = [];
let carteirasDisponiveis = [];
let carteirasSelecionadas = [];
let paginaAtual = 1;
const itensPorPagina = 20;

/* ============================================================
   UTILITÁRIOS E PARSERS
   ============================================================ */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        value += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function parseNumeroBR(valor) {
  if (valor === undefined || valor === null) return 0;
  let v = String(valor).trim();
  if (v === "") return 0;
  const isPercent = v.includes("%");
  v = v.replace("%", "").trim();
  v = v.replace(/\./g, "").replace(",", ".");
  const num = parseFloat(v);
  return isNaN(num) ? 0 : isPercent ? num : num;
}

function formatarNumero(num) {
  return num.toLocaleString("pt-BR");
}

function formatarPercentual(num) {
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + "%";
}

function setStatus(tipo) {
  statusDot.classList.remove("ok", "error");
  if (tipo === "ok") statusDot.classList.add("ok");
  if (tipo === "error") statusDot.classList.add("error");
}

function extrairCodigo(textoCarteira) {
  const match = String(textoCarteira).match(/\((\d+)\)\s*$/);
  return match ? match[1] : null;
}

function preencherGerencias(linhas) {
  gerenciaRows.forEach((row) => {
    const codigo = row.dataset.codigo;
    const linhaEncontrada = linhas.find(
      (linha) => extrairCodigo(linha[0]) === codigo
    );

    const elPagantesRow = row.querySelector(".gerencia-pagantes");
    const elPctRow = row.querySelector(".gerencia-pct");

    if (!linhaEncontrada) {
      elPagantesRow.textContent = "--";
      elPctRow.textContent = "--";
      return;
    }

    elPagantesRow.textContent = formatarNumero(parseNumeroBR(linhaEncontrada[1]));
    elPctRow.textContent = formatarPercentual(parseNumeroBR(linhaEncontrada[3]));
  });
}

/* ============================================================
   PROCESSAMENTO DA ABA ABERTURA (TABELA FILTRO CARTEIRA)
   ============================================================ */
function processarAbaAbertura(linhas) {
  if (linhas.length < 2) return;

  const cabecalho = linhas[0].map(c => c.trim().toUpperCase());
  
  const idxPolo = cabecalho.indexOf("POLO");
  const idxCarteira = cabecalho.indexOf("CARTEIRA");
  const idxAnalista = cabecalho.indexOf("ANALISTA");
  const idxPagantes = cabecalho.indexOf("PAGANTES");
  const idxMetaMovel = cabecalho.indexOf("META MÓVEL");
  const idxPctMovel = cabecalho.indexOf("% META MOVEL");

  dadosPolosGlobais = linhas.slice(1).map(linha => {
    return {
      polo: linha[idxPolo] || "",
      carteira: linha[idxCarteira] || "",
      analista: inlineTrim(linha[idxAnalista]),
      pagantes: parseNumeroBR(linha[idxPagantes]),
      metaMovel: parseNumeroBR(linha[idxMetaMovel]),
      pctMovel: parseNumeroBR(linha[idxPctMovel])
    };
  }).filter(item => item.polo !== "");

  // Extrai CARTEIRAS únicas ordenadas para o Dropdown superior
  carteirasDisponiveis = [...new Set(dadosPolosGlobais.map(item => item.carteira))]
                          .filter(c => c.trim() !== "")
                          .sort();

  renderizarDropdownCarteiras();
  paginaAtual = 1;
  renderizarTabelaPolos();
  renderizarRankings();
}

function inlineTrim(str) {
  return str ? String(str).replace(/\s+/g, " ").trim() : "";
}

function renderizarDropdownCarteiras() {
  carteiraDropdown.innerHTML = "";
  carteirasDisponiveis.forEach((carteira, idx) => {
    const item = document.createElement("div");
    item.className = "dropdown-item";
    item.innerHTML = `
      <input type="checkbox" id="c_${idx}" value="${carteira}">
      <label for="c_${idx}">${carteira}</label>
    `;
    
    item.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) {
        carteirasSelecionadas.push(e.target.value);
      } else {
        carteirasSelecionadas = carteirasSelecionadas.filter(c => c !== e.target.value);
      }
      atualizarTextoTrigger();
      paginaAtual = 1;
      renderizarTabelaPolos();
    });

    carteiraDropdown.appendChild(item);
  });
}

function atualizarTextoTrigger() {
  if (carteirasSelecionadas.length === 0) {
    carteiraSelectTrigger.textContent = "Todas as carteiras";
  } else if (carteirasSelecionadas.length === 1) {
    carteiraSelectTrigger.textContent = carteirasSelecionadas[0];
  } else {
    carteiraSelectTrigger.textContent = `${carteirasSelecionadas.length} carteiras sel.`;
  }
}

function renderizarTabelaPolos() {
  const busca = searchGeralInput.value.toLowerCase().trim();

  // Filtro Composto Combinado Invertido
  const dadosFiltrados = dadosPolosGlobais.filter(item => {
    // 1. Busca textual ampla apenas por Polo ou Analista
    const bateBuscaGeral = busca === "" || 
                           item.polo.toLowerCase().includes(busca) || 
                           item.analista.toLowerCase().includes(busca);

    // 2. Filtro de seleção exata estruturada por Carteira (Dropdown)
    const bateCarteira = carteirasSelecionadas.length === 0 || carteirasSelecionadas.includes(item.carteira);

    return bateBuscaGeral && bateCarteira;
  });

  const totalRegistros = dadosFiltrados.length;

  if (totalRegistros === 0) {
    polosTableBody.innerHTML = `<tr><td colspan="6" class="table-empty">Nenhum polo encontrado com os critérios selecionados.</td></tr>`;
    paginationInfo.textContent = "Mostrando 0-0 de 0 polos";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }

  const totalPaginas = Math.ceil(totalRegistros / itensPorPagina);
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;

  const indiceInicial = (paginaAtual - 1) * itensPorPagina;
  const indiceFinal = Math.min(indiceInicial + itensPorPagina, totalRegistros);
  const dadosPagina = dadosFiltrados.slice(indiceInicial, indiceFinal);

  polosTableBody.innerHTML = "";
  dadosPagina.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${item.polo}</strong></td>
      <td>${item.carteira}</td>
      <td>${item.analista}</td>
      <td class="txt-right" style="font-weight: 700; color: var(--amarelo);">${formatarNumero(item.pagantes)}</td>
      <td class="txt-right">${formatarNumero(item.metaMovel)}</td>
      <td class="txt-right" style="font-weight: 600; color: var(--texto-suave);">${formatarPercentual(item.pctMovel)}</td>
    `;
    polosTableBody.appendChild(tr);
  });

  paginationInfo.textContent = `Mostrando ${indiceInicial + 1}-${indiceFinal} de ${totalRegistros} polos (Pág. ${paginaAtual}/${totalPaginas})`;
  prevPageBtn.disabled = (paginaAtual === 1);
  nextPageBtn.disabled = (paginaAtual === totalPaginas);
}

/* ============================================================
   RANKINGS: TOP 10 PAGANTES / MAIOR META MENOR PAGAMENTO
   ============================================================ */
function renderizarRankings() {
  if (dadosPolosGlobais.length === 0) return;

  const elTopPagantes = document.getElementById("rankingTopPagantes");

  const top10 = [...dadosPolosGlobais]
    .sort((a, b) => b.pagantes - a.pagantes)
    .slice(0, 10);

  elTopPagantes.innerHTML = top10.map((item, idx) => {
    // Define a cor da posição do pódio (1º, 2º e 3º)
    let corRank = "color: var(--texto-suave); opacity: 0.6; font-weight: 800;";
    if (idx === 0) corRank = "color: #FFD700; font-weight: 800; font-size: 1rem;";
    if (idx === 1) corRank = "color: #C0C0C0; font-weight: 800;";
    if (idx === 2) corRank = "color: #CD7F32; font-weight: 800;";

    return `
      <tr>
        <td style="text-align: center; ${corRank}">${idx + 1}</td>
        <td>
          <div class="ranking-polo-nome" style="font-size: 0.88rem;" title="${item.polo}"><strong>${item.polo}</strong></div>
          <div class="ranking-polo-carteira" style="font-size: 0.75rem; color: var(--texto-suave); margin-top: 2px;">${item.carteira}</div>
        </td>
        <td class="txt-right" style="font-weight: 800; color: var(--amarelo); font-size: 0.95rem; padding-right: 63px;">
          ${formatarNumero(item.pagantes)}
        </td>
        <td class="txt-right" style="padding-right: 24px;">
          <span class="ranking-pct ${item.pctMovel < 80 ? 'ranking-pct--danger' : 'ranking-pct--warn'}" style="display: inline-block; min-width: 70px; text-align: center;">
            ${formatarPercentual(item.pctMovel)}
          </span>
        </td>
      </tr>
    `;
  }).join("");
}


async function carregarDashboard() {
  setStatus("loading");
  try {
    const [resConsolidado, resAbertura] = await Promise.all([
      fetch(URL_CONSOLIDADO),
      fetch(URL_ABERTURA)
    ]);

    if (!resConsolidado.ok || !resAbertura.ok) throw new Error("Erro de conexão.");

    const txtConsolidado = await resConsolidado.text();
    const txtAbertura = await resAbertura.text();

    const linhasConsolidado = parseCSV(txtConsolidado);
    const linhasAbertura = parseCSV(txtAbertura);

    const linhaGeral = linhasConsolidado.find((linha) =>
      linha[0] && linha[0].trim().toUpperCase().startsWith("GERAL")
    );

    if (!linhaGeral) throw new Error("Linha de totais ausente.");

    elPagantes.textContent = formatarNumero(parseNumeroBR(linhaGeral[1]));
    elMetaMovel.textContent = formatarNumero(parseNumeroBR(linhaGeral[2]));
    elMetaMovelPct.textContent = formatarPercentual(parseNumeroBR(linhaGeral[3]));
    elMetaCiclo.textContent = formatarNumero(parseNumeroBR(linhaGeral[4]));
    elMetaCicloPct.textContent = formatarPercentual(parseNumeroBR(linhaGeral[5]));

    preencherGerencias(linhasConsolidado);
    processarAbaAbertura(linhasAbertura);

    const agora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    statusText.textContent = agora;
    setStatus("ok");
  } catch (erro) {
    console.error(erro);
    statusText.textContent = "--:--";
    setStatus("error");
  }
}

/* ============================================================
   EVENTOS E INTERAÇÕES
   ============================================================ */
searchGeralInput.addEventListener("input", () => {
  paginaAtual = 1;
  renderizarTabelaPolos();
});

// Abre/Fecha o select customizado de carteiras
carteiraSelectTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  carteiraDropdown.classList.toggle("open");
});

// Fecha o select se clicar fora dele
document.addEventListener("click", () => {
  carteiraDropdown.classList.remove("open");
});
carteiraDropdown.addEventListener("click", (e) => e.stopPropagation());

// Botão Limpar Filtros
clearFiltersBtn.addEventListener("click", () => {
  searchGeralInput.value = "";
  carteirasSelecionadas = [];
  document.querySelectorAll(".dropdown-item input").forEach(chk => chk.checked = false);
  atualizarTextoTrigger();
  paginaAtual = 1;
  renderizarTabelaPolos();
});

// Controles da Paginação
prevPageBtn.addEventListener("click", () => {
  if (paginaAtual > 1) { paginaAtual--; renderizarTabelaPolos(); }
});
nextPageBtn.addEventListener("click", () => {
  const totalRegistrosFiltrados = dadosPolosGlobais.filter(item => {
    const busca = searchGeralInput.value.toLowerCase().trim();
    const bateBuscaGeral = busca === "" || item.polo.toLowerCase().includes(busca) || item.analista.toLowerCase().includes(busca);
    const bateCarteira = carteirasSelecionadas.length === 0 || carteirasSelecionadas.includes(item.carteira);
    return bateBuscaGeral && bateCarteira;
  }).length;
  
  if (paginaAtual < Math.ceil(totalRegistrosFiltrados / itensPorPagina)) {
    paginaAtual++; 
    renderizarTabelaPolos();
  }
});

refreshBtn.addEventListener("click", () => {
  refreshBtn.classList.add("spinning");
  carregarDashboard().finally(() => {
    setTimeout(() => refreshBtn.classList.remove("spinning"), 500);
  });
});

document.addEventListener("DOMContentLoaded", carregarDashboard);