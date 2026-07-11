// ─────────────────────────────────────────────────────────────
// jogador.js
// Página individual de um jogador (jogador.html?uid=XXX).
// Busca a bio/posição/redes globais (users/{uid}) e monta o
// histórico do jogador em todas as ligas (ativo, playoffs,
// encerrado) em que ele participou, com stats por temporada.
// ─────────────────────────────────────────────────────────────

import { auth, db } from "./firebase-config.js";
import { corTime, aplicarAvatarJogador } from "./franquias.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ─── DOM refs ────────────────────────────────────────────────
const telaLoading       = document.getElementById("tela-loading");
const telaNaoEncontrado = document.getElementById("tela-nao-encontrado");
const conteudoEl        = document.getElementById("conteudo-jogador");

const jrBanner      = document.querySelector(".jr-banner");
const jrAvatar      = document.getElementById("jr-avatar");
const jrNome        = document.getElementById("jr-nome");
const jrTimeDot     = document.getElementById("jr-time-dot");
const jrTimeNome    = document.getElementById("jr-time-nome");
const jrPos         = document.getElementById("jr-pos");
const jrIdade       = document.getElementById("jr-idade");
const jrStatsAtual  = document.getElementById("jr-stats-atual");
const jrInscritoAtual = document.getElementById("jr-inscrito-atual");

const secaoBio  = document.getElementById("jr-secao-bio");
const jrBio     = document.getElementById("jr-bio");

const secaoRedes = document.getElementById("jr-secao-redes");
const jrRedes     = document.getElementById("jr-redes");

const secaoHistorico = document.getElementById("jr-secao-historico");
const jrHistorico    = document.getElementById("jr-historico");

// ─────────────────────────────────────────────────────────────
// PONTO DE ENTRADA
// ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) {
        window.location.href = "index.html";
        return;
    }
    await carregarJogador();
});

// ─────────────────────────────────────────────────────────────
// carregarJogador()
// Lê o uid da URL, busca o perfil global e monta o histórico
// de temporadas percorrendo todas as ligas formadas
// ─────────────────────────────────────────────────────────────
async function carregarJogador() {
    const uid = new URLSearchParams(window.location.search).get("uid");
    if (!uid) {
        mostrarNaoEncontrado();
        return;
    }

    try {
        // ── Perfil global: bio, posição, redes, foto oficial, nascimento (users/{uid}) ─
        let perfil = { bio: "", posicao: "", redes: {}, fotoOficial: null, dataNascimento: "" };
        try {
            const perfilSnap = await getDoc(doc(db, "users", uid));
            if (perfilSnap.exists()) {
                const dados = perfilSnap.data();
                perfil = {
                    bio:            dados.bio            || "",
                    posicao:        dados.posicao        || "",
                    redes:          dados.redes          || {},
                    fotoOficial:    dados.fotoOficial     || null,
                    dataNascimento: dados.dataNascimento  || ""
                };
            }
        } catch (e) {
            console.warn("[jogador] sem permissão para ler perfil de", uid, "—", e.code);
        }

        // ── Ligas com jogadores formados, mais recentes primeiro ─
        const ligasSnap = await getDocs(
            query(collection(db, "ligas"), orderBy("criadoEm", "desc"))
        );
        const ligasValidas = ligasSnap.docs.filter(d => {
            const s = d.data().status;
            return s === "ativo" || s === "playoffs" || s === "encerrado";
        });

        // ── Monta uma "temporada" por liga em que o jogador está inscrito ─
        const temporadas = (await Promise.all(
            ligasValidas.map(ligaDoc => buscarTemporada(ligaDoc, uid))
        )).filter(Boolean);

        if (temporadas.length === 0) {
            mostrarNaoEncontrado();
            return;
        }

        // Temporada em destaque: a liga ativa (se houver), senão a mais recente
        const atual = temporadas.find(t => t.ligaStatus === "ativo") || temporadas[0];

        renderizarJogador(atual, temporadas, perfil);

    } catch (erro) {
        console.error("Erro ao carregar jogador:", erro);
        mostrarNaoEncontrado();
    }
}

// ─────────────────────────────────────────────────────────────
// buscarTemporada(ligaDoc, uid)
// Retorna os dados do jogador nessa liga (nome, time, stats), ou
// null se ele não estiver inscrito nela
// ─────────────────────────────────────────────────────────────
async function buscarTemporada(ligaDoc, uid) {
    const ligaId   = ligaDoc.id;
    const ligaData = ligaDoc.data();

    const inscricaoSnap = await getDoc(doc(db, "ligas", ligaId, "inscricoes", uid));
    if (!inscricaoSnap.exists()) return null;

    const inscricao = inscricaoSnap.data();

    const [timesSnap, jogosSnap] = await Promise.all([
        getDocs(collection(db, "ligas", ligaId, "times")),
        getDocs(collection(db, "ligas", ligaId, "jogos"))
    ]);

    // Mapa timeId → { nome, cor }
    const timesMap = {};
    timesSnap.docs.forEach(d => {
        const nome = d.data().nome;
        timesMap[d.id] = { nome, cor: corTime(nome, d.data().cor) };
    });

    const time = timesMap[inscricao.timeId] || null;

    // Percorre os jogos finalizados do time do jogador nessa liga
    let jogosCount = 0;
    let vitorias   = 0;
    let totalPontos = 0;
    let jogosComPontos = 0;

    jogosSnap.docs.forEach(d => {
        const jogo = d.data();
        if (jogo.status !== "finalizado") return;

        const idA = jogo.timeA?.id;
        const idB = jogo.timeB?.id;
        const souTimeA = idA === inscricao.timeId;
        const souTimeB = idB === inscricao.timeId;

        if (souTimeA || souTimeB) {
            jogosCount++;
            const placarA = Number(jogo.placarA) || 0;
            const placarB = Number(jogo.placarB) || 0;
            if ((souTimeA && placarA > placarB) || (souTimeB && placarB > placarA)) vitorias++;
        }

        if (jogo.pontosJogadores && jogo.pontosJogadores[uid] != null) {
            totalPontos += Number(jogo.pontosJogadores[uid]) || 0;
            jogosComPontos++;
        }
    });

    const mediaPontos = jogosComPontos > 0
        ? Math.round((totalPontos / jogosComPontos) * 10) / 10
        : 0;

    return {
        ligaId,
        ligaNome:    ligaData.nome,
        ligaStatus:  ligaData.status,
        nomeJogador: inscricao.nomeJogador || "Jogador",
        timeNome:    time ? time.nome : "Sem time",
        timeCor:     time ? time.cor  : "#555",
        inscritoEm:  formatarData(inscricao.inscritoEm),
        jogosCount,
        vitorias,
        pctVitorias: jogosCount > 0 ? Math.round((vitorias / jogosCount) * 100) : null,
        totalPontos,
        mediaPontos
    };
}

// ─────────────────────────────────────────────────────────────
// renderizarJogador(atual, temporadas, perfil)
// Preenche banner, stats da temporada atual, bio, redes e
// histórico completo de temporadas
// ─────────────────────────────────────────────────────────────
function renderizarJogador(atual, temporadas, perfil) {
    telaLoading.classList.add("oculto");
    conteudoEl.classList.remove("oculto");

    document.title = `${atual.nomeJogador} — Jogador`;

    const cor = atual.timeCor || "#555";

    // Banner
    jrBanner.style.borderTopColor = cor;

    aplicarAvatarJogador(jrAvatar, perfil.fotoOficial, atual.nomeJogador, cor, "jr-avatar-img");
    jrAvatar.style.borderColor = `${cor}55`;

    jrNome.textContent         = atual.nomeJogador;
    jrTimeDot.style.background = cor;
    jrTimeNome.textContent     = atual.timeNome;

    if (perfil.posicao) {
        jrPos.textContent = perfil.posicao;
        jrPos.className   = `jr-pos ${posClasse(perfil.posicao)}`;
    }

    const idade = calcularIdade(perfil.dataNascimento);
    if (idade !== null) {
        jrIdade.textContent = `${idade} anos`;
        jrIdade.classList.remove("oculto");
    }

    // Stats da temporada atual
    const pct    = atual.pctVitorias;
    const pctCl  = pct !== null ? pctClasse(pct) : "jr-pct-nd";
    const pctVal = pct !== null ? `${pct}%` : "—";

    if (atual.inscritoEm) {
        jrInscritoAtual.textContent = `Inscrito na liga em ${atual.inscritoEm}`;
        jrInscritoAtual.classList.remove("oculto");
    }

    jrStatsAtual.innerHTML = `
        <div class="jr-stat-item">
            <span class="jr-stat-val">${atual.jogosCount}</span>
            <span class="jr-stat-label">Jogos</span>
        </div>
        <div class="jr-stat-item">
            <span class="jr-stat-val ${pctCl}">${pctVal}</span>
            <span class="jr-stat-label">Vitórias</span>
        </div>
        <div class="jr-stat-item">
            <span class="jr-stat-val jr-stat-destaque">${atual.totalPontos}</span>
            <span class="jr-stat-label">Pts total</span>
        </div>
        <div class="jr-stat-item">
            <span class="jr-stat-val">${atual.mediaPontos}</span>
            <span class="jr-stat-label">Pts/jogo</span>
        </div>
    `;

    // Bio (textContent — seguro, sem risco de HTML injetado)
    if (perfil.bio) {
        jrBio.textContent = perfil.bio;
        secaoBio.classList.remove("oculto");
    }

    // Redes sociais
    const redesHtml = renderRedes(perfil.redes);
    if (redesHtml) {
        jrRedes.innerHTML = redesHtml;
        secaoRedes.classList.remove("oculto");
    }

    // Histórico de temporadas
    if (temporadas.length > 0) {
        jrHistorico.innerHTML = temporadas.map(renderCardTemporada).join("");
        secaoHistorico.classList.remove("oculto");
    }
}

// ─────────────────────────────────────────────────────────────
// mostrarNaoEncontrado()
// ─────────────────────────────────────────────────────────────
function mostrarNaoEncontrado() {
    telaLoading.classList.add("oculto");
    telaNaoEncontrado.classList.remove("oculto");
}

// ─────────────────────────────────────────────────────────────
// renderCardTemporada(t) → card de uma temporada no histórico
// ─────────────────────────────────────────────────────────────
const STATUS_TEXTO = {
    ativo:     "🔴 Em andamento",
    playoffs:  "⚡ Playoffs",
    encerrado: "⚫ Encerrado"
};

function renderCardTemporada(t) {
    const cor    = t.timeCor || "#555";
    const pct    = t.pctVitorias;
    const pctCl  = pct !== null ? pctClasse(pct) : "jr-pct-nd";
    const pctVal = pct !== null ? `${pct}%` : "—";

    return `
        <div class="jr-hist-card">
            <div class="jr-hist-accent" style="background:${cor}"></div>
            <div class="jr-hist-corpo">
                <div class="jr-hist-header">
                    <span class="jr-hist-liga">${t.ligaNome}</span>
                    <span class="jr-hist-status">${STATUS_TEXTO[t.ligaStatus] || ""}</span>
                </div>
                <div class="jr-hist-time">
                    <span class="jr-hist-time-dot" style="background:${cor}"></span>
                    ${t.timeNome}
                </div>
                ${t.inscritoEm ? `<div class="jr-hist-inscrito">Inscrito em ${t.inscritoEm}</div>` : ""}
                <div class="jr-hist-stats">
                    <div class="jr-hist-stat">
                        <span class="jr-hist-val">${t.jogosCount}</span>
                        <span class="jr-hist-label">Jogos</span>
                    </div>
                    <div class="jr-hist-stat">
                        <span class="jr-hist-val ${pctCl}">${pctVal}</span>
                        <span class="jr-hist-label">Vitórias</span>
                    </div>
                    <div class="jr-hist-stat">
                        <span class="jr-hist-val">${t.totalPontos}</span>
                        <span class="jr-hist-label">Pts</span>
                    </div>
                    <div class="jr-hist-stat">
                        <span class="jr-hist-val">${t.mediaPontos}</span>
                        <span class="jr-hist-label">Pts/jogo</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ─────────────────────────────────────────────────────────────
// Configuração das redes sociais (mesmo padrão do perfil.js)
// ─────────────────────────────────────────────────────────────
const REDES_CONFIG = [
    { id: "instagram", icone: "fa-brands fa-instagram", cor: "#C13584", url: u => `https://instagram.com/${u}` },
    { id: "tiktok",    icone: "fa-brands fa-tiktok",    cor: "#010101", url: u => `https://tiktok.com/@${u}` },
    { id: "twitter",   icone: "fa-brands fa-x-twitter", cor: "#1DA1F2", url: u => `https://twitter.com/${u}` },
    { id: "youtube",   icone: "fa-brands fa-youtube",   cor: "#FF0000", url: u => `https://youtube.com/@${u}` },
];

function renderRedes(redes) {
    if (!redes || Object.keys(redes).length === 0) return "";
    return REDES_CONFIG
        .filter(r => redes[r.id])
        .map(r => `<a class="jr-rede-chip" href="${r.url(redes[r.id])}" target="_blank" rel="noopener noreferrer" style="--rede-cor:${r.cor}"><i class="${r.icone}"></i> @${redes[r.id]}</a>`)
        .join("");
}

// ─────────────────────────────────────────────────────────────
// pctClasse(pct) → classe CSS de cor para % de vitórias
// ─────────────────────────────────────────────────────────────
function pctClasse(pct) {
    if (pct >= 60) return "jr-pct-alto";
    if (pct >= 40) return "jr-pct-medio";
    return "jr-pct-baixo";
}

// ─────────────────────────────────────────────────────────────
// posClasse(posicao) → classe CSS de cor
// ─────────────────────────────────────────────────────────────
function posClasse(posicao) {
    const p = posicao.toLowerCase();
    if (p.includes("armador") && !p.includes("ala"))  return "jr-pos-pg";
    if (p.includes("ala-armador"))                    return "jr-pos-sg";
    if (p.includes("ala-pivô") || p.includes("ala-pivo")) return "jr-pos-pf";
    if (p.includes("ala"))                            return "jr-pos-sf";
    if (p.includes("pivô") || p.includes("pivo"))     return "jr-pos-c";
    return "jr-pos-nd";
}

// ─────────────────────────────────────────────────────────────
// calcularIdade(dataNascimento) → idade em anos, ou null se não
// houver data salva. dataNascimento vem no formato "AAAA-MM-DD"
// (input type="date"). Acrescenta hora local pra evitar o input
// "voltar" um dia por causa de fuso horário (parse em UTC puro).
// ─────────────────────────────────────────────────────────────
function calcularIdade(dataNascimento) {
    if (!dataNascimento) return null;
    const nascimento = new Date(`${dataNascimento}T00:00:00`);
    if (isNaN(nascimento.getTime())) return null;

    const hoje = new Date();
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const aindaNaoFezAniversario =
        hoje.getMonth() < nascimento.getMonth() ||
        (hoje.getMonth() === nascimento.getMonth() && hoje.getDate() < nascimento.getDate());
    if (aindaNaoFezAniversario) idade--;

    return idade;
}

// ─────────────────────────────────────────────────────────────
// formatarData(timestamp) → "DD/MM/AAAA" a partir de um Timestamp
// do Firestore (ex: inscritoEm), ou null se não existir
// ─────────────────────────────────────────────────────────────
function formatarData(timestamp) {
    if (!timestamp) return null;
    const data = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(data.getTime())) return null;
    return data.toLocaleDateString("pt-BR");
}
