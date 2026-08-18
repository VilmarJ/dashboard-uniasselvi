/* ============================================================
   CONFIGURAÇÃO
   ============================================================ */
const SPREADSHEET_ID  = "10Lts1kA9GD1bjSlR1HoLi3mIJBBCXc58tf-jCgOq-lc";
const GID_POLO        = "1827818115";           // Aba POLO (primeira aba)
const GID_CONSOLIDADO = "778246193";   // Aba CONSOLIDADO
const GID_ALUNO       = "976609691";   // Aba ALUNO (carregada sob demanda, apenas ao exportar)

const URL_POLO        = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID_POLO}`;
const URL_CONSOLIDADO = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID_CONSOLIDADO}`;
const URL_ALUNO       = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID_ALUNO}`; // Lazy: só usado no export

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

// Modal de progresso de exportação (compartilhado pelos dois tipos de export)
const exportModalOverlay = document.getElementById("exportModalOverlay");
const exportModalSub     = document.getElementById("exportModalSub");
const exportModalSteps   = document.querySelectorAll("#exportModalSteps .export-step");

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
let dadosPolosGlobais     = [];
let dadosAlunosGlobais    = [];   // Linhas brutas da aba ALUNO (sem cabeçalho) — carregado lazy
let cabecalhoAlunos       = [];   // Cabeçalho da aba ALUNO
let alunosCarregados      = false; // Flag: aba ALUNO já foi buscada?
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
    estado:     inlineTrim(l[idx["ESTADO"]]        ?? ""),
    regiao:     inlineTrim(l[idx["REGIAO"]]        ?? ""),
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
  inicializarDropdownsGrupos();
  paginaAtual = 1;
  renderizarTabelaPolos();
  renderizarInsights();
  renderizarGrupos();
}

/* ============================================================
   ABA ALUNO — armazena as linhas brutas para uso no export
   Não é chamada no carregamento inicial (lazy load).
   ============================================================ */
function processarAbaAluno(linhas) {
  if (linhas.length < 2) return;
  cabecalhoAlunos    = linhas[0];
  dadosAlunosGlobais = linhas.slice(1).filter(l => l.some(c => c.trim() !== ""));
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

/* ============================================================
   EXPORT — feedback visual no botão durante geração
   ============================================================ */
function setExportando(btn, label, ativo, mensagem = "") {
  if (!btn) return;
  btn.disabled = ativo;
  if (label) label.textContent = ativo ? mensagem : `Exportar Excel (${getDadosFiltrados().length})`;
  btn.style.opacity = ativo ? "0.7" : "";
  btn.style.cursor  = ativo ? "wait" : "";
}

/* ============================================================
   MODAL DE PROGRESSO — usado pelos dois tipos de exportação
   (botão "Exportar Excel" da tabela e botões "⬇" de gerência)
   ============================================================ */
const ORDEM_ETAPAS_EXPORT = ["preparar", "carregar", "filtrar", "montar", "gerar"];

function abrirModalExport() {
  exportModalOverlay.classList.remove("done");
  exportModalSteps.forEach(li => li.classList.remove("active", "done"));
  exportModalSub.textContent = "Isso pode levar alguns instantes...";
  exportModalOverlay.classList.add("open");
  exportModalOverlay.setAttribute("aria-hidden", "false");
}

/** Marca a etapa atual como "ativa" e todas as anteriores como "concluídas". */
function avancarModalExport(etapa) {
  const idxAtual = ORDEM_ETAPAS_EXPORT.indexOf(etapa);
  exportModalSteps.forEach(li => {
    const idx = ORDEM_ETAPAS_EXPORT.indexOf(li.dataset.step);
    li.classList.toggle("done", idx < idxAtual);
    li.classList.toggle("active", idx === idxAtual);
  });
}

function concluirModalExport() {
  exportModalSteps.forEach(li => li.classList.remove("active"));
  exportModalSteps.forEach(li => li.classList.add("done"));
  exportModalOverlay.classList.add("done");
  exportModalSub.textContent = "Download concluído!";
}

function fecharModalExport(delay = 900) {
  setTimeout(() => {
    exportModalOverlay.classList.remove("open", "done");
    exportModalOverlay.setAttribute("aria-hidden", "true");
  }, delay);
}

/* ============================================================
   LAZY LOAD — aba ALUNO só é buscada na primeira exportação
   ============================================================ */
async function garantirAlunosCarregados() {
  if (alunosCarregados) return; // já na memória, reutiliza
  try {
    const res = await fetch(URL_ALUNO);
    if (res.ok) {
      processarAbaAluno(parseCSV(await res.text()));
    }
  } catch (e) {
    console.warn("[Dashboard] Não foi possível carregar a aba ALUNO:", e);
  } finally {
    alunosCarregados = true; // marca mesmo em falha — evita retry infinito
  }
}

/* ============================================================
   PROCESSAMENTO EM CHUNKS — libera a thread entre lotes
   Resolve o travamento/crash em PCs com pouca memória.
   ============================================================ */
function processarEmChunks(array, tamanhoChunk, transformFn) {
  return new Promise(resolve => {
    const resultado = [];
    let i = 0;

    function processar() {
      const fim = Math.min(i + tamanhoChunk, array.length);
      for (; i < fim; i++) resultado.push(transformFn(array[i]));

      if (i < array.length) {
        setTimeout(processar, 0); // cede controle ao navegador entre lotes
      } else {
        resolve(resultado);
      }
    }
    processar();
  });
}

/** Monta e baixa o arquivo .xlsx a partir de uma lista de polos.
 *  A aba ALUNO é carregada via lazy load na primeira exportação.
 *  O processamento é feito em chunks para não travar o navegador. */
async function gerarPlanilhaExcel(dados, nomeArquivoBase, btnRef, labelRef) {
  abrirModalExport();
  try {
    await _gerarPlanilhaExcelInterna(dados, nomeArquivoBase, btnRef, labelRef);
    concluirModalExport();
  } catch (erro) {
    console.error("[Dashboard] Erro ao gerar planilha:", erro);
    exportModalSub.textContent = "Ocorreu um erro ao gerar o arquivo.";
    alert("Não foi possível gerar a planilha. Tente novamente.");
  } finally {
    setExportando(btnRef, labelRef, false);
    fecharModalExport();
  }
}

/* Limite a partir do qual a aba Alunos é dividida em várias partes
   para evitar estouro de memória no navegador (~185 mil linhas). */
const LIMITE_ALUNOS_POR_ABA = 45000;
const LIMITE_AVISO_VOLUME   = 50000;

async function _gerarPlanilhaExcelInterna(dados, nomeArquivoBase, btnRef, labelRef) {
  setExportando(btnRef, labelRef, true, "Preparando Polos…");
  avancarModalExport("preparar");

  // ── Aba Polos em chunks (500 linhas por vez) ──
  const linhasExport = await processarEmChunks(dados, 500, item => ({
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

  const worksheetPolos = XLSX.utils.json_to_sheet(linhasExport);

  worksheetPolos["!cols"] = [
    { wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 26 }, { wch: 24 },
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 },
  ];

  // Formata colunas de percentual como % nativo do Excel
  const colunasPercentual = ["H", "J", "L"];
  const totalLinhas = linhasExport.length;
  colunasPercentual.forEach(col => {
    for (let r = 2; r <= totalLinhas + 1; r++) {
      const cell = worksheetPolos[`${col}${r}`];
      if (cell) cell.z = "0.00%";
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheetPolos, "Polos");

  // ── Aba Alunos: lazy load + chunks otimizados ──
  setExportando(btnRef, labelRef, true, "Carregando Alunos…");
  avancarModalExport("carregar");
  await garantirAlunosCarregados();

  if (dadosAlunosGlobais.length > 0 && cabecalhoAlunos.length > 0) {
    const idxPolo = cabecalhoAlunos.findIndex(h =>
      h.trim().toUpperCase() === "CODIGO_DO_POLO_ATUAL"
    );

    if (idxPolo !== -1) {
      const codigosExportados = new Set(dados.map(item => String(item.codPolo).trim()));
      const headerLimpo = cabecalhoAlunos.map(c => c.trim());

      // Filtra + monta AOA em uma única passagem por chunks.
      // Evita o .filter() completo que criava um array intermediário enorme.
      setExportando(btnRef, labelRef, true, "Filtrando e montando Alunos…");
      avancarModalExport("filtrar");

      const alunosAOA = []; // array de arrays (mais leve que array de objetos)
      const TAMANHO_CHUNK = 1000;

      await new Promise(resolve => {
        let i = 0;
        function processarLote() {
          const fim = Math.min(i + TAMANHO_CHUNK, dadosAlunosGlobais.length);
          for (; i < fim; i++) {
            const linha = dadosAlunosGlobais[i];
            const cod = String(linha[idxPolo] ?? "").trim();
            if (codigosExportados.has(cod)) {
              // Monta a linha já como array (aoa), sem criar objeto intermediário
              alunosAOA.push(headerLimpo.map((_, colIdx) => linha[colIdx] ?? ""));
            }
          }
          if (i < dadosAlunosGlobais.length) {
            setTimeout(processarLote, 0); // cede controle ao navegador
          } else {
            resolve();
          }
        }
        processarLote();
      });

      const totalAlunos = alunosAOA.length;
      avancarModalExport("montar");

      if (totalAlunos > 0) {
        // Volume alto → avisa e divide em várias abas para não estourar memória
        if (totalAlunos > LIMITE_AVISO_VOLUME) {
          exportModalSub.textContent =
            `Volume alto (${totalAlunos.toLocaleString("pt-BR")} alunos). Dividindo em partes…`;
        }

        if (totalAlunos <= LIMITE_ALUNOS_POR_ABA) {
          // Caso normal: uma única aba "Alunos"
          const sheetData = [headerLimpo, ...alunosAOA];
          const worksheetAlunos = XLSX.utils.aoa_to_sheet(sheetData);
          XLSX.utils.book_append_sheet(workbook, worksheetAlunos, "Alunos");
        } else {
          // Volume grande: divide em várias abas (Alunos_1, Alunos_2, …)
          const totalPartes = Math.ceil(totalAlunos / LIMITE_ALUNOS_POR_ABA);

          for (let p = 0; p < totalPartes; p++) {
            const ini = p * LIMITE_ALUNOS_POR_ABA;
            const fim = Math.min(ini + LIMITE_ALUNOS_POR_ABA, totalAlunos);
            const parte = alunosAOA.slice(ini, fim);

            const sheetData = [headerLimpo, ...parte];
            const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
            const nomeAba = `Alunos_${p + 1}`;
            XLSX.utils.book_append_sheet(workbook, worksheet, nomeAba);

            // Cede o event loop entre partes para não travar a UI
            await new Promise(r => setTimeout(r, 0));
          }
        }

        // Libera a referência grande o quanto antes
        alunosAOA.length = 0;
      }
    }
  }

  // ── Grava o arquivo ──
  setExportando(btnRef, labelRef, true, "Gerando arquivo…");
  avancarModalExport("gerar");
  await new Promise(r => setTimeout(r, 0)); // cede uma última vez antes do writeFile

  const agora   = new Date();
  const dataStr = agora.toLocaleDateString("pt-BR").split("/").join("-");
  const horaStr = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");

  XLSX.writeFile(workbook, `${nomeArquivoBase}_${dataStr}_${horaStr}.xlsx`);
}

async function exportarPolosParaExcel() {
  const dados = getDadosFiltrados();
  if (dados.length === 0) return;

  const sufixoFiltro = (searchGeralInput.value.trim() || carteirasSelecionadas.length > 0) ? "_filtrado" : "";
  await gerarPlanilhaExcel(dados, `polos_uniasselvi${sufixoFiltro}`, exportExcelBtn, exportExcelLabel);
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

async function exportarPolosDaGerencia(row, btn) {
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

  // Desabilita o botão da gerência durante o export para evitar duplo clique
  if (btn) { btn.disabled = true; btn.textContent = "⏳"; }
  try {
    await gerarPlanilhaExcel(dados, `polos_${slugificar(nomeGerencia)}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⬇"; }
  }
}

gerenciaExportBtns.forEach(btn => {
  btn.addEventListener("click", e => {
    e.stopPropagation();
    exportarPolosDaGerencia(btn.closest(".gerencia-row"), btn);
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

  // Todos os insights (positivos e de melhoria) consideram apenas
  // polos com base relevante (Meta Edital >= 70) — evita que polos
  // pequenos distorçam tanto os destaques quanto os alertas.
  const CORTE_BASE_INSIGHTS = 70;
  const elegiveis = dadosPolosGlobais.filter(i => i.metaEdital >= CORTE_BASE_INSIGHTS);
  const total     = elegiveis.length;

  /* ══════════════════════════════════════════════
     DADOS PRÉ-CALCULADOS
  ══════════════════════════════════════════════ */

  // Polos acima de 100% da Meta Móvel
  // Polos acima de 100% da Meta Móvel
  const acimaDaMeta = [...elegiveis]
    .filter(i => i.pctMovel >= 100)
    .sort((a, b) => b.pctMovel - a.pctMovel);

  // Maior volume absoluto de pagantes
  const maiorVolume = [...elegiveis]
    .sort((a, b) => b.pagantes - a.pagantes)[0];

  // Melhor % Meta Edital
  const maiorPctEdital = [...elegiveis]
    .filter(i => i.pctEdital > 0)
    .sort((a, b) => b.pctEdital - a.pctEdital)[0];

  // Melhor % Meta Ciclo (polo mais próximo de bater a Meta Ciclo)
  const maiorPctCiclo = [...elegiveis]
    .filter(i => i.pctCiclo > 0)
    .sort((a, b) => b.pctCiclo - a.pctCiclo)[0];

  // Carteira com mais polos acima de 100%
  const contagemPorCarteira = {};
  acimaDaMeta.forEach(p => {
    contagemPorCarteira[p.carteira] = (contagemPorCarteira[p.carteira] || 0) + 1;
  });
  const melhorCarteira = Object.entries(contagemPorCarteira)
    .sort((a, b) => b[1] - a[1])[0];

  // Polos abaixo de 50% da Meta Móvel (já usando a mesma base elegível)
  const abaixo50 = [...elegiveis]
    .filter(i => i.pctMovel < 50)
    .sort((a, b) => a.pctMovel - b.pctMovel);

  // Polo com maior gap absoluto (mais pagantes faltando)
  const maiorGap = elegiveis.length > 0
    ? elegiveis
        .map(i => ({ ...i, gap: Math.max(0, i.metaMovel - i.pagantes) }))
        .sort((a, b) => b.gap - a.gap)[0]
    : null;

  // Polo com maior meta mas pior % (potencial desperdiçado):
  // entre os polos com metaMovel no quartil superior, pegar o pior pctMovel
  const metaOrdenada = [...elegiveis].sort((a, b) => b.metaMovel - a.metaMovel);
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
    const pctBase = elegiveis.length > 0
      ? ((abaixo50.length / elegiveis.length) * 100).toFixed(1)
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
      detalhe: `${elegiveis.filter(i => i.pctMovel >= 50 && i.pctMovel < 80).length} polos ainda abaixo de 80% da Meta Móvel`,
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
   REGIÕES E ESTADOS — agregação dinâmica a partir da aba POLO
   Suporta filtro por carteira em cada seção, com recálculo
   dinâmico dos totais e exportação dos dados filtrados.
   ============================================================ */
const regioesRowsEl = document.getElementById("regioesRows");
const estadosRowsEl = document.getElementById("estadosRows");

// Estado dos filtros de carteira para cada seção
let carteirasFiltroRegiao  = [];
let carteirasFiltroEstado  = [];

// Elementos DOM dos filtros
const regiaoCarteiraSelectTrigger = document.getElementById("regiaoCarteiraSelectTrigger");
const regiaoCarteiraDropdown      = document.getElementById("regiaoCarteiraDropdown");
const clearRegiaoFiltroBtn        = document.getElementById("clearRegiaoFiltroBtn");
const exportRegiaoBtn             = document.getElementById("exportRegiaoBtn");
const exportRegiaoLabel           = document.getElementById("exportRegiaoLabel");

const estadoCarteiraSelectTrigger = document.getElementById("estadoCarteiraSelectTrigger");
const estadoCarteiraDropdown      = document.getElementById("estadoCarteiraDropdown");
const clearEstadoFiltroBtn        = document.getElementById("clearEstadoFiltroBtn");
const exportEstadoBtn             = document.getElementById("exportEstadoBtn");
const exportEstadoLabel           = document.getElementById("exportEstadoLabel");

/** Agrega dados de polos por campo (regiao|estado), respeitando filtro de carteira. */
function agruparDados(campo, carteirasFiltro) {
  const mapa = {};
  const fonte = carteirasFiltro && carteirasFiltro.length > 0
    ? dadosPolosGlobais.filter(item => carteirasFiltro.includes(item.carteira))
    : dadosPolosGlobais;

  fonte.forEach(item => {
    const chave = item[campo] || "Não informado";
    if (!mapa[chave]) mapa[chave] = { nome: chave, pagantes: 0, metaMovel: 0, metaEdital: 0 };
    mapa[chave].pagantes   += item.pagantes;
    mapa[chave].metaMovel  += item.metaMovel;
    mapa[chave].metaEdital += item.metaEdital;
  });
  return Object.values(mapa)
    .map(g => ({
      ...g,
      pctMovel:  g.metaMovel  > 0 ? (g.pagantes / g.metaMovel)  * 100 : 0,
      pctEdital: g.metaEdital > 0 ? (g.pagantes / g.metaEdital) * 100 : 0,
    }))
    .sort((a, b) => b.pagantes - a.pagantes);
}

function renderizarLinhaGrupo(grupo, campo) {
  return `
    <div class="gerencia-row" data-campo="${campo}" data-nome="${escapeHTML(grupo.nome)}">
      <span class="gerencia-nome">${escapeHTML(grupo.nome)}</span>
      <span class="gerencia-pagantes">${formatarNumero(grupo.pagantes)}</span>
      <span class="gerencia-metamovel">${formatarNumero(grupo.metaMovel)}</span>
      <span class="gerencia-pct">${formatarPercentual(grupo.pctMovel)}</span>
      <span class="gerencia-metaedital">${formatarNumero(grupo.metaEdital)}</span>
      <span class="gerencia-pctedital">${formatarPercentual(grupo.pctEdital)}</span>
      <button class="gerencia-export-btn" title="Baixar polos deste grupo em Excel" aria-label="Baixar Excel">⬇</button>
    </div>
  `;
}

/** Renderiza o dropdown de carteiras para uma seção (regiao ou estado). */
function renderizarDropdownGrupo(dropdownEl, triggerEl, carteirasFiltro, onChangeFn) {
  dropdownEl.innerHTML = "";
  carteirasDisponiveis.forEach((carteira, i) => {
    const uid  = `${dropdownEl.id}_c${i}`;
    const item = document.createElement("div");
    item.className = "dropdown-item";
    item.innerHTML = `
      <input type="checkbox" id="${uid}" value="${escapeHTML(carteira)}" ${carteirasFiltro.includes(carteira) ? "checked" : ""}>
      <label for="${uid}">${escapeHTML(carteira)}</label>
    `;
    item.querySelector("input").addEventListener("change", e => onChangeFn(e));
    dropdownEl.appendChild(item);
  });
}

function atualizarTextoTriggerGrupo(triggerEl, carteirasFiltro) {
  if (carteirasFiltro.length === 0)      triggerEl.textContent = "Todas as carteiras";
  else if (carteirasFiltro.length === 1) triggerEl.textContent = carteirasFiltro[0];
  else                                   triggerEl.textContent = `${carteirasFiltro.length} carteiras sel.`;
}

/** Retorna os polos da aba POLO filtrados pela lista de carteiras informada. */
function getPolosFiltradosPorCarteiras(carteirasFiltro) {
  if (!carteirasFiltro || carteirasFiltro.length === 0) return dadosPolosGlobais;
  return dadosPolosGlobais.filter(item => carteirasFiltro.includes(item.carteira));
}

function renderizarGrupos() {
  if (!regioesRowsEl || !estadosRowsEl) return;

  // Regiões
  const gruposRegiao = agruparDados("regiao", carteirasFiltroRegiao);
  regioesRowsEl.innerHTML = gruposRegiao.length > 0
    ? gruposRegiao.map(g => renderizarLinhaGrupo(g, "regiao")).join("")
    : `<div class="gerencia-row"><span class="gerencia-nome" style="color:var(--texto-suave);font-style:italic;">Nenhuma região encontrada para o filtro.</span></div>`;

  // Atualiza botão de export da seção Regiões
  const totalPolosRegiao = getPolosFiltradosPorCarteiras(carteirasFiltroRegiao).length;
  if (exportRegiaoBtn) {
    exportRegiaoBtn.disabled = totalPolosRegiao === 0;
    if (exportRegiaoLabel) exportRegiaoLabel.textContent = totalPolosRegiao > 0 ? `Exportar (${totalPolosRegiao})` : "Exportar";
  }

  // Estados
  const gruposEstado = agruparDados("estado", carteirasFiltroEstado);
  estadosRowsEl.innerHTML = gruposEstado.length > 0
    ? gruposEstado.map(g => renderizarLinhaGrupo(g, "estado")).join("")
    : `<div class="gerencia-row"><span class="gerencia-nome" style="color:var(--texto-suave);font-style:italic;">Nenhum estado encontrado para o filtro.</span></div>`;

  // Atualiza botão de export da seção Estados
  const totalPolosEstado = getPolosFiltradosPorCarteiras(carteirasFiltroEstado).length;
  if (exportEstadoBtn) {
    exportEstadoBtn.disabled = totalPolosEstado === 0;
    if (exportEstadoLabel) exportEstadoLabel.textContent = totalPolosEstado > 0 ? `Exportar (${totalPolosEstado})` : "Exportar";
  }
}

/** Inicializa os dropdowns de carteira após carregar carteirasDisponiveis. */
function inicializarDropdownsGrupos() {
  // ── Regiões ──
  renderizarDropdownGrupo(
    regiaoCarteiraDropdown,
    regiaoCarteiraSelectTrigger,
    carteirasFiltroRegiao,
    e => {
      if (e.target.checked) carteirasFiltroRegiao.push(e.target.value);
      else carteirasFiltroRegiao = carteirasFiltroRegiao.filter(c => c !== e.target.value);
      atualizarTextoTriggerGrupo(regiaoCarteiraSelectTrigger, carteirasFiltroRegiao);
      renderizarGrupos();
    }
  );

  // ── Estados ──
  renderizarDropdownGrupo(
    estadoCarteiraDropdown,
    estadoCarteiraSelectTrigger,
    carteirasFiltroEstado,
    e => {
      if (e.target.checked) carteirasFiltroEstado.push(e.target.value);
      else carteirasFiltroEstado = carteirasFiltroEstado.filter(c => c !== e.target.value);
      atualizarTextoTriggerGrupo(estadoCarteiraSelectTrigger, carteirasFiltroEstado);
      renderizarGrupos();
    }
  );
}

// Abertura/fechamento dos dropdowns das seções
if (regiaoCarteiraSelectTrigger) {
  regiaoCarteiraSelectTrigger.addEventListener("click", e => {
    e.stopPropagation();
    regiaoCarteiraDropdown.classList.toggle("open");
    estadoCarteiraDropdown.classList.remove("open");
  });
  regiaoCarteiraDropdown.addEventListener("click", e => e.stopPropagation());
}
if (estadoCarteiraSelectTrigger) {
  estadoCarteiraSelectTrigger.addEventListener("click", e => {
    e.stopPropagation();
    estadoCarteiraDropdown.classList.toggle("open");
    regiaoCarteiraDropdown.classList.remove("open");
  });
  estadoCarteiraDropdown.addEventListener("click", e => e.stopPropagation());
}
document.addEventListener("click", () => {
  if (regiaoCarteiraDropdown) regiaoCarteiraDropdown.classList.remove("open");
  if (estadoCarteiraDropdown) estadoCarteiraDropdown.classList.remove("open");
});

// Botões Limpar
if (clearRegiaoFiltroBtn) {
  clearRegiaoFiltroBtn.addEventListener("click", () => {
    carteirasFiltroRegiao = [];
    regiaoCarteiraDropdown.querySelectorAll("input").forEach(chk => chk.checked = false);
    atualizarTextoTriggerGrupo(regiaoCarteiraSelectTrigger, carteirasFiltroRegiao);
    renderizarGrupos();
  });
}
if (clearEstadoFiltroBtn) {
  clearEstadoFiltroBtn.addEventListener("click", () => {
    carteirasFiltroEstado = [];
    estadoCarteiraDropdown.querySelectorAll("input").forEach(chk => chk.checked = false);
    atualizarTextoTriggerGrupo(estadoCarteiraSelectTrigger, carteirasFiltroEstado);
    renderizarGrupos();
  });
}

// Botões de exportação das seções
if (exportRegiaoBtn) {
  exportRegiaoBtn.addEventListener("click", async () => {
    if (dadosPolosGlobais.length === 0) { alert("Dados ainda carregando."); return; }
    const dados = getPolosFiltradosPorCarteiras(carteirasFiltroRegiao);
    if (dados.length === 0) { alert("Nenhum polo para exportar."); return; }
    const sufixo = carteirasFiltroRegiao.length > 0
      ? slugificar(carteirasFiltroRegiao.join("_"))
      : "todas_carteiras";
    exportRegiaoBtn.disabled = true;
    try { await gerarPlanilhaExcel(dados, `regioes_${sufixo}`); }
    finally { exportRegiaoBtn.disabled = false; }
  });
}
if (exportEstadoBtn) {
  exportEstadoBtn.addEventListener("click", async () => {
    if (dadosPolosGlobais.length === 0) { alert("Dados ainda carregando."); return; }
    const dados = getPolosFiltradosPorCarteiras(carteirasFiltroEstado);
    if (dados.length === 0) { alert("Nenhum polo para exportar."); return; }
    const sufixo = carteirasFiltroEstado.length > 0
      ? slugificar(carteirasFiltroEstado.join("_"))
      : "todas_carteiras";
    exportEstadoBtn.disabled = true;
    try { await gerarPlanilhaExcel(dados, `estados_${sufixo}`); }
    finally { exportEstadoBtn.disabled = false; }
  });
}

async function exportarPolosDoGrupo(campo, nome, carteirasAtivas, btn) {
  if (dadosPolosGlobais.length === 0) {
    alert("Os dados ainda estão carregando. Aguarde e tente novamente.");
    return;
  }
  // Filtra primeiro pelas carteiras ativas na seção, depois pelo grupo (regiao/estado)
  const base  = getPolosFiltradosPorCarteiras(carteirasAtivas);
  const dados = base.filter(item => (item[campo] || "Não informado") === nome);
  if (dados.length === 0) {
    alert(`Nenhum polo encontrado para "${nome}".`);
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "⏳"; }
  try {
    await gerarPlanilhaExcel(dados, `polos_${slugificar(nome)}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⬇"; }
  }
}

// Delegação de clique para os botões "⬇" de cada linha de região/estado
if (regioesRowsEl) {
  regioesRowsEl.addEventListener("click", e => {
    const btn = e.target.closest(".gerencia-export-btn");
    if (!btn) return;
    e.stopPropagation();
    const row = btn.closest(".gerencia-row");
    exportarPolosDoGrupo(row.dataset.campo, row.dataset.nome, carteirasFiltroRegiao, btn);
  });
}
if (estadosRowsEl) {
  estadosRowsEl.addEventListener("click", e => {
    const btn = e.target.closest(".gerencia-export-btn");
    if (!btn) return;
    e.stopPropagation();
    const row = btn.closest(".gerencia-row");
    exportarPolosDoGrupo(row.dataset.campo, row.dataset.nome, carteirasFiltroEstado, btn);
  });
}

/* ============================================================
   CARGA PRINCIPAL
   ============================================================ */
async function carregarDashboard() {
  // Reseta o cache da aba ALUNO para garantir dados frescos após atualização manual
  alunosCarregados   = false;
  dadosAlunosGlobais = [];
  cabecalhoAlunos    = [];

  // Reseta filtros de carteira das seções Regiões e Estados
  carteirasFiltroRegiao = [];
  carteirasFiltroEstado = [];
  setStatus("loading");
  try {
    // Aba ALUNO NÃO é carregada aqui — lazy load ocorre só quando o usuário exportar
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