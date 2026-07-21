// ─────────────────────────────────────────────────────────────
// jogador.js
// Página individual de um jogador (jogador.html?uid=XXX).
// Busca a bio/posição/redes globais (users/{uid}) e monta o
// histórico do jogador em todas as ligas (ativo, playoffs,
// encerrado) em que ele participou, com stats por temporada.
// ─────────────────────────────────────────────────────────────

import { auth, db } from "./firebase-config.js";
import { corTime, aplicarAvatarJogador, identidadeCardTime, gerarIniciais } from "./franquias.js";

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

const secaoJogos    = document.getElementById("jr-secao-jogos");
const btnToggleJogos = document.getElementById("jr-toggle-jogos");
const jrListaJogos   = document.getElementById("jr-lista-jogos");

// ─── DOM refs — botão e card de exportação (imagem) ───────────
const btnBaixarCard   = document.getElementById("btn-baixar-card");
const cardExportEl    = document.getElementById("card-jogador");
const cjeBg           = document.getElementById("cje-bg");
const cjeLigaNome     = document.getElementById("cje-liga-nome");
const cjeTemporada    = document.getElementById("cje-temporada");
const cjePhotoInner   = document.getElementById("cje-photo-inner");
const cjePosBadge     = document.getElementById("cje-pos-badge");
const cjeNome         = document.getElementById("cje-nome");
const cjeTimeDot      = document.getElementById("cje-time-dot");
const cjeTimeNome     = document.getElementById("cje-time-nome");
const cjeIdade        = document.getElementById("cje-idade");
const cjeStatJogos    = document.getElementById("cje-stat-jogos");
const cjeStatVit      = document.getElementById("cje-stat-vit");
const cjeStatPts      = document.getElementById("cje-stat-pts");
const cjeStatMedia    = document.getElementById("cje-stat-media");
const cjeFooterTemporada = document.getElementById("cje-footer-temporada");

// Guarda os dados já carregados do jogador em destaque pra montar
// o card de exportação sob demanda, sem refazer as consultas
let jogadorCarregado = null; // { atual, perfil }

// ─────────────────────────────────────────────────────────────
// Histórico de Jogos: não é um botão de ação, é só a seção que
// expande/recolhe a lista ao clicar (os jogos já estão carregados
// em memória — não busca nada de novo no Firestore)
// ─────────────────────────────────────────────────────────────
btnToggleJogos.addEventListener("click", () => {
    const aberto = jrListaJogos.classList.toggle("oculto") === false;
    btnToggleJogos.setAttribute("aria-expanded", String(aberto));
});

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
        // ── Perfil global: nome completo, bio, posição, redes, foto, nascimento (users/{uid}) ─
        let perfil = { nomeCompleto: "", bio: "", posicao: "", redes: {}, fotoOficial: null, dataNascimento: "" };
        try {
            const perfilSnap = await getDoc(doc(db, "users", uid));
            if (perfilSnap.exists()) {
                const dados = perfilSnap.data();
                perfil = {
                    nomeCompleto:   dados.nomeCompleto   || "",
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

        // Junta os jogos de todas as temporadas num histórico único,
        // do mais recente pro mais antigo (jogos sem data vão pro fim)
        const historicoJogos = temporadas
            .flatMap(t => t.jogosDetalhados)
            .sort((a, b) => (b.data || "0000-00-00").localeCompare(a.data || "0000-00-00"));

        renderizarJogador(atual, temporadas, perfil, historicoJogos);

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
    const ligaNome = ligaData.nome;

    // Percorre os jogos finalizados do time do jogador nessa liga
    let jogosCount = 0;
    let vitorias   = 0;
    let totalPontos = 0;
    let jogosComPontos = 0;
    const jogosDetalhados = []; // um item por jogo — usado no Histórico de Jogos

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
            const venceu  = (souTimeA && placarA > placarB) || (souTimeB && placarB > placarA);
            if (venceu) vitorias++;

            const adversario = souTimeA ? jogo.timeB : jogo.timeA;
            jogosDetalhados.push({
                jogoId:          d.id,
                data:            jogo.data || null,
                dataFormatada:   formatarDataJogo(jogo.data),
                ligaNome,
                meuTimeCor:      time ? time.cor : "#555",
                adversarioNome:  adversario?.nome || "Adversário",
                meuPlacar:       souTimeA ? placarA : placarB,
                placarAdversario: souTimeA ? placarB : placarA,
                venceu,
                pontosJogador:   Number(jogo.pontosJogadores?.[uid]) || 0
            });
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
        ligaNome,
        ligaStatus:  ligaData.status,
        ligaAno:     ligaData.criadoEm?.toDate ? ligaData.criadoEm.toDate().getFullYear() : new Date().getFullYear(),
        nomeJogador: inscricao.nomeJogador || "Jogador",
        timeNome:    time ? time.nome : "Sem time",
        timeCor:     time ? time.cor  : "#555",
        inscritoEm:  formatarData(inscricao.inscritoEm),
        jogosCount,
        vitorias,
        pctVitorias: jogosCount > 0 ? Math.round((vitorias / jogosCount) * 100) : null,
        totalPontos,
        mediaPontos,
        jogosDetalhados
    };
}

// ─────────────────────────────────────────────────────────────
// renderizarJogador(atual, temporadas, perfil, historicoJogos)
// Preenche banner, stats da temporada atual, bio, redes,
// histórico completo de temporadas e histórico de jogos
// ─────────────────────────────────────────────────────────────
function renderizarJogador(atual, temporadas, perfil, historicoJogos) {
    telaLoading.classList.add("oculto");
    conteudoEl.classList.remove("oculto");

    jogadorCarregado = { atual, perfil };

    // Nome completo (Perfil) tem prioridade sobre o apelido registrado na liga
    const nomeExibido = perfil.nomeCompleto || atual.nomeJogador;

    document.title = `${nomeExibido} — Jogador`;

    const cor = atual.timeCor || "#555";

    // Banner
    jrBanner.style.borderTopColor = cor;

    aplicarAvatarJogador(jrAvatar, perfil.fotoOficial, nomeExibido, cor, "jr-avatar-img");
    jrAvatar.style.borderColor = `${cor}55`;

    jrNome.textContent         = nomeExibido;
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

    // Histórico de jogos — a seção fica visível, mas a lista em si só
    // aparece quando a pessoa clica pra expandir (ver toggle mais abaixo)
    if (historicoJogos.length > 0) {
        const mostrarLiga = temporadas.length > 1;
        jrListaJogos.innerHTML = historicoJogos.map(j => renderJogoItem(j, mostrarLiga)).join("");
        secaoJogos.classList.remove("oculto");
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
// quebrarNomeCard(nome) → nome em até 2 linhas (\n no meio),
// pra caber bem no card mesmo com nome completo grande
// ─────────────────────────────────────────────────────────────
function quebrarNomeCard(nome) {
    const palavras = nome.trim().split(/\s+/);
    if (palavras.length <= 2) return nome;
    const meio = Math.ceil(palavras.length / 2);
    return `${palavras.slice(0, meio).join(" ")}\n${palavras.slice(meio).join(" ")}`;
}

// ─────────────────────────────────────────────────────────────
// formatarPosicaoCard(posicao) → "Ala-Armador (SG)" → "ALA-ARMADOR · SG"
// ─────────────────────────────────────────────────────────────
function formatarPosicaoCard(posicao) {
    return posicao.toUpperCase().replace("(", "· ").replace(")", "");
}

// ─────────────────────────────────────────────────────────────
// preencherCardExport()
// Copia os dados já carregados do jogador pro card oculto
// (#card-jogador), que existe só pra ser capturado em imagem
// ─────────────────────────────────────────────────────────────
function preencherCardExport() {
    const { atual, perfil } = jogadorCarregado;
    const cor = atual.timeCor || "#555";
    const nomeExibido = perfil.nomeCompleto || atual.nomeJogador;

    // Cores do time nesse card (fundo em gradiente + acento) — cadastradas
    // por franquia em franquias.js, com fallback derivado da cor normal
    const identidadeCard = identidadeCardTime(atual.timeNome, cor);
    cjeBg.style.setProperty("--cje-escura", identidadeCard.cardEscura);
    cjeBg.style.setProperty("--cje-media",  identidadeCard.cardMedia);
    cjeTimeDot.style.setProperty("--cje-accent", identidadeCard.cardAccent);

    cjeLigaNome.textContent  = atual.ligaNome;
    cjeTemporada.textContent = atual.ligaAno;
    cjeFooterTemporada.textContent = `Temporada ${atual.ligaAno}`;

    // Foto/iniciais — dourado sempre, independente da cor do time (visual
    // uniforme de "card de colecionador"), por isso não usa aplicarAvatarJogador
    cjePhotoInner.innerHTML = "";
    if (perfil.fotoOficial) {
        const img = document.createElement("img");
        img.className = "cje-photo-img";
        img.src = perfil.fotoOficial;
        img.alt = "";
        img.onerror = () => {
            cjePhotoInner.innerHTML = "";
            cjePhotoInner.textContent = gerarIniciais(nomeExibido);
        };
        cjePhotoInner.appendChild(img);
    } else {
        cjePhotoInner.textContent = gerarIniciais(nomeExibido);
    }

    cjeNome.textContent         = quebrarNomeCard(nomeExibido);
    cjeTimeNome.textContent     = atual.timeNome;

    if (perfil.posicao) {
        cjePosBadge.textContent = formatarPosicaoCard(perfil.posicao);
        cjePosBadge.classList.remove("oculto");
    } else {
        cjePosBadge.classList.add("oculto");
    }

    const idade = calcularIdade(perfil.dataNascimento);
    if (idade !== null) {
        cjeIdade.textContent = `${idade} anos`;
        cjeIdade.classList.remove("oculto");
    } else {
        cjeIdade.classList.add("oculto");
    }

    const pct = atual.pctVitorias;
    cjeStatJogos.textContent = atual.jogosCount;
    cjeStatVit.textContent   = pct !== null ? `${pct}%` : "—";
    cjeStatPts.textContent   = atual.totalPontos;
    cjeStatMedia.textContent = atual.mediaPontos;
}

// ─────────────────────────────────────────────────────────────
// aguardarImagemCarregar(container)
// Espera a <img> dentro do container terminar de carregar (ou
// falhar) antes de capturar o card — evita foto cortada/em branco
// na imagem gerada.
// ─────────────────────────────────────────────────────────────
function aguardarImagemCarregar(container) {
    const img = container.querySelector("img");
    if (!img || img.complete) return Promise.resolve();
    return new Promise(resolve => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
    });
}

// ─────────────────────────────────────────────────────────────
// baixarCardJogador()
// Gera o PNG do card (via html2canvas) e dispara o download
// ─────────────────────────────────────────────────────────────
async function baixarCardJogador() {
    if (!jogadorCarregado || typeof html2canvas === "undefined") return;

    const textoOriginal = btnBaixarCard.innerHTML;
    btnBaixarCard.disabled = true;
    btnBaixarCard.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...';

    try {
        preencherCardExport();
        await aguardarImagemCarregar(cjePhotoInner);

        const canvas = await html2canvas(cardExportEl, {
            backgroundColor: null,
            scale: 3,
            useCORS: true
        });

        const nomeExibido  = jogadorCarregado.perfil.nomeCompleto || jogadorCarregado.atual.nomeJogador;
        const nomeArquivo  = nomeExibido.trim().replace(/\s+/g, "_");
        const ano          = jogadorCarregado.atual.ligaAno;

        const link = document.createElement("a");
        link.download = `card_${nomeArquivo}_AGB${ano}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();

    } catch (erro) {
        console.error("Erro ao gerar card do jogador:", erro);
        alert("Não foi possível gerar a imagem. Tente novamente.");
    } finally {
        btnBaixarCard.disabled = false;
        btnBaixarCard.innerHTML = textoOriginal;
    }
}

btnBaixarCard.addEventListener("click", baixarCardJogador);

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
// renderJogoItem(j, mostrarLiga) → linha de um jogo no
// Histórico de Jogos (data, adversário, placar e pontos feitos)
// ─────────────────────────────────────────────────────────────
function renderJogoItem(j, mostrarLiga) {
    return `
        <div class="jr-jogo-item">
            <div class="jr-jogo-info">
                <div class="jr-jogo-data">${j.dataFormatada || "Data não definida"}</div>
                <div class="jr-jogo-confronto">
                    <span class="jr-jogo-dot" style="background:${j.meuTimeCor}"></span>
                    vs ${j.adversarioNome}
                    ${mostrarLiga ? `<span class="jr-jogo-liga">· ${j.ligaNome}</span>` : ""}
                </div>
            </div>
            <div class="jr-jogo-placar ${j.venceu ? "jr-jogo-vitoria" : "jr-jogo-derrota"}">
                ${j.meuPlacar} × ${j.placarAdversario}
            </div>
            <div class="jr-jogo-pontos">
                <span class="jr-jogo-pontos-val">${j.pontosJogador}</span>
                <span class="jr-jogo-pontos-label">pts</span>
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

// ─────────────────────────────────────────────────────────────
// formatarDataJogo(data) → "DD/MM/AAAA" a partir do campo "data"
// de um jogo, no formato "AAAA-MM-DD" (input type="date")
// ─────────────────────────────────────────────────────────────
function formatarDataJogo(data) {
    if (!data) return null;
    const [ano, mes, dia] = data.split("-");
    if (!ano || !mes || !dia) return null;
    return `${dia}/${mes}/${ano}`;
}
