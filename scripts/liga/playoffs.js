// scripts/liga/playoffs.js

// ─────────────────────────────────────────────────────────────
// calcularClassificacaoLista(jogos)
// Retorna array ordenado de {id, nome, cor, pts, ...} pelos jogos
// Exportada para uso em liga.js (aba Times) e internamente nos playoffs
// ─────────────────────────────────────────────────────────────
export function calcularClassificacaoLista(jogos) {
    const times = {};

    jogos.forEach(jogo => {
        [jogo.timeA, jogo.timeB].forEach(t => {
            if (!times[t.id]) {
                times[t.id] = { id: t.id, nome: t.nome, cor: t.cor, j: 0, v: 0, d: 0, pts: 0, cestas: 0, cestasSofridas: 0 };
            }
        });
    });

    jogos.filter(j => j.status === "finalizado").forEach(jogo => {
        const a = times[jogo.timeA.id];
        const b = times[jogo.timeB.id];
        if (!a || !b) return;

        a.j++; b.j++;
        a.cestas += jogo.placarA;    a.cestasSofridas += jogo.placarB;
        b.cestas += jogo.placarB;    b.cestasSofridas += jogo.placarA;

        if (jogo.placarA > jogo.placarB) {
            a.v++; a.pts += 3; b.d++;
        } else if (jogo.placarB > jogo.placarA) {
            b.v++; b.pts += 3; a.d++;
        } else {
            a.v++; a.pts += 1; b.v++; b.pts += 1;
        }
    });

    return Object.values(times).sort((x, y) => {
        if (y.pts !== x.pts) return y.pts - x.pts;
        const sx = x.cestas - x.cestasSofridas;
        const sy = y.cestas - y.cestasSofridas;
        if (sy !== sx) return sy - sx;
        return y.cestas - x.cestas;
    });
}

// Modulo de playoffs - gerenciamento do chaveamento eliminatorio
export function initPlayoffs(ctx) {
    const {
        db, collection, doc, getDoc, getDocs, addDoc, updateDoc, writeBatch,
        serverTimestamp, query, orderBy,
        mostrarFeedback, carregarLigasAdmin
    } = ctx;

    // ─── Configuração de formatos MD ─────────────────────────────
    const MD_CONFIG = {
        MD1: { vit: 1, max: 1, label: "Jogo único" },
        MD3: { vit: 2, max: 3, label: "Melhor de 3" },
        MD5: { vit: 3, max: 5, label: "Melhor de 5" },
        MD7: { vit: 4, max: 7, label: "Melhor de 7" },
    };

    // ─── Estado dos playoffs ─────────────────────────────────────
    let poState = {
        ligaId:      null,
        ligaNome:    "",
        confrontos:  [],
        jogoAtivo:   null
    };

    // ─── DOM refs: modal iniciar playoffs ────────────────────────
    const modalIniciarPlayoffs       = document.getElementById("modal-iniciar-playoffs");
    const btnFecharIniciarPlayoffs   = document.getElementById("btn-fechar-iniciar-playoffs");
    const btnCancelarIniciarPlayoffs = document.getElementById("btn-cancelar-iniciar-playoffs");
    const btnConfirmarPlayoffs       = document.getElementById("btn-confirmar-playoffs");
    const poNumTimes                 = document.getElementById("po-num-times");
    const poFormatosFases            = document.getElementById("po-formatos-fases");

    // ─── DOM refs: modal bracket ─────────────────────────────────
    const modalPlayoffs     = document.getElementById("modal-playoffs");
    const poLigaNomeEl      = document.getElementById("po-liga-nome");
    const poCorpo           = document.getElementById("po-corpo");
    const btnFecharPlayoffs = document.getElementById("btn-fechar-playoffs");

    // ─── DOM refs: modal registrar jogo ──────────────────────────
    const modalJogoPlayoff    = document.getElementById("modal-jogo-playoff");
    const poJogoTitulo        = document.getElementById("po-jogo-titulo");
    const poJogoConfrontoEl   = document.getElementById("po-jogo-confronto");
    const poJogoLabelA        = document.getElementById("po-jogo-label-a");
    const poJogoLabelB        = document.getElementById("po-jogo-label-b");
    const poJogoInputA        = document.getElementById("po-jogo-placar-a");
    const poJogoInputB        = document.getElementById("po-jogo-placar-b");
    const btnFecharJogoPlayoff = document.getElementById("btn-fechar-jogo-playoff");
    const btnSalvarJogoPlayoff = document.getElementById("btn-salvar-jogo-playoff");
    const poQuartosLista       = document.getElementById("po-quartos-lista");
    const poBtnAddQuarto       = document.getElementById("po-btn-add-quarto");

    // ─── Quartos do modal de playoff ─────────────────────────────
    const ORDEM_QUARTOS_PO = ["Q1", "Q2", "Q3", "Q4", "OT"];

    function adicionarLinhaQuartoPo(periodo = "Q1", a = "", b = "") {
        const row = document.createElement("div");
        row.className = "quarto-row";
        const options = ORDEM_QUARTOS_PO.map(p =>
            `<option value="${p}" ${p === periodo ? "selected" : ""}>${p}</option>`
        ).join("");
        row.innerHTML = `
            <select class="quarto-select form-input">${options}</select>
            <input type="number" class="quarto-input quarto-input-a form-input" min="0" max="999" placeholder="0" value="${a}">
            <span class="quarto-sep">×</span>
            <input type="number" class="quarto-input quarto-input-b form-input" min="0" max="999" placeholder="0" value="${b}">
            <button type="button" class="btn-remover-quarto">✕</button>
        `;
        row.querySelector(".btn-remover-quarto").addEventListener("click", () => {
            row.remove();
            recalcularTotaisPo();
        });
        row.querySelectorAll(".quarto-input").forEach(inp =>
            inp.addEventListener("input", recalcularTotaisPo)
        );
        poQuartosLista.appendChild(row);
        recalcularTotaisPo();
    }

    function recalcularTotaisPo() {
        const rows = poQuartosLista.querySelectorAll(".quarto-row");
        if (rows.length === 0) return;
        let somaA = 0, somaB = 0;
        rows.forEach(row => {
            somaA += parseInt(row.querySelector(".quarto-input-a").value) || 0;
            somaB += parseInt(row.querySelector(".quarto-input-b").value) || 0;
        });
        poJogoInputA.value = somaA;
        poJogoInputB.value = somaB;
    }

    poBtnAddQuarto.addEventListener("click", () => {
        const usados = [...poQuartosLista.querySelectorAll(".quarto-select")].map(s => s.value);
        const proximo = ORDEM_QUARTOS_PO.find(p => !usados.includes(p)) || "Q1";
        adicionarLinhaQuartoPo(proximo);
    });

    // Fechar modais
    btnFecharIniciarPlayoffs.addEventListener("click", fecharModalIniciarPlayoffs);
    btnCancelarIniciarPlayoffs.addEventListener("click", fecharModalIniciarPlayoffs);
    modalIniciarPlayoffs.addEventListener("click", e => { if (e.target === modalIniciarPlayoffs) fecharModalIniciarPlayoffs(); });

    btnFecharPlayoffs.addEventListener("click", fecharModalPlayoffs);
    modalPlayoffs.addEventListener("click", e => { if (e.target === modalPlayoffs) fecharModalPlayoffs(); });

    btnFecharJogoPlayoff.addEventListener("click", fecharJogoPlayoff);
    modalJogoPlayoff.addEventListener("click", e => { if (e.target === modalJogoPlayoff) fecharJogoPlayoff(); });

    function fecharModalIniciarPlayoffs() { modalIniciarPlayoffs.classList.add("oculto"); }
    function fecharModalPlayoffs()        { modalPlayoffs.classList.add("oculto"); document.body.style.overflow = ""; }
    function fecharJogoPlayoff()          { modalJogoPlayoff.classList.add("oculto"); poState.jogoAtivo = null; }

    // ─────────────────────────────────────────────────────────────
    // Selects de formato MD por fase (gerados dinamicamente)
    // ─────────────────────────────────────────────────────────────
    const FASES_POR_NUM = { 2: ["final"], 4: ["semi", "final"], 8: ["quartas", "semi", "final"] };
    const NOMES_FASE    = { quartas: "Quartas de Final", semi: "Semifinais", final: "Final" };
    const PADRAO_FASE   = { quartas: "MD1", semi: "MD3", final: "MD5" };

    function renderizarSelectsFormato() {
        const num   = parseInt(poNumTimes.value) || 4;
        const fases = FASES_POR_NUM[num] || ["final"];

        poFormatosFases.innerHTML = fases.map(f => `
            <div style="margin-top:14px">
                <label class="form-label" for="po-fmt-${f}">${NOMES_FASE[f]} — Formato</label>
                <select id="po-fmt-${f}" class="form-input form-select">
                    <option value="MD1" ${PADRAO_FASE[f] === "MD1" ? "selected" : ""}>MD1 — Jogo único</option>
                    <option value="MD3" ${PADRAO_FASE[f] === "MD3" ? "selected" : ""}>MD3 — Melhor de 3 (2 vit.)</option>
                    <option value="MD5" ${PADRAO_FASE[f] === "MD5" ? "selected" : ""}>MD5 — Melhor de 5 (3 vit.)</option>
                    <option value="MD7" ${PADRAO_FASE[f] === "MD7" ? "selected" : ""}>MD7 — Melhor de 7 (4 vit.)</option>
                </select>
            </div>
        `).join("");
    }

    function lerFormatoFase(fase) {
        const el = document.getElementById(`po-fmt-${fase}`);
        return el ? el.value : "MD3";
    }

    poNumTimes.addEventListener("change", renderizarSelectsFormato);
    // Renderiza os selects na inicialização (para o valor padrão 4 times)
    renderizarSelectsFormato();

    // ─────────────────────────────────────────────────────────────
    // abrirModalIniciarPlayoffs(ligaId, ligaNome)
    // ─────────────────────────────────────────────────────────────
    function abrirModalIniciarPlayoffs(ligaId, ligaNome) {
        poState.ligaId   = ligaId;
        poState.ligaNome = ligaNome;
        renderizarSelectsFormato(); // garante selects atualizados ao abrir
        modalIniciarPlayoffs.classList.remove("oculto");
    }

    // Confirmar: lê formatos e gera o chaveamento
    btnConfirmarPlayoffs.addEventListener("click", async () => {
        const numTimes = parseInt(poNumTimes.value);
        const formatoFase = {
            quartas: lerFormatoFase("quartas"),
            semi:    lerFormatoFase("semi"),
            final:   lerFormatoFase("final"),
        };

        btnConfirmarPlayoffs.textContent = "Gerando...";
        btnConfirmarPlayoffs.disabled = true;

        const ok = await gerarPlayoffs(poState.ligaId, numTimes, formatoFase);

        btnConfirmarPlayoffs.textContent = "Gerar Chaveamento ⚡";
        btnConfirmarPlayoffs.disabled = false;

        if (ok) fecharModalIniciarPlayoffs();
    });

    // ─────────────────────────────────────────────────────────────
    // gerarPlayoffs(ligaId, numTimes, formatoFase)
    // Cria os confrontos no Firestore com formato MD por fase
    // ─────────────────────────────────────────────────────────────
    async function gerarPlayoffs(ligaId, numTimes, formatoFase = {}) {
        mostrarFeedback("Calculando classificação...", "info");

        try {
            const q    = query(collection(db, "ligas", ligaId, "jogos"), orderBy("rodada"));
            const snap = await getDocs(q);
            const jogos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            const classificacao = calcularClassificacaoLista(jogos);

            if (classificacao.length < numTimes) {
                mostrarFeedback(`Só há ${classificacao.length} times. Escolha um número menor.`, "erro");
                return false;
            }

            const seeds   = classificacao.slice(0, numTimes);
            const toTime  = t => ({ id: t.id, nome: t.nome, cor: t.cor });

            // Retorna { vit, max, label } para uma fase
            const fmtDe = fase => MD_CONFIG[formatoFase[fase]] || MD_CONFIG.MD3;

            const playoffsRef = collection(db, "ligas", ligaId, "playoffs");
            const batch       = writeBatch(db);

            // Helper: monta campos de formato para um confronto de uma fase
            const fmtCampos = fase => {
                const f = fmtDe(fase);
                return { formato: formatoFase[fase] || "MD3", vitoriasPrecisas: f.vit, maxJogos: f.max };
            };

            const base = { vitA: 0, vitB: 0, vencedor: null, jogos: [], criadoEm: serverTimestamp() };
            let confrontosData = [];

            if (numTimes === 2) {
                const finalRef = doc(playoffsRef);
                confrontosData = [{
                    ref:  finalRef,
                    data: { ...base, ...fmtCampos("final"), fase: "final", ordem: 1, timeA: toTime(seeds[0]), timeB: toTime(seeds[1]), proximoId: null, proximoLado: null }
                }];

            } else if (numTimes === 4) {
                const s1Ref    = doc(playoffsRef);
                const s2Ref    = doc(playoffsRef);
                const finalRef = doc(playoffsRef);

                confrontosData = [
                    { ref: s1Ref,    data: { ...base, ...fmtCampos("semi"),  fase: "semi",  ordem: 1, timeA: toTime(seeds[0]), timeB: toTime(seeds[3]), proximoId: finalRef.id, proximoLado: "A" } },
                    { ref: s2Ref,    data: { ...base, ...fmtCampos("semi"),  fase: "semi",  ordem: 2, timeA: toTime(seeds[1]), timeB: toTime(seeds[2]), proximoId: finalRef.id, proximoLado: "B" } },
                    { ref: finalRef, data: { ...base, ...fmtCampos("final"), fase: "final", ordem: 1, timeA: null, timeB: null, proximoId: null, proximoLado: null } },
                ];

            } else if (numTimes === 8) {
                const q1Ref = doc(playoffsRef);
                const q2Ref = doc(playoffsRef);
                const q3Ref = doc(playoffsRef);
                const q4Ref = doc(playoffsRef);
                const s1Ref = doc(playoffsRef);
                const s2Ref = doc(playoffsRef);
                const finalRef = doc(playoffsRef);

                confrontosData = [
                    { ref: q1Ref,    data: { ...base, ...fmtCampos("quartas"), fase: "quartas", ordem: 1, timeA: toTime(seeds[0]), timeB: toTime(seeds[7]), proximoId: s1Ref.id,    proximoLado: "A" } },
                    { ref: q2Ref,    data: { ...base, ...fmtCampos("quartas"), fase: "quartas", ordem: 2, timeA: toTime(seeds[3]), timeB: toTime(seeds[4]), proximoId: s1Ref.id,    proximoLado: "B" } },
                    { ref: q3Ref,    data: { ...base, ...fmtCampos("quartas"), fase: "quartas", ordem: 3, timeA: toTime(seeds[1]), timeB: toTime(seeds[6]), proximoId: s2Ref.id,    proximoLado: "A" } },
                    { ref: q4Ref,    data: { ...base, ...fmtCampos("quartas"), fase: "quartas", ordem: 4, timeA: toTime(seeds[2]), timeB: toTime(seeds[5]), proximoId: s2Ref.id,    proximoLado: "B" } },
                    { ref: s1Ref,    data: { ...base, ...fmtCampos("semi"),    fase: "semi",    ordem: 1, timeA: null, timeB: null, proximoId: finalRef.id, proximoLado: "A" } },
                    { ref: s2Ref,    data: { ...base, ...fmtCampos("semi"),    fase: "semi",    ordem: 2, timeA: null, timeB: null, proximoId: finalRef.id, proximoLado: "B" } },
                    { ref: finalRef, data: { ...base, ...fmtCampos("final"),   fase: "final",   ordem: 1, timeA: null, timeB: null, proximoId: null,         proximoLado: null } },
                ];
            }

            confrontosData.forEach(({ ref, data }) => batch.set(ref, data));
            batch.update(doc(db, "ligas", ligaId), { status: "playoffs" });
            await batch.commit();

            mostrarFeedback("Playoffs iniciados! ⚡", "sucesso");
            await carregarLigasAdmin();
            return true;

        } catch (erro) {
            console.error("Erro ao gerar playoffs:", erro);
            mostrarFeedback("Erro ao gerar playoffs.", "erro");
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // abrirModalPlayoffs(ligaId, ligaNome)
    // ─────────────────────────────────────────────────────────────
    async function abrirModalPlayoffs(ligaId, ligaNome) {
        poState.ligaId     = ligaId;
        poState.ligaNome   = ligaNome;
        poState.confrontos = [];

        poLigaNomeEl.textContent = `⚡ Playoffs — ${ligaNome}`;
        poCorpo.innerHTML = '<p class="draft-carregando">Carregando chaveamento...</p>';

        modalPlayoffs.classList.remove("oculto");
        document.body.style.overflow = "hidden";

        try {
            const snap = await getDocs(collection(db, "ligas", ligaId, "playoffs"));
            poState.confrontos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderizarBracketAdmin();
        } catch (erro) {
            console.error("Erro ao carregar playoffs:", erro);
            poCorpo.innerHTML = '<p class="draft-carregando">Erro ao carregar playoffs.</p>';
        }
    }

    // ─────────────────────────────────────────────────────────────
    // renderizarBracketAdmin()
    // ─────────────────────────────────────────────────────────────
    function renderizarBracketAdmin() {
        const ordemFases = ["quartas", "semi", "final"];
        const nomesFase  = { quartas: "⚡ Quartas de Final", semi: "🔥 Semifinais", final: "🏆 Final" };

        const porFase = {};
        poState.confrontos.forEach(c => {
            if (!porFase[c.fase]) porFase[c.fase] = [];
            porFase[c.fase].push(c);
        });

        let html = "";
        ordemFases.filter(f => porFase[f]).forEach(fase => {
            const lista = porFase[fase].sort((a, b) => a.ordem - b.ordem);
            html += `
                <div class="po-fase">
                    <div class="po-fase-label">${nomesFase[fase] || fase}</div>
                    <div class="po-confrontos">
                        ${lista.map(c => renderizarCardConfronto(c)).join("")}
                    </div>
                </div>
            `;
        });

        poCorpo.innerHTML = html || '<p class="draft-carregando">Nenhum confronto encontrado.</p>';

        poCorpo.querySelectorAll(".btn-po-registrar").forEach(btn => {
            btn.addEventListener("click", () => {
                const c = poState.confrontos.find(x => x.id === btn.dataset.confrontoId);
                if (c) abrirJogoPlayoff(c);
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // renderizarCardConfronto(c)
    // Card do admin — layout funcional e compacto
    // ─────────────────────────────────────────────────────────────
    function renderizarCardConfronto(c) {
        const temTimes   = c.timeA && c.timeB;
        const finalizado = !!c.vencedor;
        const jogados    = (c.jogos || []).length;

        const nomeA = c.timeA ? c.timeA.nome : "A definir";
        const nomeB = c.timeB ? c.timeB.nome : "A definir";
        const corA  = c.timeA ? c.timeA.cor  : "#444";
        const corB  = c.timeB ? c.timeB.cor  : "#444";
        const vitA  = c.vitA ?? 0;
        const vitB  = c.vitB ?? 0;

        const vencedorA = !!(c.vencedor && c.timeA && c.vencedor.id === c.timeA.id);
        const vencedorB = !!(c.vencedor && c.timeB && c.vencedor.id === c.timeB.id);

        const fmt      = c.formato  || "MD3";
        const maxJogos = c.maxJogos || 3;
        const fmtLabel = MD_CONFIG[fmt]?.label || `Melhor de ${maxJogos}`;

        const historicoHTML = (c.jogos || []).map((j, i) => `
            <div class="po-historico-jogo">
                <span class="po-historico-label">Jogo ${i + 1}</span>
                <span class="po-historico-placar ${j.placarA > j.placarB ? "po-num-vencedor" : ""}">${j.placarA}</span>
                <span class="po-historico-sep">×</span>
                <span class="po-historico-placar ${j.placarB > j.placarA ? "po-num-vencedor" : ""}">${j.placarB}</span>
            </div>
        `).join("");

        const campeaoHTML = (c.fase === "final" && finalizado)
            ? `<div class="po-campeao-badge">🏆 Campeão: ${c.vencedor.nome}</div>`
            : (finalizado ? `<div class="po-avanca-badge">✅ ${c.vencedor.nome} avança</div>` : "");

        const nextJogo  = jogados + 1;
        const jogoLabel = maxJogos > 1 ? `Registrar Jogo ${nextJogo} de ${maxJogos}` : "Registrar Resultado";
        const acoesHTML = (temTimes && !finalizado)
            ? `<div class="po-card-acoes"><button class="btn-po-registrar" data-confronto-id="${c.id}">${jogoLabel}</button></div>`
            : "";

        return `
            <div class="po-card ${finalizado ? "po-card-finalizado" : ""} ${!temTimes ? "po-card-aguardando" : ""}">
                <div class="po-card-header">
                    <span class="po-formato-badge">${fmt} · ${fmtLabel}</span>
                </div>
                <div class="po-card-confronto">
                    <div class="po-team-info ${vencedorA ? "po-time-ganhou" : ""}">
                        <div style="display:flex;align-items:center;gap:7px">
                            <span class="po-time-barra" style="background:${corA}"></span>
                            <span class="po-time-nome">${nomeA}</span>
                        </div>
                    </div>
                    <div class="po-serie-centro">
                        <div class="po-serie-nums">
                            <span class="po-serie-num ${vencedorA ? "ganhou" : ""}">${vitA}</span>
                            <span class="po-serie-sep">×</span>
                            <span class="po-serie-num ${vencedorB ? "ganhou" : ""}">${vitB}</span>
                        </div>
                        <span class="po-serie-label">série</span>
                    </div>
                    <div class="po-team-info po-team-info-dir ${vencedorB ? "po-time-ganhou" : ""}">
                        <div style="display:flex;align-items:center;gap:7px;justify-content:flex-end">
                            <span class="po-time-nome">${nomeB}</span>
                            <span class="po-time-barra" style="background:${corB}"></span>
                        </div>
                    </div>
                </div>
                ${historicoHTML ? `<div class="po-historico">${historicoHTML}</div>` : ""}
                ${campeaoHTML}
                ${acoesHTML}
            </div>
        `;
    }

    // ─────────────────────────────────────────────────────────────
    // abrirJogoPlayoff(confronto)
    // ─────────────────────────────────────────────────────────────
    function abrirJogoPlayoff(confronto) {
        poState.jogoAtivo = confronto;

        const numJogo  = (confronto.jogos?.length ?? 0) + 1;
        const maxJogos = confronto.maxJogos || 3;
        poJogoTitulo.textContent = maxJogos > 1
            ? `Jogo ${numJogo} de ${maxJogos} (${confronto.formato || "MD3"})`
            : `Jogo único (${confronto.formato || "MD1"})`;

        poJogoConfrontoEl.innerHTML = `
            <span class="confronto-time" style="color:${confronto.timeA.cor}">${confronto.timeA.nome}</span>
            <span class="confronto-vs">×</span>
            <span class="confronto-time" style="color:${confronto.timeB.cor}">${confronto.timeB.nome}</span>
        `;
        poJogoLabelA.textContent = confronto.timeA.nome;
        poJogoLabelB.textContent = confronto.timeB.nome;
        poJogoInputA.value = "";
        poJogoInputB.value = "";
        poQuartosLista.innerHTML = "";

        modalJogoPlayoff.classList.remove("oculto");
    }

    // Salva o resultado do jogo e verifica se a série acabou
    btnSalvarJogoPlayoff.addEventListener("click", async () => {
        const confronto = poState.jogoAtivo;
        if (!confronto) return;

        const placarA = parseInt(poJogoInputA.value);
        const placarB = parseInt(poJogoInputB.value);

        if (isNaN(placarA) || isNaN(placarB) || placarA < 0 || placarB < 0) {
            mostrarFeedback("Insira os placares de ambos os times.", "erro");
            return;
        }

        // Coletar quartos preenchidos
        const quartosObj = {};
        poQuartosLista.querySelectorAll(".quarto-row").forEach(row => {
            const periodo = row.querySelector(".quarto-select").value;
            const a = parseInt(row.querySelector(".quarto-input-a").value);
            const b = parseInt(row.querySelector(".quarto-input-b").value);
            if (!isNaN(a) && !isNaN(b)) quartosObj[periodo] = { A: a, B: b };
        });
        const novoJogo = { placarA, placarB };
        if (Object.keys(quartosObj).length > 0) novoJogo.quartos = quartosObj;

        const novosJogos = [...(confronto.jogos || []), novoJogo];

        let vitA = 0, vitB = 0;
        novosJogos.forEach(j => {
            if (j.placarA > j.placarB) vitA++;
            else if (j.placarB > j.placarA) vitB++;
        });

        // Usa vitoriasPrecisas do documento (configurado por fase)
        const precisa = confronto.vitoriasPrecisas ?? 2;
        let vencedor  = null;
        if (vitA >= precisa)      vencedor = confronto.timeA;
        else if (vitB >= precisa) vencedor = confronto.timeB;

        try {
            const confrontoRef = doc(db, "ligas", poState.ligaId, "playoffs", confronto.id);
            await updateDoc(confrontoRef, { jogos: novosJogos, vitA, vitB, vencedor });

            const idx = poState.confrontos.findIndex(c => c.id === confronto.id);
            poState.confrontos[idx] = { ...confronto, jogos: novosJogos, vitA, vitB, vencedor };

            if (vencedor && confronto.proximoId) {
                const campo      = confronto.proximoLado === "A" ? "timeA" : "timeB";
                const proximoRef = doc(db, "ligas", poState.ligaId, "playoffs", confronto.proximoId);
                await updateDoc(proximoRef, { [campo]: vencedor });

                const proximoIdx = poState.confrontos.findIndex(c => c.id === confronto.proximoId);
                if (proximoIdx >= 0) {
                    poState.confrontos[proximoIdx] = { ...poState.confrontos[proximoIdx], [campo]: vencedor };
                }
            }

            if (vencedor && confronto.fase === "final") {
                await updateDoc(doc(db, "ligas", poState.ligaId), { status: "encerrado", campeao: vencedor });
                mostrarFeedback(`🏆 ${vencedor.nome} é o campeão!`, "sucesso");
            } else {
                mostrarFeedback("Resultado salvo! 🏀", "sucesso");
            }

            // ── Criar votação de destaque para este jogo ─────────────
            if (placarA !== placarB) {
                try {
                    const jogoVencedor = placarA > placarB ? confronto.timeA : confronto.timeB;
                    const timeSnap = await getDoc(doc(db, "ligas", poState.ligaId, "times", jogoVencedor.id));
                    const jogadoresList = timeSnap.exists()
                        ? (timeSnap.data().jogadores || []).map(j => ({
                            uid:     j.uid,
                            nome:    j.nomeJogador || j.nome || "",
                            posicao: j.posicao || ""
                          }))
                        : [];

                    if (jogadoresList.length > 0) {
                        await addDoc(collection(db, "ligas", poState.ligaId, "votacoes"), {
                            confrontoId:   confronto.id,
                            confrontoFase: confronto.fase,
                            jogoNum:       novosJogos.length,
                            ligaId:        poState.ligaId,
                            ligaNome:      poState.ligaNome,
                            timeVencedor:  jogoVencedor,
                            jogadores:     jogadoresList,
                            votos:         {},
                            status:        "aberta",
                            destaque:      null,
                            criadoEm:      serverTimestamp(),
                        });
                    }
                } catch (errVot) {
                    console.warn("Não foi possível criar votação de destaque:", errVot);
                }
            }

            fecharJogoPlayoff();
            renderizarBracketAdmin();

        } catch (erro) {
            console.error("Erro ao salvar jogo de playoff:", erro);
            mostrarFeedback("Erro ao salvar resultado.", "erro");
        }
    });

    // ─────────────────────────────────────────────────────────────
    // renderizarPlayoffsJogador()
    // View read-only para o jogador
    // ─────────────────────────────────────────────────────────────
    async function renderizarPlayoffsJogador() {
        ctx.getVjcPlayoffsEl().innerHTML = '<p class="vjc-carregando">Carregando playoffs...</p>';

        try {
            const snap = await getDocs(collection(db, "ligas", ctx.getVjcState().ligaId, "playoffs"));
            const confrontos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            if (confrontos.length === 0) {
                ctx.getVjcPlayoffsEl().innerHTML = '<p class="vjc-vazio">Os playoffs ainda não foram gerados.</p>';
                return;
            }

            const ordemFases = ["quartas", "semi", "final"];
            const nomesFase  = { quartas: "⚡ Quartas de Final", semi: "🔥 Semifinais", final: "🏆 Final" };
            const porFase    = {};
            confrontos.forEach(c => {
                if (!porFase[c.fase]) porFase[c.fase] = [];
                porFase[c.fase].push(c);
            });

            let html = "";
            ordemFases.filter(f => porFase[f]).forEach(fase => {
                const lista = porFase[fase].sort((a, b) => a.ordem - b.ordem);
                html += `
                    <div class="po-fase">
                        <div class="po-fase-label">${nomesFase[fase]}</div>
                        <div class="po-confrontos">
                            ${lista.map(c => renderizarCardConfrontoJogador(c)).join("")}
                        </div>
                    </div>
                `;
            });

            ctx.getVjcPlayoffsEl().innerHTML = html;

        } catch (erro) {
            console.error("Erro ao carregar playoffs:", erro);
            ctx.getVjcPlayoffsEl().innerHTML = '<p class="vjc-vazio">Erro ao carregar playoffs.</p>';
        }
    }

    // ─────────────────────────────────────────────────────────────
    // renderizarCardConfrontoJogador(c)
    // Card da view do jogador — design detalhado com status e histórico
    // ─────────────────────────────────────────────────────────────
    function renderizarCardConfrontoJogador(c) {
        const temTimes   = c.timeA && c.timeB;
        const finalizado = !!c.vencedor;
        const jogados    = (c.jogos || []).length;

        const nomeA = c.timeA ? c.timeA.nome : "A definir";
        const nomeB = c.timeB ? c.timeB.nome : "A definir";
        const corA  = c.timeA ? c.timeA.cor  : "#444";
        const corB  = c.timeB ? c.timeB.cor  : "#444";
        const vitA  = c.vitA ?? 0;
        const vitB  = c.vitB ?? 0;

        const vencedorA = !!(c.vencedor && c.timeA && c.vencedor.id === c.timeA.id);
        const vencedorB = !!(c.vencedor && c.timeB && c.vencedor.id === c.timeB.id);

        const fmt      = c.formato  || "MD3";
        const maxJogos = c.maxJogos || 3;
        const fmtLabel = MD_CONFIG[fmt]?.label || `Melhor de ${maxJogos}`;

        // Status badge
        let statusCls, statusTxt;
        if (finalizado) {
            statusCls = "po-status-finalizado"; statusTxt = "Finalizado";
        } else if (jogados === 0) {
            statusCls = "po-status-aguardando"; statusTxt = temTimes ? "Aguardando início" : "Aguardando times";
        } else {
            statusCls = "po-status-emjogo";
            statusTxt = maxJogos > 1 ? `Jogo ${jogados + 1} de ${maxJogos}` : "Em jogo";
        }

        const statusHTML   = `<span class="po-status ${statusCls}"><span class="po-status-dot"></span>${statusTxt}</span>`;
        const formatoBadge = `<span class="po-formato-badge">${fmt} · ${fmtLabel}</span>`;

        const historicoHTML = (c.jogos || []).map((j, i) => {
            const quartosHtml = (() => {
                if (!j.quartos) return "";
                const periodos = ORDEM_QUARTOS_PO.filter(p => j.quartos[p] != null);
                if (!periodos.length) return "";
                const celulaLabel = p => `<div class="vjc-q-cell ${p === "OT" ? "vjc-q-label vjc-q-ot" : "vjc-q-label"}">${p}</div>`;
                const celulaVal = (p, lado) => {
                    const qA = j.quartos[p].A, qB = j.quartos[p].B;
                    const v = lado === "A" ? qA : qB;
                    const venceu = lado === "A" ? qA > qB : qB > qA;
                    const cls = p === "OT" ? "vjc-q-val vjc-q-ot" : (venceu ? "vjc-q-val vjc-q-winner" : "vjc-q-val");
                    return `<div class="vjc-q-cell ${cls}">${v}</div>`;
                };
                const labels = periodos.map(celulaLabel).join("");
                return `<div class="vjc-quarters vjc-quarters-sm">
                    <div class="vjc-q-time">
                        <div class="vjc-q-header">${labels}</div>
                        <div class="vjc-q-vals">${periodos.map(p => celulaVal(p, "A")).join("")}</div>
                    </div>
                    <div class="vjc-q-divider"></div>
                    <div class="vjc-q-time vjc-q-time-right">
                        <div class="vjc-q-header">${labels}</div>
                        <div class="vjc-q-vals">${periodos.map(p => celulaVal(p, "B")).join("")}</div>
                    </div>
                </div>`;
            })();
            const destaqueHtml = j.destaque
                ? `<div class="po-destaque-badge"><span class="icone-coroa"></span>Destaque: ${j.destaque.nome}</div>`
                : "";
            return `
                <div class="po-historico-jogo">
                    <span class="po-historico-label">Jogo ${i + 1}</span>
                    <span class="po-historico-placar ${j.placarA > j.placarB ? "po-num-vencedor" : ""}">${j.placarA}</span>
                    <span class="po-historico-sep">×</span>
                    <span class="po-historico-placar ${j.placarB > j.placarA ? "po-num-vencedor" : ""}">${j.placarB}</span>
                </div>
                ${quartosHtml}
                ${destaqueHtml}
            `;
        }).join("");

        const campeaoHTML = (c.fase === "final" && finalizado)
            ? `<div class="po-campeao-badge">🏆 Campeão: ${c.vencedor.nome}</div>`
            : (finalizado ? `<div class="po-avanca-badge">✅ ${c.vencedor.nome} avança</div>` : "");

        return `
            <div class="po-card ${finalizado ? "po-card-finalizado" : ""} ${!temTimes ? "po-card-aguardando" : ""}">
                <div class="po-card-header">
                    ${statusHTML}
                    ${formatoBadge}
                </div>
                <div class="po-card-confronto">
                    <div class="po-team-info ${vencedorA ? "po-time-ganhou" : ""}">
                        <div style="display:flex;align-items:center;gap:7px">
                            <span class="po-time-barra" style="background:${corA}"></span>
                            <span class="po-time-nome">${nomeA}</span>
                        </div>
                    </div>
                    <div class="po-serie-centro">
                        <div class="po-serie-nums">
                            <span class="po-serie-num ${vencedorA ? "ganhou" : ""}">${vitA}</span>
                            <span class="po-serie-sep">×</span>
                            <span class="po-serie-num ${vencedorB ? "ganhou" : ""}">${vitB}</span>
                        </div>
                        <span class="po-serie-label">série</span>
                    </div>
                    <div class="po-team-info po-team-info-dir ${vencedorB ? "po-time-ganhou" : ""}">
                        <div style="display:flex;align-items:center;gap:7px;justify-content:flex-end">
                            <span class="po-time-nome">${nomeB}</span>
                            <span class="po-time-barra" style="background:${corB}"></span>
                        </div>
                    </div>
                </div>
                ${historicoHTML ? `<div class="po-historico">${historicoHTML}</div>` : ""}
                ${campeaoHTML}
            </div>
        `;
    }

    return { abrirModalIniciarPlayoffs, abrirModalPlayoffs, renderizarPlayoffsJogador };
}
