// ─────────────────────────────────────────────────────────────
// jogadores.js
// Lista todos os jogadores inscritos nas ligas (ativo, playoffs,
// encerrado), agrupados por liga. Filtro por liga no topo.
// Dados: ligas/{ligaId}/times + ligas/{ligaId}/inscricoes
// ─────────────────────────────────────────────────────────────

import { auth, db } from "./firebase-config.js";
import { corTime, avatarJogadorHtml, aplicarAvatarJogador } from "./franquias.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    orderBy,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ─── DOM refs ────────────────────────────────────────────────
const telaLoading   = document.getElementById("tela-loading");
const filtrosEl     = document.getElementById("filtros");
const selectLiga    = document.getElementById("select-liga");
const listaEl       = document.getElementById("lista-jogadores");

// ─── DOM refs — modal rápido do jogador ───────────────────────
const modalJogador   = document.getElementById("modal-jogador");
const btnFecharModal = document.getElementById("btn-fechar-jogador");
const mjAvatar       = document.getElementById("mj-avatar");
const mjNome         = document.getElementById("mj-nome");
const mjTimeDot      = document.getElementById("mj-time-dot");
const mjTimeNome     = document.getElementById("mj-time-nome");
const mjPos          = document.getElementById("mj-pos");
const mjStatsGrid    = document.getElementById("mj-stats-grid");
const mjBtnPerfil    = document.getElementById("mj-btn-perfil");

// ─── Estado ──────────────────────────────────────────────────
// Cada item: { ligaId, ligaNome, ligaStatus, jogadores: [{nome, posicao, timeNome, timeCor}] }
let todasLigas = [];

// ─────────────────────────────────────────────────────────────
// PONTO DE ENTRADA
// ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) {
        window.location.href = "index.html";
        return;
    }

    // Garante que o documento users/{uid} existe (para regras do Firestore)
    try {
        const snap = await getDoc(doc(db, "users", usuario.uid));
        if (!snap.exists()) {
            await setDoc(doc(db, "users", usuario.uid), { role: "jogador" });
        }
    } catch (e) { /* ignora */ }

    await carregarJogadores();
});

// ─────────────────────────────────────────────────────────────
// carregarJogadores()
// Busca todas as ligas ativas/playoffs/encerradas e seus jogadores
// ─────────────────────────────────────────────────────────────
async function carregarJogadores() {
    try {
        // Busca todas as ligas ordenadas por data
        const ligasSnap = await getDocs(
            query(collection(db, "ligas"), orderBy("criadoEm", "desc"))
        );

        // Filtra só ligas com jogadores formados
        const ligasValidas = ligasSnap.docs.filter(d => {
            const s = d.data().status;
            return s === "ativo" || s === "playoffs" || s === "encerrado";
        });

        if (ligasValidas.length === 0) {
            telaLoading.textContent = "Nenhuma liga com jogadores ainda.";
            return;
        }

        // Para cada liga, carrega times e inscrições em paralelo
        todasLigas = await Promise.all(ligasValidas.map(async (ligaDoc) => {
            const ligaId     = ligaDoc.id;
            const ligaData   = ligaDoc.data();
            const ligaNome   = ligaData.nome;
            const ligaStatus = ligaData.status;

            const [timesSnap, inscricoesSnap, jogosSnap] = await Promise.all([
                getDocs(collection(db, "ligas", ligaId, "times")),
                getDocs(collection(db, "ligas", ligaId, "inscricoes")),
                getDocs(collection(db, "ligas", ligaId, "jogos"))
            ]);

            // Mapa timeId → { nome, cor }
            const timesMap = {};
            timesSnap.docs.forEach(d => {
                const timeNome = d.data().nome;
                timesMap[d.id] = { nome: timeNome, cor: corTime(timeNome, d.data().cor) };
            });

            // Mapa timeId → nº de jogos finalizados e vitórias
            const jogosPorTime    = {};
            const vitoriasPoTime  = {};
            jogosSnap.docs.forEach(d => {
                const jogo = d.data();
                if (jogo.status !== "finalizado") return;
                const idA = jogo.timeA?.id;
                const idB = jogo.timeB?.id;
                if (idA) jogosPorTime[idA] = (jogosPorTime[idA] || 0) + 1;
                if (idB) jogosPorTime[idB] = (jogosPorTime[idB] || 0) + 1;
                // Vitórias
                const pA = Number(jogo.placarA) || 0;
                const pB = Number(jogo.placarB) || 0;
                if (pA > pB && idA) vitoriasPoTime[idA] = (vitoriasPoTime[idA] || 0) + 1;
                if (pB > pA && idB) vitoriasPoTime[idB] = (vitoriasPoTime[idB] || 0) + 1;
            });

            // Mapa uid → { totalPontos, jogosComPontos }
            const pontosMap = {};
            jogosSnap.docs.forEach(d => {
                const jogo = d.data();
                if (jogo.status !== "finalizado" || !jogo.pontosJogadores) return;
                Object.entries(jogo.pontosJogadores).forEach(([uid, pts]) => {
                    if (!pontosMap[uid]) pontosMap[uid] = { totalPontos: 0, jogosComPontos: 0 };
                    pontosMap[uid].totalPontos += Number(pts) || 0;
                    pontosMap[uid].jogosComPontos++;
                });
            });

            // Monta lista de jogadores com dados do time
            // Promise.all para buscar a foto oficial de cada jogador em paralelo
            const jogadores = await Promise.all(inscricoesSnap.docs.map(async d => {
                const dados  = d.data();
                const time   = timesMap[dados.timeId] || null;
                const jogos = jogosPorTime[dados.timeId] || 0;
                const vit   = vitoriasPoTime[dados.timeId] || 0;

                // fotoOficial só existe em users/{uid} (não é propagada pra inscrição),
                // então busca o perfil de cada jogador pra pegar ela.
                let fotoOficial = null;
                try {
                    const perfilSnap = await getDoc(doc(db, "users", d.id));
                    if (perfilSnap.exists()) {
                        fotoOficial = perfilSnap.data().fotoOficial || null;
                    }
                } catch (e) {
                    console.warn("[jogadores] sem permissão para ler perfil de", d.id, "—", e.code);
                }

                const statsP = pontosMap[d.id] || { totalPontos: 0, jogosComPontos: 0 };
                const mediaPontos = statsP.jogosComPontos > 0
                    ? Math.round((statsP.totalPontos / statsP.jogosComPontos) * 10) / 10
                    : 0;

                return {
                    uid:          d.id,
                    nome:         dados.nomeJogador || "Jogador",
                    posicao:      dados.posicao || "",
                    timeNome:     time ? time.nome : "Sem time",
                    timeCor:      time ? time.cor  : "#444",
                    timeId:       dados.timeId || null,
                    jogosCount:   jogos,
                    vitorias:     vit,
                    pctVitorias:  jogos > 0 ? Math.round((vit / jogos) * 100) : null,
                    totalPontos:  statsP.totalPontos,
                    mediaPontos,
                    fotoOficial
                };
            }));

            // Ordena alfabeticamente
            jogadores.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

            return { ligaId, ligaNome, ligaStatus, jogadores };
        }));

        // Preenche o select de filtro
        todasLigas.forEach(liga => {
            const opt = document.createElement("option");
            opt.value       = liga.ligaId;
            opt.textContent = liga.ligaNome;
            selectLiga.appendChild(opt);
        });

        telaLoading.classList.add("oculto");
        filtrosEl.classList.remove("oculto");

        renderizarLista();

        selectLiga.addEventListener("change", renderizarLista);

    } catch (erro) {
        console.error("Erro ao carregar jogadores:", erro);
        telaLoading.textContent = "Erro ao carregar jogadores.";
    }
}

// ─────────────────────────────────────────────────────────────
// Clique num card da lista (delegado, já que os cards são
// recriados a cada filtro) → abre o modal rápido do jogador
// ─────────────────────────────────────────────────────────────
listaEl.addEventListener("click", (evento) => {
    const card = evento.target.closest(".jog-card");
    if (!card) return;

    abrirModalJogador(card.dataset.uid, card.dataset.ligaId);
});

// ─────────────────────────────────────────────────────────────
// abrirModalJogador(uid, ligaId)
// Preenche e mostra o modal rápido a partir dos dados já
// carregados em memória (todasLigas) — sem nova consulta ao Firestore
// ─────────────────────────────────────────────────────────────
function abrirModalJogador(uid, ligaId) {
    const liga     = todasLigas.find(l => l.ligaId === ligaId);
    const jogador  = liga?.jogadores.find(j => j.uid === uid);
    if (!jogador) return;

    const cor = jogador.timeCor || "#555";

    aplicarAvatarJogador(mjAvatar, jogador.fotoOficial, jogador.nome, cor, "mj-avatar-foto");

    mjNome.textContent     = jogador.nome;
    mjTimeDot.style.background = cor;
    mjTimeNome.textContent = jogador.timeNome;

    if (jogador.posicao) {
        mjPos.textContent = jogador.posicao;
        mjPos.className   = `mj-pos ${posClasse(jogador.posicao)}`;
    } else {
        mjPos.classList.add("oculto");
    }

    const pct   = jogador.pctVitorias;
    const pctCl = pct !== null ? pctClasse(pct) : "jog-pct-nd";
    const pctVal = pct !== null ? `${pct}%` : "—";

    mjStatsGrid.innerHTML = `
        <div class="mj-stat-item">
            <span class="mj-stat-val">${jogador.jogosCount}</span>
            <span class="mj-stat-label">Jogos</span>
        </div>
        <div class="mj-stat-item">
            <span class="mj-stat-val ${pctCl}">${pctVal}</span>
            <span class="mj-stat-label">Vitórias</span>
        </div>
        <div class="mj-stat-item">
            <span class="mj-stat-val jog-stat-destaque">${jogador.totalPontos}</span>
            <span class="mj-stat-label">Pts total</span>
        </div>
        <div class="mj-stat-item">
            <span class="mj-stat-val">${jogador.mediaPontos}</span>
            <span class="mj-stat-label">Pts/jogo</span>
        </div>
    `;

    mjBtnPerfil.href = `jogador.html?uid=${encodeURIComponent(uid)}`;

    modalJogador.classList.remove("oculto");
}

// ─────────────────────────────────────────────────────────────
// fecharModalJogador()
// ─────────────────────────────────────────────────────────────
function fecharModalJogador() {
    modalJogador.classList.add("oculto");
}

btnFecharModal.addEventListener("click", fecharModalJogador);
modalJogador.addEventListener("click", (evento) => {
    if (evento.target === modalJogador) fecharModalJogador();
});

// ─────────────────────────────────────────────────────────────
// renderizarLista()
// Renderiza as seções de liga com seus cards de jogadores
// ─────────────────────────────────────────────────────────────
function renderizarLista() {
    listaEl.innerHTML = "";

    const filtro = selectLiga.value; // "" = todas

    const ligasFiltradas = filtro
        ? todasLigas.filter(l => l.ligaId === filtro)
        : todasLigas;

    if (ligasFiltradas.length === 0 || ligasFiltradas.every(l => l.jogadores.length === 0)) {
        listaEl.innerHTML = '<p class="jog-vazio">Nenhum jogador encontrado.</p>';
        return;
    }

    const statusTexto = {
        ativo:     "🔴 Em andamento",
        playoffs:  "⚡ Playoffs",
        encerrado: "⚫ Encerrado"
    };

    ligasFiltradas.forEach(liga => {
        if (liga.jogadores.length === 0) return;

        const secao = document.createElement("div");
        secao.className = "jog-secao";

        // Card minimalista: só foto + nome. Time, posição, stats, bio e
        // redes ficam pro modal rápido (clique no card) e pra página
        // completa do jogador (jogador.html).
        const cardsHTML = liga.jogadores.map(j => {
            const cor        = j.timeCor || "#555";
            const avatarHtml = avatarJogadorHtml(j.fotoOficial, j.nome, cor, "jog-avatar", "jog-avatar-foto");

            return `
                <div class="jog-card" data-uid="${j.uid}" data-liga-id="${liga.ligaId}">
                    <div class="jog-card-header">
                        ${avatarHtml}
                        <div class="jog-nome">${j.nome}</div>
                    </div>
                </div>
            `;
        }).join("");

        secao.innerHTML = `
            <div class="jog-secao-titulo">
                ${liga.ligaNome}
                <span style="font-size:11px;color:rgba(237,237,239,0.4);font-weight:400;letter-spacing:0;text-transform:none">
                    ${statusTexto[liga.ligaStatus] || ""} · ${liga.jogadores.length} jogador${liga.jogadores.length !== 1 ? "es" : ""}
                </span>
            </div>
            <div class="jog-lista-interna">${cardsHTML}</div>
        `;

        listaEl.appendChild(secao);
    });
}

// ─────────────────────────────────────────────────────────────
// pctClasse(pct) → classe CSS de cor para % de vitórias
// ─────────────────────────────────────────────────────────────
function pctClasse(pct) {
    if (pct >= 60) return "jog-pct-alto";
    if (pct >= 40) return "jog-pct-medio";
    return "jog-pct-baixo";
}

// ─────────────────────────────────────────────────────────────
// posClasse(posicao) → classe CSS de cor
// ─────────────────────────────────────────────────────────────
function posClasse(posicao) {
    const p = posicao.toLowerCase();
    if (p.includes("armador") && !p.includes("ala"))  return "jog-pos-pg";
    if (p.includes("ala-armador"))                    return "jog-pos-sg";
    if (p.includes("ala-pivô") || p.includes("ala-pivo")) return "jog-pos-pf";
    if (p.includes("ala"))                            return "jog-pos-sf";
    if (p.includes("pivô") || p.includes("pivo"))     return "jog-pos-c";
    return "jog-pos-nd";
}
