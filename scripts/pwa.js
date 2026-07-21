// ─────────────────────────────────────────────────────────────
// pwa.js
// Registra o service worker e mostra um pop-up convidando a
// pessoa a instalar o site como app (celular ou computador).
// Incluído em todas as páginas — não é type="module" de propósito,
// pra não depender de import/export nem de outros scripts.
// ─────────────────────────────────────────────────────────────

// ── Registra o service worker (exigido pelo navegador pra permitir instalar) ──
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {
            /* falhou registrar — só significa que não vai poder instalar */
        });
    });
}

const PWA_CHAVE_DISPENSADO = "pwa-instalar-dispensado-em";
const PWA_DIAS_PARA_REPERGUNTAR = 7;

function pwaFoiDispensadoRecentemente() {
    const dispensadoEm = localStorage.getItem(PWA_CHAVE_DISPENSADO);
    if (!dispensadoEm) return false;
    const dias = (Date.now() - Number(dispensadoEm)) / (1000 * 60 * 60 * 24);
    return dias < PWA_DIAS_PARA_REPERGUNTAR;
}

function pwaJaInstalado() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function pwaEhIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

// ─────────────────────────────────────────────────────────────
// pwaMostrarPopup({ instrucoesIOS, deferredPrompt })
// Monta e exibe o pop-up de instalação (só uma vez por página)
// ─────────────────────────────────────────────────────────────
function pwaMostrarPopup({ instrucoesIOS = false, deferredPrompt = null } = {}) {
    if (document.getElementById("pwa-popup-instalar")) return;

    const popup = document.createElement("div");
    popup.id = "pwa-popup-instalar";
    popup.className = "pwa-popup-instalar";
    popup.innerHTML = `
        <div class="pwa-popup-conteudo">
            <img src="imagens/logo-liga.png" alt="" class="pwa-popup-icone">
            <div class="pwa-popup-texto">
                <strong>Instalar o app</strong>
                <span>${instrucoesIOS
                    ? 'Toque em Compartilhar e depois em "Adicionar à Tela de Início".'
                    : "Acesse mais rápido, direto da tela inicial do seu celular."}</span>
            </div>
            ${instrucoesIOS ? "" : '<button type="button" class="pwa-popup-btn" id="pwa-btn-instalar">Instalar</button>'}
            <button type="button" class="pwa-popup-fechar" id="pwa-btn-fechar" aria-label="Fechar">✕</button>
        </div>
    `;
    document.body.appendChild(popup);

    document.getElementById("pwa-btn-fechar").addEventListener("click", () => {
        localStorage.setItem(PWA_CHAVE_DISPENSADO, String(Date.now()));
        popup.remove();
    });

    if (!instrucoesIOS && deferredPrompt) {
        document.getElementById("pwa-btn-instalar").addEventListener("click", async () => {
            popup.remove();
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
        });
    }
}

// ─────────────────────────────────────────────────────────────
// Chrome / Edge / Android: o navegador dispara esse evento quando
// o site cumpre os critérios de instalação. Guardamos o evento e
// mostramos nosso próprio pop-up (em vez da barrinha automática).
// ─────────────────────────────────────────────────────────────
window.addEventListener("beforeinstallprompt", (evento) => {
    evento.preventDefault();
    if (pwaJaInstalado() || pwaFoiDispensadoRecentemente()) return;
    setTimeout(() => pwaMostrarPopup({ deferredPrompt: evento }), 2000);
});

// Fecha o pop-up se a pessoa instalar (ex: pelo menu do navegador)
window.addEventListener("appinstalled", () => {
    document.getElementById("pwa-popup-instalar")?.remove();
});

// ── iOS Safari não dispara beforeinstallprompt — mostra instruções manuais ──
if (pwaEhIOS() && !pwaJaInstalado() && !pwaFoiDispensadoRecentemente()) {
    setTimeout(() => pwaMostrarPopup({ instrucoesIOS: true }), 2000);
}
