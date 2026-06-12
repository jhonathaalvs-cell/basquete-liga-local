// ─────────────────────────────────────────────────────────────
// jogadores.js
// Lista todos os jogadores inscritos nas ligas (ativo, playoffs,
// encerrado), agrupados por liga. Filtro por liga no topo.
// Dados: ligas/{ligaId}/times + ligas/{ligaId}/inscricoes
// ─────────────────────────────────────────────────────────────

import { auth, db } from "./firebase-config.js";

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
                timesMap[d.id] = { nome: d.data().nome, cor: d.data().cor };
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
            // Promise.all para buscar o perfil (redes) de cada jogador em paralelo
            const jogadores = await Promise.all(inscricoesSnap.docs.map(async d => {
                const dados  = d.data();
                const time   = timesMap[dados.timeId] || null;
                const jogos = jogosPorTime[dados.timeId] || 0;
                const vit   = vitoriasPoTime[dados.timeId] || 0;

                // Redes: lê da inscrição primeiro (propagado pelo perfil.js ao salvar).
                // Cai para users/{uid} como fallback para jogadores que ainda não resalvaram.
                let redes = dados.redes || {};
                if (Object.keys(redes).length === 0) {
                    try {
                        const perfilSnap = await getDoc(doc(db, "users", d.id));
                        if (perfilSnap.exists()) redes = perfilSnap.data().redes || {};
                    } catch (e) {
                        console.warn("[jogadores] sem permissão para ler perfil de", d.id, "—", e.code);
                    }
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
                    redes
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
// gerarIniciais(nome) → "AB" a partir do nome do jogador
// ─────────────────────────────────────────────────────────────
function gerarIniciais(nome) {
    const palavras = (nome || "").trim().split(/\s+/);
    if (palavras.length === 1) return palavras[0].substring(0, 2).toUpperCase();
    return (palavras[0][0] + palavras[palavras.length - 1][0]).toUpperCase();
}

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

        const cardsHTML = liga.jogadores.map(j => {
            const iniciais    = gerarIniciais(j.nome);
            const cor         = j.timeCor || "#555";
            const pct         = j.pctVitorias;
            const pctCl       = pct !== null ? pctClasse(pct) : "jog-pct-nd";
            const pctVal      = pct !== null ? `${pct}%` : "—";
            const redesHtml   = renderRedesCard(j.redes);
            const pontosItem  = j.totalPontos > 0
                ? `<div class="jog-stat-item">
                       <span class="jog-stat-val jog-stat-destaque">${j.totalPontos}</span>
                       <span class="jog-stat-label">Pts total</span>
                   </div>
                   <div class="jog-stat-item">
                       <span class="jog-stat-val">${j.mediaPontos}</span>
                       <span class="jog-stat-label">Pts/jogo</span>
                   </div>`
                : "";

            return `
                <div class="jog-card">
                    <div class="jog-accent-bar" style="background:${cor}"></div>
                    <div class="jog-card-header">
                        <div class="jog-avatar" style="background:${cor}22;color:${cor}">${iniciais}</div>
                        <div class="jog-info">
                            <div class="jog-nome">${j.nome}</div>
                            <div class="jog-time-nome">
                                <span class="jog-time-dot" style="background:${cor}"></span>
                                ${j.timeNome}
                            </div>
                            ${j.posicao ? `<span class="jog-pos ${posClasse(j.posicao)}">${j.posicao}</span>` : ""}
                        </div>
                    </div>
                    <div class="jog-stats-strip">
                        <div class="jog-stat-item">
                            <span class="jog-stat-val ${pctCl}">${pctVal}</span>
                            <span class="jog-stat-label">Vitórias</span>
                        </div>
                        <div class="jog-stat-item">
                            <span class="jog-stat-val">${j.jogosCount}</span>
                            <span class="jog-stat-label">Jogos</span>
                        </div>
                        ${pontosItem}
                    </div>
                    ${redesHtml}
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
// Configuração das redes sociais (mesmo padrão do perfil.js)
// ─────────────────────────────────────────────────────────────
const REDES_CONFIG = [
    { id: "instagram", icone: "fa-brands fa-instagram", label: "Instagram", cor: "#C13584", url: u => `https://instagram.com/${u}` },
    { id: "tiktok",    icone: "fa-brands fa-tiktok",    label: "TikTok",    cor: "#010101", url: u => `https://tiktok.com/@${u}` },
    { id: "twitter",   icone: "fa-brands fa-x-twitter", label: "Twitter/X", cor: "#1DA1F2", url: u => `https://twitter.com/${u}` },
    { id: "youtube",   icone: "fa-brands fa-youtube",   label: "YouTube",   cor: "#FF0000", url: u => `https://youtube.com/@${u}` },
];

// Retorna o HTML dos chips de redes para um card de jogador
function renderRedesCard(redes) {
    if (!redes || Object.keys(redes).length === 0) return "";
    const chips = REDES_CONFIG
        .filter(r => redes[r.id])
        .map(r => `<a class="jog-rede-chip" href="${r.url(redes[r.id])}" target="_blank" rel="noopener noreferrer" title="${r.label}: @${redes[r.id]}" style="--rede-cor:${r.cor}"><i class="${r.icone}"></i></a>`)
        .join("");
    if (!chips) return "";
    return `<div class="jog-redes">${chips}</div>`;
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
