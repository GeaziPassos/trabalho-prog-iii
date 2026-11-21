"use strict";

// ========================================
// CONFIGURAÇÃO
// ========================================

// Endereço da API (perfil "https" do launchSettings.json da API)
const API_URL = "https://localhost:7063";

// A API trata datas "vazias" de forma peculiar (ver README). Para não filtrar
// nada sem querer, quando o usuário deixa uma data em branco enviamos um limite
// que não exclui registro algum.
const SEM_LIMITE_INICIAL = "0001-01-01";
const SEM_LIMITE_FINAL = "9999-12-30";

const ROTULO_DIRECAO = {
    ASC: { texto: "Menor para maior", aria: "ascending" },
    DESC: { texto: "Maior para menor", aria: "descending" },
};

// ========================================
// ESTADO
// ========================================

const estado = {
    pagina: 1,
    tamanho: 10,
    ordem: "DataCadastro",
    direcao: "DESC",
    // Filtros efetivamente aplicados (só mudam ao clicar em "Filtrar")
    filtros: { descricao: "", cadInicial: "", cadFinal: "", atuInicial: "", atuFinal: "" },
    total: 0,
    carregando: false,
    idParaExcluir: null,
};

// ========================================
// ELEMENTOS
// ========================================

const $ = (id) => document.getElementById(id);

const el = {
    avisoErro: $("avisoErro"),
    avisoErroTexto: $("avisoErroTexto"),
    btnTentarNovamente: $("btnTentarNovamente"),

    formFiltro: $("formFiltro"),
    filtroDescricao: $("filtroDescricao"),
    filtroCadInicial: $("filtroCadInicial"),
    filtroCadFinal: $("filtroCadFinal"),
    filtroAtuInicial: $("filtroAtuInicial"),
    filtroAtuFinal: $("filtroAtuFinal"),
    tamanhoPagina: $("tamanhoPagina"),
    btnLimpar: $("btnLimpar"),
    erroFiltro: $("erroFiltro"),

    totalRegistros: $("totalRegistros"),
    tabelaArea: $("tabelaArea"),
    lista: $("listaLembretes"),
    estadoVazio: $("estadoVazio"),
    estadoVazioTexto: $("estadoVazioTexto"),
    btnVazioAcao: $("btnVazioAcao"),
    ordemMobile: $("ordemMobile"),
    direcaoMobile: $("direcaoMobile"),

    infoPagina: $("infoPagina"),
    paginacaoBotoes: $("paginacaoBotoes"),

    btnNovo: $("btnNovo"),
    btnImprimir: $("btnImprimir"),

    dlgLembrete: $("dlgLembrete"),
    formLembrete: $("formLembrete"),
    tituloFormulario: $("tituloFormulario"),
    lembreteId: $("lembreteId"),
    descricao: $("descricao"),
    erroDescricao: $("erroDescricao"),
    contadorDescricao: $("contadorDescricao"),
    btnCancelar: $("btnCancelar"),
    btnSalvar: $("btnSalvar"),

    dlgExcluir: $("dlgExcluir"),
    textoExcluir: $("textoExcluir"),
    btnCancelarExcluir: $("btnCancelarExcluir"),
    btnConfirmarExcluir: $("btnConfirmarExcluir"),

    toasts: $("toasts"),
};

// ========================================
// COMUNICAÇÃO COM A API
// ========================================

class ErroApi extends Error {
    constructor(mensagem, status = 0) {
        super(mensagem);
        this.status = status;
    }
}

async function requisitar(caminho, opcoes) {
    let resposta;

    try {
        resposta = await fetch(`${API_URL}${caminho}`, opcoes);
    } catch (erro) {
        // fetch só rejeita quando não chegou a haver resposta (API fora do ar, CORS, certificado...)
        console.error("Falha de rede:", erro);
        throw new ErroApi(
            `Não foi possível conectar à API em ${API_URL}. Verifique se ela está em execução.`
        );
    }

    if (!resposta.ok) {
        throw new ErroApi(`A API respondeu com erro ${resposta.status}.`, resposta.status);
    }

    return resposta;
}

// Monta a query string com todos os parâmetros da API (filtro, paginação e ordenação).
function montarParametros() {
    const f = estado.filtros;
    const params = new URLSearchParams();

    params.set("NumeroPagina", estado.pagina);
    params.set("TamanhoPagina", estado.tamanho);
    params.set("Ordem", estado.ordem);
    params.set("Direcao", estado.direcao);
    params.set("Descricao", f.descricao);
    params.set("DataCadastroInicial", f.cadInicial || SEM_LIMITE_INICIAL);
    params.set("DataCadastroFinal", f.cadFinal || SEM_LIMITE_FINAL);
    params.set("DataAtualizacaoInicial", f.atuInicial || SEM_LIMITE_INICIAL);
    params.set("DataAtualizacaoFinal", f.atuFinal || SEM_LIMITE_FINAL);

    return params;
}

function haFiltrosAtivos() {
    return Object.values(estado.filtros).some((valor) => valor !== "");
}

// ========================================
// GET /lembretes/filtro
// ========================================

async function carregarLembretes() {
    definirCarregando(true);
    esconderAvisoErro();

    try {
        const resposta = await requisitar(`/lembretes/filtro?${montarParametros()}`);
        const dados = await resposta.json();

        // Ex.: excluiu o último item da última página: volta para a página anterior
        const totalPaginas = Math.max(1, Math.ceil(dados.total / estado.tamanho));
        if (dados.total > 0 && dados.lembretes.length === 0 && estado.pagina > totalPaginas) {
            estado.pagina = totalPaginas;
            await carregarLembretes();
            return;
        }

        estado.total = dados.total;
        renderizarLembretes(dados.lembretes);
        renderizarPaginacao();
        atualizarIndicadoresDeOrdenacao();
    } catch (erro) {
        console.error(erro);
        estado.total = 0;
        el.lista.replaceChildren();
        el.estadoVazio.hidden = true;
        el.totalRegistros.textContent = "—";
        el.infoPagina.textContent = "";
        el.paginacaoBotoes.replaceChildren();
        mostrarAvisoErro(`Não foi possível carregar os lembretes. ${erro.message}`);
    } finally {
        definirCarregando(false);
    }
}

function definirCarregando(carregando) {
    estado.carregando = carregando;
    el.tabelaArea.setAttribute("aria-busy", String(carregando));
}

// ========================================
// POST /lembretes
// ========================================

async function criarLembrete(texto) {
    await requisitar("/lembretes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao: texto }),
    });
}

// ========================================
// GET /lembretes/{id}
// ========================================

async function buscarLembrete(id) {
    try {
        const resposta = await requisitar(`/lembretes/${encodeURIComponent(id)}`);
        const lembrete = await resposta.json();
        abrirFormulario(lembrete);
    } catch (erro) {
        console.error(erro);

        if (erro.status === 404) {
            mostrarToast("Este lembrete não existe mais. A lista foi atualizada.", "erro");
            carregarLembretes();
        } else {
            mostrarToast(`Não foi possível abrir o lembrete para edição. ${erro.message}`, "erro");
        }
    }
}

// ========================================
// PUT /lembretes/{id}
// ========================================

async function atualizarLembrete(id, texto) {
    await requisitar(`/lembretes/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao: texto }),
    });
}

// ========================================
// DELETE /lembretes/{id}
// ========================================

async function excluirLembrete(id) {
    await requisitar(`/lembretes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ========================================
// GET /lembretes/imprimir (PDF)
// ========================================

async function gerarPdf() {
    el.btnImprimir.disabled = true;

    try {
        const resposta = await requisitar(`/lembretes/imprimir?${montarParametros()}`);
        const blob = await resposta.blob();
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = "relatorio-lembretes.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 10000);
        mostrarToast("PDF gerado com os lembretes da página atual.", "sucesso");
    } catch (erro) {
        console.error(erro);
        mostrarToast(`Não foi possível gerar o PDF. ${erro.message}`, "erro");
    } finally {
        el.btnImprimir.disabled = false;
    }
}

// ========================================
// RENDERIZAÇÃO
// ========================================

function renderizarLembretes(lembretes) {
    el.lista.replaceChildren();

    const quantidade = estado.total;
    el.totalRegistros.textContent = quantidade === 1 ? "1 registro" : `${quantidade} registros`;

    if (!lembretes || lembretes.length === 0) {
        mostrarEstadoVazio();
        return;
    }

    el.estadoVazio.hidden = true;

    for (const lembrete of lembretes) {
        el.lista.appendChild(criarLinha(lembrete));
    }
}

function criarLinha(lembrete) {
    const tr = document.createElement("tr");

    tr.append(
        celula(lembrete.descricao, "descricao"),
        celula(formatarData(lembrete.dataCadastro), "data", "Cadastro"),
        celula(formatarData(lembrete.dataAtualizacao), "data", "Atualização")
    );

    const tdStatus = celula("", "", "Status");
    const status = document.createElement("span");
    status.className = `status ${lembrete.isAtivo ? "status-ativo" : "status-inativo"}`;
    status.textContent = lembrete.isAtivo ? "Ativo" : "Inativo";
    tdStatus.appendChild(status);
    tr.appendChild(tdStatus);

    const tdAcoes = celula("", "acoes");
    tdAcoes.append(
        botaoAcao("Editar", "btn btn-contorno btn-pequeno", "editar", lembrete),
        botaoAcao("Excluir", "btn btn-contorno btn-pequeno btn-excluir", "excluir", lembrete)
    );
    tr.appendChild(tdAcoes);

    return tr;
}

function celula(texto, classe, rotulo) {
    const td = document.createElement("td");
    td.textContent = texto; // textContent evita injeção de HTML pela descrição
    if (classe) td.className = classe;
    if (rotulo) td.dataset.rotulo = rotulo;
    return td;
}

function botaoAcao(texto, classes, acao, lembrete) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = classes;
    botao.textContent = texto;
    botao.dataset.acao = acao;
    botao.dataset.id = lembrete.id;
    botao.setAttribute("aria-label", `${texto} o lembrete: ${resumir(lembrete.descricao)}`);
    return botao;
}

function mostrarEstadoVazio() {
    el.estadoVazio.hidden = false;

    if (haFiltrosAtivos()) {
        el.estadoVazioTexto.textContent = "Nenhum lembrete corresponde aos filtros aplicados.";
        el.btnVazioAcao.textContent = "Limpar filtros";
        el.btnVazioAcao.dataset.acao = "limpar";
    } else {
        el.estadoVazioTexto.textContent = "Você ainda não tem lembretes. Que tal anotar o primeiro?";
        el.btnVazioAcao.textContent = "Novo lembrete";
        el.btnVazioAcao.dataset.acao = "novo";
    }
}

// ----- Paginação -----

function renderizarPaginacao() {
    const totalPaginas = Math.max(1, Math.ceil(estado.total / estado.tamanho));
    el.paginacaoBotoes.replaceChildren();

    if (estado.total === 0) {
        el.infoPagina.textContent = "";
        return;
    }

    const primeiro = (estado.pagina - 1) * estado.tamanho + 1;
    const ultimo = Math.min(estado.pagina * estado.tamanho, estado.total);
    el.infoPagina.textContent = `Mostrando ${primeiro} a ${ultimo} de ${estado.total}`;

    el.paginacaoBotoes.appendChild(botaoPagina("« Primeira", 1, estado.pagina === 1));
    el.paginacaoBotoes.appendChild(botaoPagina("‹ Anterior", estado.pagina - 1, estado.pagina === 1));

    let anterior = 0;
    for (const numero of paginasVisiveis(estado.pagina, totalPaginas)) {
        if (numero - anterior > 1) {
            const reticencias = document.createElement("span");
            reticencias.className = "pag-reticencias";
            reticencias.textContent = "…";
            el.paginacaoBotoes.appendChild(reticencias);
        }
        el.paginacaoBotoes.appendChild(botaoPagina(String(numero), numero, false, numero === estado.pagina));
        anterior = numero;
    }

    el.paginacaoBotoes.appendChild(botaoPagina("Próxima ›", estado.pagina + 1, estado.pagina === totalPaginas));
    el.paginacaoBotoes.appendChild(botaoPagina("Última »", totalPaginas, estado.pagina === totalPaginas));
}

function paginasVisiveis(atual, total) {
    const conjunto = new Set([1, total, atual - 1, atual, atual + 1]);
    return [...conjunto].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
}

function botaoPagina(texto, pagina, desabilitado, atual = false) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "pag-btn";
    botao.textContent = texto;
    botao.dataset.pagina = pagina;
    botao.disabled = desabilitado;
    if (atual) {
        botao.setAttribute("aria-current", "page");
        botao.setAttribute("aria-label", `Página ${pagina}, página atual`);
    } else if (/^\d+$/.test(texto)) {
        botao.setAttribute("aria-label", `Ir para a página ${pagina}`);
    }
    return botao;
}

// ----- Ordenação -----

function atualizarIndicadoresDeOrdenacao() {
    document.querySelectorAll("th .ordenar").forEach((botao) => {
        const th = botao.closest("th");
        if (botao.dataset.ordem === estado.ordem) {
            th.setAttribute("aria-sort", ROTULO_DIRECAO[estado.direcao].aria);
        } else {
            th.setAttribute("aria-sort", "none");
        }
    });

    el.ordemMobile.value = estado.ordem;
    el.direcaoMobile.textContent = estado.direcao === "ASC" ? "Crescente ↑" : "Decrescente ↓";
}

function ordenarPor(campo) {
    if (estado.ordem === campo) {
        estado.direcao = estado.direcao === "ASC" ? "DESC" : "ASC";
    } else {
        estado.ordem = campo;
        estado.direcao = "ASC";
    }

    estado.pagina = 1;
    carregarLembretes();
}

// ========================================
// FILTROS
// ========================================

function lerFiltrosDoFormulario() {
    return {
        descricao: el.filtroDescricao.value.trim(),
        cadInicial: el.filtroCadInicial.value,
        cadFinal: el.filtroCadFinal.value,
        atuInicial: el.filtroAtuInicial.value,
        atuFinal: el.filtroAtuFinal.value,
    };
}

function validarFiltros(f) {
    if (f.cadInicial && f.cadFinal && f.cadInicial > f.cadFinal) {
        return "Na data de cadastro, a data inicial não pode ser maior que a final.";
    }
    if (f.atuInicial && f.atuFinal && f.atuInicial > f.atuFinal) {
        return "Na data de atualização, a data inicial não pode ser maior que a final.";
    }
    return "";
}

function aplicarFiltros() {
    const filtros = lerFiltrosDoFormulario();
    const erro = validarFiltros(filtros);

    el.erroFiltro.hidden = !erro;
    el.erroFiltro.textContent = erro;
    if (erro) return;

    estado.filtros = filtros;
    estado.tamanho = Number(el.tamanhoPagina.value);
    estado.pagina = 1;
    carregarLembretes();
}

function limparFiltros() {
    el.formFiltro.reset();
    el.tamanhoPagina.value = String(estado.tamanho);
    el.erroFiltro.hidden = true;
    estado.filtros = lerFiltrosDoFormulario();
    estado.pagina = 1;
    carregarLembretes();
}

// ========================================
// FORMULÁRIO (criar / editar)
// ========================================

function abrirFormulario(lembrete = null) {
    limparErroDescricao();

    el.lembreteId.value = lembrete ? lembrete.id : "";
    el.descricao.value = lembrete ? lembrete.descricao : "";
    el.tituloFormulario.textContent = lembrete ? "Editar lembrete" : "Novo lembrete";
    atualizarContador();

    el.dlgLembrete.showModal();
    el.descricao.focus();
}

function fecharFormulario() {
    el.dlgLembrete.close();
}

function atualizarContador() {
    el.contadorDescricao.textContent = `${el.descricao.value.length}/500`;
}

function mostrarErroDescricao(mensagem) {
    el.erroDescricao.textContent = mensagem;
    el.erroDescricao.hidden = false;
    el.descricao.setAttribute("aria-invalid", "true");
    el.descricao.focus();
}

function limparErroDescricao() {
    el.erroDescricao.hidden = true;
    el.erroDescricao.textContent = "";
    el.descricao.removeAttribute("aria-invalid");
}

async function salvarFormulario(evento) {
    evento.preventDefault();

    const texto = el.descricao.value.trim();

    if (!texto) {
        mostrarErroDescricao("Preencha a descrição do lembrete.");
        return;
    }

    const id = el.lembreteId.value;
    el.btnSalvar.disabled = true;

    try {
        if (id) {
            await atualizarLembrete(id, texto);
            mostrarToast("Lembrete atualizado com sucesso!", "sucesso");
        } else {
            await criarLembrete(texto);
            mostrarToast("Lembrete criado com sucesso!", "sucesso");
            // Novo registro aparece primeiro na ordenação padrão
            if (estado.ordem === "DataCadastro" && estado.direcao === "DESC") estado.pagina = 1;
        }

        fecharFormulario();
        await carregarLembretes();
    } catch (erro) {
        console.error(erro);

        if (erro.status === 404) {
            fecharFormulario();
            mostrarToast("Este lembrete não existe mais. A lista foi atualizada.", "erro");
            await carregarLembretes();
        } else {
            mostrarToast(
                `Não foi possível ${id ? "atualizar" : "criar"} o lembrete. ${erro.message}`,
                "erro"
            );
        }
    } finally {
        el.btnSalvar.disabled = false;
    }
}

// ========================================
// EXCLUSÃO
// ========================================

function pedirConfirmacaoExclusao(id, descricao) {
    estado.idParaExcluir = id;
    el.textoExcluir.textContent = `“${resumir(descricao, 120)}” será removido da lista.`;
    el.dlgExcluir.showModal();
    el.btnCancelarExcluir.focus();
}

async function confirmarExclusao() {
    const id = estado.idParaExcluir;
    el.btnConfirmarExcluir.disabled = true;

    try {
        await excluirLembrete(id);
        el.dlgExcluir.close();
        mostrarToast("Lembrete excluído com sucesso!", "sucesso");
        await carregarLembretes();
    } catch (erro) {
        console.error(erro);
        el.dlgExcluir.close();

        if (erro.status === 404) {
            mostrarToast("Este lembrete já tinha sido removido. A lista foi atualizada.", "erro");
            await carregarLembretes();
        } else {
            mostrarToast(`Não foi possível excluir o lembrete. ${erro.message}`, "erro");
        }
    } finally {
        el.btnConfirmarExcluir.disabled = false;
        estado.idParaExcluir = null;
    }
}

// ========================================
// MENSAGENS
// ========================================

function mostrarToast(mensagem, tipo = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${tipo}`;
    toast.textContent = mensagem;
    el.toasts.appendChild(toast);

    setTimeout(() => toast.remove(), tipo === "erro" ? 7000 : 4000);
}

function mostrarAvisoErro(mensagem) {
    el.avisoErroTexto.textContent = mensagem;
    el.avisoErro.hidden = false;
}

function esconderAvisoErro() {
    el.avisoErro.hidden = true;
}

// ========================================
// UTILITÁRIOS
// ========================================

function formatarData(valor) {
    if (!valor) return "-";

    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "-";

    return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function resumir(texto, limite = 50) {
    const limpo = String(texto ?? "").trim();
    return limpo.length > limite ? `${limpo.slice(0, limite)}…` : limpo;
}

// ========================================
// EVENTOS
// ========================================

el.btnNovo.addEventListener("click", () => abrirFormulario());
el.btnImprimir.addEventListener("click", gerarPdf);
el.btnTentarNovamente.addEventListener("click", carregarLembretes);

el.formFiltro.addEventListener("submit", (evento) => {
    evento.preventDefault();
    aplicarFiltros();
});
el.btnLimpar.addEventListener("click", limparFiltros);

// Clique no cabeçalho da coluna: ordena (e inverte a direção ao clicar de novo)
document.querySelector("thead").addEventListener("click", (evento) => {
    const botao = evento.target.closest(".ordenar");
    if (botao) ordenarPor(botao.dataset.ordem);
});

// Ordenação em telas pequenas
el.ordemMobile.addEventListener("change", () => {
    estado.ordem = el.ordemMobile.value;
    estado.pagina = 1;
    carregarLembretes();
});
el.direcaoMobile.addEventListener("click", () => {
    estado.direcao = estado.direcao === "ASC" ? "DESC" : "ASC";
    estado.pagina = 1;
    carregarLembretes();
});

// Ações da tabela (delegação de eventos, sem onclick inline)
el.lista.addEventListener("click", (evento) => {
    const botao = evento.target.closest("button[data-acao]");
    if (!botao) return;

    if (botao.dataset.acao === "editar") {
        buscarLembrete(botao.dataset.id);
    } else if (botao.dataset.acao === "excluir") {
        const linha = botao.closest("tr");
        pedirConfirmacaoExclusao(botao.dataset.id, linha.querySelector(".descricao").textContent);
    }
});

el.btnVazioAcao.addEventListener("click", () => {
    if (el.btnVazioAcao.dataset.acao === "limpar") limparFiltros();
    else abrirFormulario();
});

// Paginação
el.paginacaoBotoes.addEventListener("click", (evento) => {
    const botao = evento.target.closest("button[data-pagina]");
    if (!botao || botao.disabled) return;

    estado.pagina = Number(botao.dataset.pagina);
    carregarLembretes();
});

// Formulário
el.formLembrete.addEventListener("submit", salvarFormulario);
el.btnCancelar.addEventListener("click", fecharFormulario);
el.descricao.addEventListener("input", () => {
    atualizarContador();
    if (el.descricao.value.trim()) limparErroDescricao();
});

// Exclusão
el.btnCancelarExcluir.addEventListener("click", () => el.dlgExcluir.close());
el.btnConfirmarExcluir.addEventListener("click", confirmarExclusao);

// Fechar diálogos ao clicar fora (no fundo escuro)
for (const dialogo of [el.dlgLembrete, el.dlgExcluir]) {
    dialogo.addEventListener("click", (evento) => {
        // O clique no fundo escuro tem o próprio <dialog> como alvo; o padding também,
        // por isso conferimos se as coordenadas estão fora da caixa.
        const caixa = dialogo.getBoundingClientRect();
        const fora = evento.clientX < caixa.left || evento.clientX > caixa.right ||
                     evento.clientY < caixa.top || evento.clientY > caixa.bottom;
        if (evento.target === dialogo && fora) dialogo.close();
    });
}

// ========================================
// INICIALIZAÇÃO
// ========================================

document.addEventListener("DOMContentLoaded", () => {
    estado.tamanho = Number(el.tamanhoPagina.value);
    atualizarIndicadoresDeOrdenacao();
    carregarLembretes();
});