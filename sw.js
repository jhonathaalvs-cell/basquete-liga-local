// ─────────────────────────────────────────────────────────────
// sw.js — service worker mínimo, só pra habilitar a instalação
// do site como app (PWA).
//
// Propositalmente NÃO faz cache de nada: o app depende de dados
// ao vivo do Firestore e os arquivos mudam com frequência —
// cachear aqui recriaria os mesmos bugs de "tela desatualizada"
// que já tivemos no projeto. O listener de "fetch" precisa
// existir (mesmo vazio) só porque é um dos requisitos do
// navegador pra considerar o site instalável.
// ─────────────────────────────────────────────────────────────

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
    evento.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
    // Sem cache — deixa o navegador buscar tudo normalmente na rede.
});
