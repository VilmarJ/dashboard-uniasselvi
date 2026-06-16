# Dashboard de Metas — Polos

Dashboard interativo que lê dados diretamente do Google Sheets e exibe KPIs, carteiras, ranking de gerentes e tabela filtrável de polos.

---

## 🚀 Como configurar

### 1. Preparar o Google Sheets

A planilha precisa ser **publicada na web** (diferente de apenas compartilhada):

1. Abra a planilha no Google Sheets
2. **Arquivo → Compartilhar → Publicar na web**
3. Na janela que abrir:
   - Escolha **"Documento inteiro"** ou cada aba individualmente
   - Formato: **CSV**
   - Clique em **Publicar** → confirme
4. Copie o **ID da planilha** da URL:
   ```
   https://docs.google.com/spreadsheets/d/[SEU_ID_AQUI]/edit
   ```

> ⚠️ A planilha precisa estar com **acesso de visualização público** (Compartilhar → "Qualquer pessoa com o link pode ver")

---

### 2. Configurar o `app.js`

Abra o arquivo `app.js` e substitua na linha inicial:

```js
const CONFIG = {
  SHEET_ID:        'SEU_SHEET_ID_AQUI',  // ← Cole o ID aqui
  ABA_ABERTURA:    'ABERTURA',           // Nome exato da aba (maiúsculas/minúsculas importam)
  ABA_CONSOLIDADO: 'CONSOLIDADO',        // Nome exato da aba
  ROWS_PER_PAGE:   50,                   // Linhas por página na tabela
};
```

---

### 3. Publicar no GitHub Pages

```bash
# 1. Crie um repositório no GitHub (ex: "dashboard-metas")
# 2. Clone ou inicialize localmente
git init
git add .
git commit -m "Dashboard de metas v1"

# 3. Envie para o GitHub
git remote add origin https://github.com/SEU_USUARIO/dashboard-metas.git
git push -u origin main

# 4. No repositório GitHub:
# Settings → Pages → Source: "Deploy from a branch"
# Branch: main → / (root) → Save
```

Após alguns minutos o dashboard estará em:
```
https://SEU_USUARIO.github.io/dashboard-metas/
```

---

## 🔄 Como atualizar os dados

1. Atualize a planilha normalmente no Google Sheets
2. O time acessa o dashboard e clica em **"Atualizar"**
3. Os dados são lidos em tempo real via Google Sheets API pública

> O Google pode demorar até **5 minutos** para refletir alterações no CSV publicado.

---

## 📋 Estrutura dos arquivos

```
dashboard/
├── index.html   # Estrutura da página
├── style.css    # Estilos (tema escuro)
└── app.js       # Lógica de dados e renderização
```

---

## 🎨 Funcionalidades

| Feature | Descrição |
|---|---|
| **KPIs Gerais** | Pagantes totais, % Meta Móvel, % Meta Edital, Polos ativos |
| **Cards Carteiras** | Barra de progresso colorida por performance |
| **Ranking** | Gerentes ordenados por % Meta Móvel |
| **Tabela Polos** | Busca, filtro por carteira/status, ordenação por coluna |
| **Paginação** | 50 linhas por página |
| **Responsivo** | Funciona em mobile e desktop |

### Cores de status:
- 🟢 **Verde** — Acima de 100% da meta
- 🟡 **Amarelo** — Entre 80% e 99%
- 🔴 **Vermelho** — Abaixo de 80%

---

## ❓ Problemas comuns

**"Não foi possível carregar os dados"**
- Verifique se a planilha está **publicada na web** (não apenas compartilhada)
- Confirme que o acesso é **público para qualquer pessoa**
- Cheque se os nomes das abas estão corretos (case-sensitive)

**Dados desatualizados**
- O Google leva até 5 min para atualizar o CSV publicado
- Tente `Ctrl+Shift+R` para forçar refresh sem cache

**Colunas erradas**
- A aba ABERTURA deve seguir a ordem: COD POLO, POLO, PARCEIRO, CARTEIRA, ANALISTA, PAGANTES, META EDITAL, % META EDITAL, META MÓVEL, % META MÓVEL...
- A aba CONSOLIDADO deve ter: CARTEIRA, PAGANTES, META MOVEL, % META MOVEL, META CICLO, % META CICLO, META EDITAL, % META EDITAL
