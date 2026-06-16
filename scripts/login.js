// ─────────────────────────────────────────────────────────────
// login.js
// Responsável por: autenticar o usuário via Firebase Auth
// (e-mail/senha e Google) e gerenciar o "Lembrar-me".
// ─────────────────────────────────────────────────────────────

// "import" traz funções de outros arquivos/módulos
import { auth } from "./firebase-config.js";

import {
    signInWithEmailAndPassword,   // faz login com e-mail + senha
    setPersistence,               // define quanto tempo a sessão dura
    browserLocalPersistence,      // sessão permanece mesmo fechando o browser
    browserSessionPersistence,   // sessão encerra ao fechar a aba
    sendPasswordResetEmail    // esqueci minha senha ? sim (mdsss)
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

// ─────────────────────────────────────────────────────────────
// Helpers de UI
// ─────────────────────────────────────────────────────────────

// Mostra mensagem de erro em vermelho na tela
function exibirErro(mensagem) {
    const msg = document.getElementById("msg-erro");
    msg.style.color = "#c0392b";
    msg.textContent = mensagem;
}

// Reseta bordas e mensagem de erro
function limparErros() {
    document.getElementById("msg-erro").textContent     = "";
    document.getElementById("email").style.border       = "";
    document.getElementById("password").style.border    = "";
}

// Traduz os códigos de erro do Firebase para português
function traduzirErro(codigoFirebase) {
    const erros = {
        "auth/invalid-email":        "E-mail inválido.",
        "auth/user-not-found":       "Nenhuma conta encontrada com este e-mail.",
        "auth/wrong-password":       "Senha incorreta.",
        "auth/invalid-credential":   "E-mail ou senha incorretos.",
        "auth/too-many-requests":    "Muitas tentativas. Tente novamente mais tarde.",
        "auth/user-disabled":        "Esta conta foi desativada."
    };
    // Se o código não estiver no mapa, retorna mensagem genérica
    return erros[codigoFirebase] || "Erro ao entrar. Tente novamente.";
}

// ─────────────────────────────────────────────────────────────
// Login com e-mail e senha
// ─────────────────────────────────────────────────────────────
async function fazerLogin() {
    limparErros();

    const email   = document.getElementById("email").value.trim();
    const senha   = document.getElementById("password").value;
    const lembrar = document.getElementById("remember").checked;

    // Validação dos campos antes de chamar o Firebase
    if (!email) {
        exibirErro("Preencha o e-mail.");
        document.getElementById("email").style.border = "2px solid red";
        return;
    }
    if (!senha) {
        exibirErro("Preencha a senha.");
        document.getElementById("password").style.border = "2px solid red";
        return;
    }

    try {
        // ── Define quanto tempo a sessão fica salva ──────────────
        // browserLocalPersistence → fica logado mesmo fechando o browser
        // browserSessionPersistence → encerra ao fechar a aba
        const persistencia = lembrar ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(auth, persistencia);

        // ── Tenta autenticar no Firebase ─────────────────────────
        // signInWithEmailAndPassword retorna uma Promise com os dados do usuário
        const credencial = await signInWithEmailAndPassword(auth, email, senha);

        // Se chegou aqui, o login deu certo
        console.log("Usuário logado:", credencial.user.email);

        // Redireciona para o hub
        window.location.href = "hub.html";

    } catch (erro) {
        // erro.code contém o código do Firebase (ex: "auth/wrong-password")
        exibirErro(traduzirErro(erro.code));
        document.getElementById("email").style.border    = "2px solid red";
        document.getElementById("password").style.border = "2px solid red";
    }
}

// ─────────────────────────────────────────────────────────────
// "Esqueceu sua senha?" — abre modal e envia e-mail de recuperação
// ─────────────────────────────────────────────────────────────
function esqueceuSenha() {
    document.getElementById("modal-recuperar").style.display = "flex";
    document.getElementById("email-recuperacao").value = "";
    document.getElementById("msg-recuperacao").textContent = "";
}

function fecharModal() {
    document.getElementById("modal-recuperar").style.display = "none";
}

async function enviarRecuperacao() {
    const email = document.getElementById("email-recuperacao").value.trim();
    const msg   = document.getElementById("msg-recuperacao");

    if (!email) {
        msg.style.color = "#c0392b";
        msg.textContent = "Digite seu e-mail.";
        return;
    }

    try {
        await sendPasswordResetEmail(auth, email);
        msg.style.color = "#27ae60";
        msg.textContent = "✅ Link enviado! Verifique sua caixa de entrada.";
        // Fecha o modal após 3 segundos
        setTimeout(fecharModal, 3000);
    } catch (erro) {
        msg.style.color = "#c0392b";
        if (erro.code === "auth/user-not-found" || erro.code === "auth/invalid-credential") {
            msg.textContent = "Nenhuma conta encontrada com este e-mail.";
        } else if (erro.code === "auth/invalid-email") {
            msg.textContent = "E-mail inválido.";
        } else {
            msg.textContent = "Erro ao enviar. Tente novamente.";
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Vincula os eventos aos elementos da página
// Como este script é type="module", ele já carrega após o DOM
// estar pronto — não precisamos de DOMContentLoaded.
// ─────────────────────────────────────────────────────────────
document.getElementById("btn-entrar").addEventListener("click", fazerLogin);
document.getElementById("btn-esqueceu").addEventListener("click", esqueceuSenha);

document.getElementById("btn-toggle-senha").addEventListener("click", () => {
    const input = document.getElementById("password");
    const btn   = document.getElementById("btn-toggle-senha");
    const mostrar = input.type === "password";
    input.type = mostrar ? "text" : "password";
    btn.classList.toggle("mostrar", mostrar);
    btn.setAttribute("aria-label", mostrar ? "Ocultar senha" : "Mostrar senha");
});

document.getElementById("btn-fechar-modal").addEventListener("click", fecharModal);
document.getElementById("btn-enviar-recuperacao").addEventListener("click", enviarRecuperacao);
document.getElementById("modal-recuperar").addEventListener("click", (e) => {
    if (e.target.id === "modal-recuperar") fecharModal();
});