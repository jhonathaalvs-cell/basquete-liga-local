// ─────────────────────────────────────────────────────────────
// redefinir-senha.js
// Página personalizada que recebe o link de redefinição de senha
// enviado pelo Firebase (em vez da tela padrão e feia do Firebase).
//
// Fluxo:
//   1. Firebase manda o e-mail com link contendo ?oobCode=XXX
//   2. Usuário clica → cai aqui em redefinir-senha.html?oobCode=XXX
//   3. Verificamos se o código é válido (verifyPasswordResetCode)
//   4. Mostramos o formulário de nova senha
//   5. Usuário confirma → confirmPasswordReset salva a nova senha
// ─────────────────────────────────────────────────────────────

import { auth } from "./firebase-config.js";
import {
    verifyPasswordResetCode,
    confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

// ── Referências aos 4 estados da tela ──────────────────────────
const estadoVerificando = document.getElementById("estado-verificando");
const estadoFormulario  = document.getElementById("estado-formulario");
const estadoSucesso     = document.getElementById("estado-sucesso");
const estadoInvalido    = document.getElementById("estado-invalido");
const msgInvalidoEl     = document.getElementById("msg-invalido");
const emailDaContaEl    = document.getElementById("email-da-conta");

// ── Referências do formulário ──────────────────────────────────
const form              = document.getElementById("form-redefinir");
const inputNovaSenha    = document.getElementById("nova-senha");
const inputConfirmar    = document.getElementById("confirmar-senha");
const msgErro           = document.getElementById("msg-erro");
const btnSalvar         = document.getElementById("btn-salvar-nova-senha");

const forcaWrap         = document.getElementById("forca-senha");
const forcaBarraFill    = document.getElementById("forca-barra-fill");
const forcaLabel        = document.getElementById("forca-label");

// Guarda o código da URL para usar depois no envio do formulário
let oobCodeAtual = null;

// ─────────────────────────────────────────────────────────────
// Troca qual estado está visível (verificando / formulário / sucesso / inválido)
// ─────────────────────────────────────────────────────────────
function mostrarEstado(estado) {
    [estadoVerificando, estadoFormulario, estadoSucesso, estadoInvalido]
        .forEach(el => el.classList.add("oculto"));
    estado.classList.remove("oculto");
}

// ─────────────────────────────────────────────────────────────
// PONTO DE ENTRADA
// Lê o oobCode da URL e verifica se ainda é válido
// ─────────────────────────────────────────────────────────────
(async function iniciar() {
    const params  = new URLSearchParams(window.location.search);
    const mode    = params.get("mode");      // deve ser "resetPassword"
    const oobCode = params.get("oobCode");

    if (mode !== "resetPassword" || !oobCode) {
        msgInvalidoEl.textContent = "Link incompleto ou mal formado.";
        mostrarEstado(estadoInvalido);
        return;
    }

    try {
        // Verifica se o código existe, não expirou e não foi usado ainda.
        // Retorna o e-mail da conta associada ao link.
        const email = await verifyPasswordResetCode(auth, oobCode);

        oobCodeAtual = oobCode;
        emailDaContaEl.textContent = `Definindo nova senha para ${email}`;
        mostrarEstado(estadoFormulario);

    } catch (erro) {
        console.error("Link de redefinição inválido:", erro.code);

        if (erro.code === "auth/expired-action-code") {
            msgInvalidoEl.textContent = "Este link expirou. Solicite um novo no login.";
        } else if (erro.code === "auth/invalid-action-code") {
            msgInvalidoEl.textContent = "Este link já foi utilizado ou é inválido.";
        } else {
            msgInvalidoEl.textContent = "Não foi possível validar o link. Tente solicitar novamente.";
        }

        mostrarEstado(estadoInvalido);
    }
})();

// ─────────────────────────────────────────────────────────────
// Indicador de força da senha — feedback visual simples
// ─────────────────────────────────────────────────────────────
function avaliarForca(senha) {
    let pontos = 0;
    if (senha.length >= 6)  pontos++;
    if (senha.length >= 10) pontos++;
    if (/[A-Z]/.test(senha) && /[a-z]/.test(senha)) pontos++;
    if (/[0-9]/.test(senha)) pontos++;
    if (/[^A-Za-z0-9]/.test(senha)) pontos++;

    if (pontos <= 1) return { label: "Fraca",  cor: "var(--cor3)",    largura: "25%"  };
    if (pontos <= 3) return { label: "Média",  cor: "var(--amarelo)", largura: "60%"  };
    return                  { label: "Forte",  cor: "var(--verde)",   largura: "100%" };
}

inputNovaSenha.addEventListener("input", () => {
    const valor = inputNovaSenha.value;

    if (!valor) {
        forcaWrap.classList.add("oculto");
        return;
    }

    const { label, cor, largura } = avaliarForca(valor);
    forcaWrap.classList.remove("oculto");
    forcaBarraFill.style.width      = largura;
    forcaBarraFill.style.background = cor;
    forcaLabel.textContent          = label;
    forcaLabel.style.color          = cor;
});

// ─────────────────────────────────────────────────────────────
// Toggle de mostrar/ocultar senha (mesmo padrão do login)
// ─────────────────────────────────────────────────────────────
function ligarToggle(btnId, inputEl) {
    const btn = document.getElementById(btnId);
    btn.addEventListener("click", () => {
        const mostrar = inputEl.type === "password";
        inputEl.type = mostrar ? "text" : "password";
        btn.classList.toggle("mostrar", mostrar);
        btn.setAttribute("aria-label", mostrar ? "Ocultar senha" : "Mostrar senha");
    });
}
ligarToggle("btn-toggle-nova", inputNovaSenha);
ligarToggle("btn-toggle-confirmar", inputConfirmar);

// ─────────────────────────────────────────────────────────────
// Helpers de feedback
// ─────────────────────────────────────────────────────────────
function exibirErro(mensagem) {
    msgErro.textContent = mensagem;
    msgErro.style.color = "#c0392b";
}
function limparErro() {
    msgErro.textContent = "";
}

// ─────────────────────────────────────────────────────────────
// Envio do formulário — confirma a nova senha no Firebase
// ─────────────────────────────────────────────────────────────
form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErro();

    const novaSenha = inputNovaSenha.value;
    const confirmar = inputConfirmar.value;

    if (novaSenha.length < 6) {
        exibirErro("A senha precisa ter pelo menos 6 caracteres.");
        return;
    }
    if (novaSenha !== confirmar) {
        exibirErro("As senhas não coincidem.");
        return;
    }

    try {
        btnSalvar.disabled    = true;
        btnSalvar.textContent = "Salvando...";

        await confirmPasswordReset(auth, oobCodeAtual, novaSenha);

        mostrarEstado(estadoSucesso);

    } catch (erro) {
        console.error("Erro ao confirmar nova senha:", erro.code);

        if (erro.code === "auth/expired-action-code") {
            exibirErro("O link expirou enquanto você preenchia. Solicite um novo.");
        } else if (erro.code === "auth/invalid-action-code") {
            exibirErro("Este link já foi usado. Solicite um novo.");
        } else if (erro.code === "auth/weak-password") {
            exibirErro("Escolha uma senha mais forte.");
        } else {
            exibirErro("Erro ao salvar a nova senha. Tente novamente.");
        }

        btnSalvar.disabled    = false;
        btnSalvar.textContent = "SALVAR NOVA SENHA";
    }
});