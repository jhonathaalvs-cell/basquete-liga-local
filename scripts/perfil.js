// ─────────────────────────────────────────────────────────────
// perfil.js
// Responsável por:
//   1. Verificar se o usuário está logado (senão volta ao login)
//   2. Carregar dados do perfil: nome/email do Firebase Auth,
//      bio e posição do Firestore, foto do localStorage
//   3. Alternar entre modo "visualização" e modo "edição"
//   4. Salvar nome (Auth), bio e posição (Firestore), foto (localStorage)
//
// ⚠️ Firebase Storage requer plano premium — foto fica no
//    localStorage do navegador como base64 (ideal para estudos)
// ─────────────────────────────────────────────────────────────

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, updateProfile, signOut }
    from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, deleteField, getDocs, collection }
    from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ── Referências aos elementos da página ──────────────────────
const viewFoto    = document.getElementById("view-foto");
const viewNome    = document.getElementById("view-nome");
const viewPosicao = document.getElementById("view-posicao");
const viewBio     = document.getElementById("view-bio");
const viewEmail   = document.getElementById("view-email");
const viewRedes   = document.getElementById("view-redes"); // área de redes na view

const editNome    = document.getElementById("edit-nome");
const editBio     = document.getElementById("edit-bio");
const editPosicao = document.getElementById("edit-posicao");
const inputFoto   = document.getElementById("input-foto");
const editFotoBtn = document.getElementById("edit-foto-btn");

// Inputs das redes sociais no modo de edição
const editInstagram = document.getElementById("edit-instagram");
const editTiktok    = document.getElementById("edit-tiktok");
const editTwitter   = document.getElementById("edit-twitter");
const editYoutube   = document.getElementById("edit-youtube");

// Configuração de cada rede: id usado no Firestore, ícone Font Awesome e cor do chip
const REDES = [
    { id: "instagram", label: "Instagram", icone: "fa-brands fa-instagram", cor: "#C13584" },
    { id: "tiktok",    label: "TikTok",    icone: "fa-brands fa-tiktok",    cor: "#010101" },
    { id: "twitter",   label: "Twitter/X", icone: "fa-brands fa-x-twitter", cor: "#1DA1F2" },
    { id: "youtube",   label: "YouTube",   icone: "fa-brands fa-youtube",   cor: "#FF0000" },
];

const secaoView   = document.getElementById("secao-view");
const secaoEdit   = document.getElementById("secao-edit");
const msgFeedback = document.getElementById("msg-feedback");

let usuarioAtual = null;

// ─────────────────────────────────────────────────────────────
// onAuthStateChanged: dispara sempre que o estado de login muda
// ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) {
        window.location.href = "index.html";
        return;
    }
    usuarioAtual = usuario;
    await carregarPerfil(usuario);
});

// ─────────────────────────────────────────────────────────────
// Carrega e exibe os dados do perfil
// ─────────────────────────────────────────────────────────────
async function carregarPerfil(usuario) {
    // ── Nome e e-mail vêm do Firebase Auth ───────────────────
    viewNome.textContent  = usuario.displayName || "Sem apelido";
    viewEmail.textContent = usuario.email;

    // ── Foto: salva no localStorage com a chave "foto-{uid}" ─
    // Assim cada usuário tem sua própria foto no dispositivo
    const fotoSalva = localStorage.getItem(`foto-${usuario.uid}`);
    if (fotoSalva) {
        viewFoto.src    = fotoSalva;
        editFotoBtn.src = fotoSalva;
    }

    // ── Bio e posição vêm do Firestore ───────────────────────
    const docRef  = doc(db, "users", usuario.uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const dados = docSnap.data();
        viewBio.textContent     = dados.bio      || "Nenhuma bio ainda.";
        viewPosicao.textContent = dados.posicao  || "—";
        renderizarRedes(dados.redes || {});
    } else {
        viewBio.textContent     = "Nenhuma bio ainda.";
        viewPosicao.textContent = "—";
        renderizarRedes({});
    }
}

// ─────────────────────────────────────────────────────────────
// Abre o modo edição pré-preenchendo os campos
// ─────────────────────────────────────────────────────────────
function abrirEdicao() {
    editNome.value = viewNome.textContent === "Sem apelido" ? "" : viewNome.textContent;
    editBio.value  = viewBio.textContent  === "Nenhuma bio ainda." ? "" : viewBio.textContent;

    const options = Array.from(editPosicao.options);
    const index   = options.findIndex(o => o.value === viewPosicao.textContent);
    if (index >= 0) editPosicao.selectedIndex = index;

    // Pré-preenche os inputs de redes com os valores atuais da view
    REDES.forEach(rede => {
        const chip = viewRedes.querySelector(`[data-rede="${rede.id}"]`);
        const usuario = chip ? chip.dataset.usuario : "";
        document.getElementById(`edit-${rede.id}`).value = usuario || "";
    });

    secaoView.classList.add("oculto");
    secaoEdit.classList.remove("oculto");
    msgFeedback.textContent = "";
}

// ─────────────────────────────────────────────────────────────
// Cancela a edição sem salvar
// ─────────────────────────────────────────────────────────────
function cancelarEdicao() {
    secaoEdit.classList.add("oculto");
    secaoView.classList.remove("oculto");
    msgFeedback.textContent = "";
}

// ─────────────────────────────────────────────────────────────
// Salva as alterações
// ─────────────────────────────────────────────────────────────
async function salvarAlteracoes() {
    const novoNome    = editNome.value.trim();
    const novaBio     = editBio.value.trim();
    const novaPosicao = editPosicao.value;
    const arquivo     = inputFoto.files[0];

    // Coleta os @ de cada rede.
    // Se o campo foi preenchido → salva o valor.
    // Se o campo foi apagado   → usa deleteField() para remover do Firestore.
    // (merge:true só adiciona/atualiza, nunca apaga — por isso precisamos de deleteField)
    const novasRedes = {};
    const redesParaExibir = {}; // versão sem deleteField() para renderizar na tela
    REDES.forEach(rede => {
        const valor = document.getElementById(`edit-${rede.id}`).value.trim().replace(/^@/, "");
        if (valor) {
            novasRedes[rede.id]      = valor;
            redesParaExibir[rede.id] = valor;
        } else {
            // Campo vazio = apaga o campo no Firestore
            novasRedes[rede.id] = deleteField();
        }
    });

    if (!novoNome) {
        mostrarFeedback("O apelido não pode ficar vazio.", "erro");
        return;
    }

    mostrarFeedback("Salvando...", "info");

    try {
        // ── Foto: converte para base64 e salva no localStorage ─
        // Não precisa de servidor nem de plano pago
        if (arquivo) {
            const base64 = await lerArquivoComoBase64(arquivo);
            // Salva com a chave "foto-{uid}" para separar por usuário
            localStorage.setItem(`foto-${usuarioAtual.uid}`, base64);
            viewFoto.src    = base64;
            editFotoBtn.src = base64;
        }

        // ── Atualiza nome no Firebase Auth ────────────────────
        await updateProfile(usuarioAtual, { displayName: novoNome });

        // ── Salva bio, posição e redes no Firestore ────────────────────
        await setDoc(doc(db, "users", usuarioAtual.uid), {
            bio:     novaBio,
            posicao: novaPosicao,
            redes:   novasRedes
        }, { merge: true });

        // ── Propaga redes para todas as inscrições do jogador ──────────
        // Isso permite que outros jogadores vejam as redes sem precisar
        // de acesso direto ao documento users/{uid}.
        try {
            const ligasSnap = await getDocs(collection(db, "ligas"));
            await Promise.all(ligasSnap.docs.map(async ligaDoc => {
                const inscricaoRef  = doc(db, "ligas", ligaDoc.id, "inscricoes", usuarioAtual.uid);
                const inscricaoSnap = await getDoc(inscricaoRef);
                if (inscricaoSnap.exists()) {
                    await updateDoc(inscricaoRef, { redes: redesParaExibir });
                }
            }));
        } catch (e) { /* propagação é best-effort — não bloqueia o save do perfil */ }

        // ── Atualiza a view ──────────────────────────────────
        viewNome.textContent    = novoNome;
        viewBio.textContent     = novaBio     || "Nenhuma bio ainda.";
        viewPosicao.textContent = novaPosicao || "—";
        renderizarRedes(redesParaExibir);

        secaoEdit.classList.add("oculto");
        secaoView.classList.remove("oculto");
        mostrarFeedback("Perfil atualizado!", "sucesso");
        setTimeout(() => { msgFeedback.textContent = ""; }, 3000);

    } catch (erro) {
        console.error(erro);
        mostrarFeedback("Erro ao salvar. Tente novamente.", "erro");
    }
}

// ─────────────────────────────────────────────────────────────
// Renderiza os chips de redes sociais na view
// redes = { instagram: "usuario", tiktok: "usuario", ... }
// ─────────────────────────────────────────────────────────────
function renderizarRedes(redes) {
    viewRedes.innerHTML = "";

    const redesPreenchidas = REDES.filter(r => redes[r.id]);

    if (redesPreenchidas.length === 0) return;

    redesPreenchidas.forEach(rede => {
        const chip = document.createElement("a");
        chip.className       = "rede-chip";
        chip.dataset.rede    = rede.id;
        chip.dataset.usuario = redes[rede.id];
        chip.href   = gerarLink(rede.id, redes[rede.id]);
        chip.target = "_blank";
        chip.rel    = "noopener noreferrer";
        chip.style.setProperty("--rede-cor", rede.cor);
        chip.innerHTML = `<i class="${rede.icone} rede-icone"></i>@${redes[rede.id]}`;
        viewRedes.appendChild(chip);
    });
}

// Gera o link da rede social a partir do @usuario
function gerarLink(redeId, usuario) {
    const links = {
        instagram: `https://instagram.com/${usuario}`,
        tiktok:    `https://tiktok.com/@${usuario}`,
        twitter:   `https://twitter.com/${usuario}`,
        youtube:   `https://youtube.com/@${usuario}`,
    };
    return links[redeId] || "#";
}

// ─────────────────────────────────────────────────────────────
// Converte o arquivo de imagem para base64
// FileReader é uma API nativa do browser para ler arquivos locais
// ─────────────────────────────────────────────────────────────
function lerArquivoComoBase64(arquivo) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        // onload dispara quando a leitura termina
        reader.onload  = (e) => resolve(e.target.result);
        reader.onerror = reject;
        // readAsDataURL converte o arquivo para uma string base64
        reader.readAsDataURL(arquivo);
    });
}

// ─────────────────────────────────────────────────────────────
// Prévia da foto antes de salvar
// ─────────────────────────────────────────────────────────────
async function previewFoto(evento) {
    const arquivo = evento.target.files[0];
    if (!arquivo) return;
    const base64 = await lerArquivoComoBase64(arquivo);
    editFotoBtn.src = base64;
}

// ─────────────────────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────────────────────
async function sair() {
    await signOut(auth);
    window.location.href = "index.html";
}

// ─────────────────────────────────────────────────────────────
// Helper de feedback
// ─────────────────────────────────────────────────────────────
function mostrarFeedback(mensagem, tipo) {
    msgFeedback.textContent = mensagem;
    msgFeedback.className   = "msg-feedback " + tipo;
}

// ─────────────────────────────────────────────────────────────
// Vincula eventos
// ─────────────────────────────────────────────────────────────
document.getElementById("btn-editar").addEventListener("click",   abrirEdicao);
document.getElementById("btn-cancelar").addEventListener("click", cancelarEdicao);
document.getElementById("btn-salvar").addEventListener("click",   salvarAlteracoes);
document.getElementById("btn-sair").addEventListener("click",     sair);
inputFoto.addEventListener("change", previewFoto);

// Clique no wrapper da foto (captura clique na imagem E no overlay da câmera)
document.getElementById("foto-edit-wrapper").addEventListener("click", () => inputFoto.click());
