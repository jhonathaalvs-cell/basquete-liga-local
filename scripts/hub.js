// ─────────────────────────────────────────────────────────────
// hub.js
// Carrega posts automáticos de rodada e votações de destaque
// dos jogos de playoff.
// ─────────────────────────────────────────────────────────────

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
    collection, getDocs, getDoc, doc,
    query, where,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ── DOM ──────────────────────────────────────────────────────
const votacaoSection = document.getElementById("votacao-section");
const votacaoLista   = document.getElementById("votacao-lista");
const votacaoLoading = document.getElementById("votacao-loading");

let usuarioAtual = null;
let roleAtual    = "jogador";

// ─────────────────────────────────────────────────────────────
// Ponto de entrada — aguarda login
// ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) { window.location.href = "index.html"; return; }
    usuarioAtual = usuario;

    try {
        const perfil = await getDoc(doc(db, "users", usuario.uid));
        roleAtual = perfil.exists() ? (perfil.data().role || "jogador") : "jogador";
    } catch (e) { roleAtual = "jogador"; }

    await carregarVotacoes();
});

// ═════════════════════════════════════════════════════════════
// VOTAÇÃO — Destaque da Partida
// ═════════════════════════════════════════════════════════════

async function carregarVotacoes() {
    votacaoLista.innerHTML = "";

    try {
        const ligasSnap = await getDocs(collection(db, "ligas"));

        // Admin vê votações de todas as ligas; jogador vê só das suas
        const ligasDoUser = [];
        if (roleAtual === "admin") {
            ligasSnap.docs.forEach(d => ligasDoUser.push({ id: d.id, ...d.data() }));
        } else {
            await Promise.all(ligasSnap.docs.map(async ligaDoc => {
                const inscSnap = await getDoc(
                    doc(db, "ligas", ligaDoc.id, "inscricoes", usuarioAtual.uid)
                );
                if (inscSnap.exists()) ligasDoUser.push({ id: ligaDoc.id, ...ligaDoc.data() });
            }));
        }

        // Carrega votações abertas de cada liga
        const todasVotacoes = [];
        await Promise.all(ligasDoUser.map(async liga => {
            const votSnap = await getDocs(
                query(collection(db, "ligas", liga.id, "votacoes"),
                      where("status", "==", "aberta"))
            );
            votSnap.docs.forEach(d => todasVotacoes.push({ id: d.id, ...d.data() }));
        }));

        // Ordena pelo mais recente (client-side)
        todasVotacoes.sort((a, b) =>
            (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0)
        );

        votacaoLoading.classList.add("oculto");

        if (todasVotacoes.length === 0) {
            votacaoSection.classList.add("oculto");
            return;
        }

        votacaoSection.classList.remove("oculto");
        todasVotacoes.forEach(vot => votacaoLista.appendChild(criarCardVotacao(vot)));

    } catch (e) {
        console.error("Erro ao carregar votações:", e);
        votacaoLoading.classList.add("oculto");
        votacaoSection.classList.add("oculto");
    }
}

// ─────────────────────────────────────────────────────────────
// criarCardVotacao(vot)
// ─────────────────────────────────────────────────────────────
function criarCardVotacao(vot) {
    const card = document.createElement("div");
    card.className = "hub-vot-card";

    const NOMES_FASE = {
        regular: "Fase Regular",
        quartas: "Quartas de Final",
        semi:    "Semifinais",
        final:   "Final"
    };
    const faseNome = NOMES_FASE[vot.confrontoFase] || vot.confrontoFase || "Playoff";
    const jogoLabel = vot.confrontoFase === "regular" ? "Rodada" : "Jogo";

    const meuVoto  = vot.votos?.[usuarioAtual.uid];
    const contagem = {};
    Object.values(vot.votos || {}).forEach(uid => {
        contagem[uid] = (contagem[uid] || 0) + 1;
    });
    const totalVotos = Object.values(contagem).reduce((a, b) => a + b, 0);

    const gerarIniciais = nome =>
        nome.trim().split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();

    const jogadoresHtml = (vot.jogadores || []).map(j => `
        <button class="hub-vot-jogador ${meuVoto === j.uid ? "votado" : ""}"
                data-uid="${j.uid}">
            <span class="hub-vot-iniciais">${gerarIniciais(j.nome || "?")}</span>
            <span class="hub-vot-nome">${j.nome || "—"}</span>
            <span class="hub-vot-pos">${j.posicao || "—"}</span>
            <span class="hub-vot-contagem">
                ${contagem[j.uid] || 0} ${(contagem[j.uid] || 0) === 1 ? "voto" : "votos"}
            </span>
        </button>
    `).join("");

    const adminAcoes = roleAtual === "admin"
        ? `<div class="hub-vot-acoes">
               <button class="btn-fechar-votacao">Encerrar Votação</button>
           </div>`
        : "";

    card.innerHTML = `
        <div class="hub-vot-header">
            <div class="hub-vot-header-info">
                <span class="hub-vot-fase">${faseNome} · ${jogoLabel} ${vot.jogoNum}</span>
                <span class="hub-vot-time" style="color:${vot.timeVencedor?.cor || 'var(--branco)'}">
                    ${vot.timeVencedor?.nome || "Time vencedor"}
                </span>
            </div>
            <span class="hub-vot-total">
                ${totalVotos} ${totalVotos === 1 ? "voto" : "votos"}
            </span>
        </div>
        <p class="hub-vot-titulo">Quem foi o destaque do jogo?</p>
        <div class="hub-vot-jogadores">${jogadoresHtml}</div>
        ${adminAcoes}
    `;

    card.querySelectorAll(".hub-vot-jogador").forEach(btn => {
        btn.addEventListener("click", () => votar(vot, btn.dataset.uid));
    });

    const btnFechar = card.querySelector(".btn-fechar-votacao");
    if (btnFechar) btnFechar.addEventListener("click", () => fecharVotacao(vot));

    return card;
}

// ─────────────────────────────────────────────────────────────
// votar(vot, jogadorUid)
// Registra ou altera o voto do usuário atual
// ─────────────────────────────────────────────────────────────
async function votar(vot, jogadorUid) {
    try {
        await updateDoc(doc(db, "ligas", vot.ligaId, "votacoes", vot.id), {
            [`votos.${usuarioAtual.uid}`]: jogadorUid
        });
        votacaoLista.innerHTML = "";
        votacaoLoading.classList.remove("oculto");
        await carregarVotacoes();
    } catch (e) {
        console.error("Erro ao votar:", e);
    }
}

// ─────────────────────────────────────────────────────────────
// fecharVotacao(vot)
// Admin encerra a votação, calcula destaque e salva no confronto
// ─────────────────────────────────────────────────────────────
async function fecharVotacao(vot) {
    // Calcula o jogador com mais votos
    const contagem = {};
    Object.values(vot.votos || {}).forEach(uid => {
        contagem[uid] = (contagem[uid] || 0) + 1;
    });
    const destaqueUid = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a])[0];
    const jogadorDestaque = destaqueUid
        ? (vot.jogadores || []).find(j => j.uid === destaqueUid)
        : null;
    const destaque = jogadorDestaque
        ? {
            uid:      jogadorDestaque.uid,
            nome:     jogadorDestaque.nome     || "?",
            posicao:  jogadorDestaque.posicao  || "",
            timeNome: jogadorDestaque.timeNome || ""
          }
        : null;

    try {
        // Encerra a votação
        await updateDoc(doc(db, "ligas", vot.ligaId, "votacoes", vot.id),
                        { status: "encerrada", destaque });

        // Grava o destaque de volta no documento correto
        if (destaque) {
            if (vot.confrontoFase === "regular" && vot.jogoId) {
                // Jogo de rodada regular → salva em jogos/{jogoId}
                await updateDoc(
                    doc(db, "ligas", vot.ligaId, "jogos", vot.jogoId),
                    { destaque }
                );
            } else if (vot.confrontoId) {
                // Jogo de playoff → salva no array jogos[] do confronto
                const confrontoRef  = doc(db, "ligas", vot.ligaId, "playoffs", vot.confrontoId);
                const confrontoSnap = await getDoc(confrontoRef);
                if (confrontoSnap.exists()) {
                    const jogosArr = [...(confrontoSnap.data().jogos || [])];
                    const idx = vot.jogoNum - 1;
                    if (jogosArr[idx]) {
                        jogosArr[idx] = { ...jogosArr[idx], destaque };
                        await updateDoc(confrontoRef, { jogos: jogosArr });
                    }
                }
            }
        }

        votacaoLista.innerHTML = "";
        votacaoLoading.classList.remove("oculto");
        await carregarVotacoes();

    } catch (e) {
        console.error("Erro ao fechar votação:", e);
    }
}

