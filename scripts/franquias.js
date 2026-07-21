// ─────────────────────────────────────────────────────────────
// franquias.js
// Identidade visual (logo + cor) das franquias reconhecidas pelo
// nome do time. Compartilhado entre liga.js e jogadores.js.
//
// Pra adicionar uma franquia nova:
//   1. Solte o arquivo de logo em imagens/franquias/
//   2. Adicione uma entrada em IDENTIDADE_FRANQUIAS com a cor
// O nome do time é convertido pro mesmo formato do arquivo/entrada
// automaticamente — não precisa bater exatamente.
// ─────────────────────────────────────────────────────────────

export const LOGO_TIME_EXTENSOES = ["jpeg", "jpg", "png", "webp"];

// slug (sem separador) → { cor, corSecundaria?, cardEscura?, cardMedia?, cardAccent? }
// cardEscura/cardMedia/cardAccent são usadas só no fundo em gradiente e no
// acento do card de imagem (jogador.html → "Baixar Card") — independentes
// de cor/corSecundaria pra não afetar os outros usos (bordas, pontinhos, etc).
export const IDENTIDADE_FRANQUIAS = {
    abbasketball:  { cor: "#1c3f7c", corSecundaria: "#f2f4f8", cardEscura: "#0a1628", cardMedia: "#0d2040", cardAccent: "#4a90d9" }, // AB Basketball — azul escuro + branco
    dallas:        { cor: "#4d7ea8", corSecundaria: "#c7d0d9", cardEscura: "#0a0a14", cardMedia: "#101020", cardAccent: "#9ca3af" }, // Dallas — azul médio + prata
    grajabulls:    { cor: "#c1272d", cardEscura: "#1a0505", cardMedia: "#2a0808", cardAccent: "#dc2626" },                           // Graja Bulls — vermelho
    blackpanthers: { cor: "#7b3fe4", cardEscura: "#12051e", cardMedia: "#1e0a30", cardAccent: "#9333ea" },                           // Black Panthers — roxo
    ugb:           { cor: "#d4af37", cardEscura: "#1a1400", cardMedia: "#2a2000", cardAccent: "#d4af37" },                           // UGB — dourado
};

// Converte o nome do time num slug (ex: "Graja Bulls" → "graja_bulls")
export function slugTimeNome(nome) {
    return (nome || "")
        .normalize("NFD").replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

// Gera as variações de slug tentadas pro nome do time:
// "Graja Bulls" → ["graja_bulls", "grajabulls"]
// (a 2ª cobre arquivos/entradas sem separador entre as palavras)
export function slugsTimeNome(nome) {
    const base = slugTimeNome(nome);
    if (!base) return [];
    const semSeparador = base.replace(/_/g, "");
    return semSeparador !== base ? [base, semSeparador] : [base];
}

// Retorna a identidade da franquia (cor/corSecundaria) se o nome do
// time bater com alguma cadastrada, ou null se não reconhecida.
export function identidadeTime(nome) {
    for (const slug of slugsTimeNome(nome)) {
        if (IDENTIDADE_FRANQUIAS[slug]) return IDENTIDADE_FRANQUIAS[slug];
    }
    return null;
}

// Cor de exibição do time: usa a cor oficial da franquia se o nome
// bater; senão cai pra cor guardada no Firestore (corPadrao).
export function corTime(nome, corPadrao) {
    return identidadeTime(nome)?.cor || corPadrao;
}

// Cores do card de imagem (fundo em gradiente + acento) pro time. Se a
// franquia não tiver essas cores cadastradas, deriva um gradiente escuro
// a partir da cor normal do time via color-mix (sem precisar calcular
// manualmente tons mais escuros em JS).
export function identidadeCardTime(nome, corPadrao) {
    const id = identidadeTime(nome);
    if (id?.cardEscura) {
        return { cardEscura: id.cardEscura, cardMedia: id.cardMedia, cardAccent: id.cardAccent || id.cor };
    }
    const base = corPadrao || "#555";
    return {
        cardEscura: `color-mix(in srgb, ${base} 25%, #05050a)`,
        cardMedia:  `color-mix(in srgb, ${base} 40%, #05050a)`,
        cardAccent: base
    };
}

// gerarIniciais(nome) → "AB" a partir de um nome (jogador ou time).
// Compartilhado entre jogadores.js, jogador.js e liga.js.
export function gerarIniciais(nome) {
    const palavras = (nome || "").trim().split(/\s+/);
    if (palavras.length === 1) return palavras[0].substring(0, 2).toUpperCase();
    return (palavras[0][0] + palavras[palavras.length - 1][0]).toUpperCase();
}

// Monta o avatar (div) com a logo do time, tentando cada variação de
// slug em cada extensão até achar um arquivo que exista. Se nenhuma
// combinação bater, marca "sem-logo" (CSS desenha um ícone genérico).
// extraAttrs: atributos HTML adicionais pro <div> (ex: pra deixar clicável)
export function logoTimeAvatarHtml(nome, cor, classeAvatar, classeImg, extraAttrs = "") {
    const candidatos = [];
    slugsTimeNome(nome).forEach(slug => {
        LOGO_TIME_EXTENSOES.forEach(ext => candidatos.push(`imagens/franquias/${slug}.${ext}`));
    });
    const estilo = cor ? `style="border-color:${cor}55"` : "";
    if (candidatos.length === 0) return `<div class="${classeAvatar} sem-logo" ${estilo} ${extraAttrs}></div>`;
    return `<div class="${classeAvatar}" ${estilo} ${extraAttrs}>
                <img class="${classeImg}" alt=""
                     src="${candidatos[0]}"
                     data-logo-candidatos="${candidatos.join(",")}" data-logo-idx="0"
                     onerror="handleLogoTimeError(this)">
            </div>`;
}

// Handler global (chamado via onerror inline): tenta o próximo
// candidato da lista; se esgotar, remove a imagem e marca o
// container como "sem-logo" pra CSS mostrar o ícone genérico.
window.handleLogoTimeError = function (img) {
    const candidatos = (img.dataset.logoCandidatos || "").split(",").filter(Boolean);
    const idx = Number(img.dataset.logoIdx || 0) + 1;
    if (idx < candidatos.length) {
        img.dataset.logoIdx = String(idx);
        img.src = candidatos[idx];
    } else {
        img.onerror = null;
        img.parentElement?.classList.add("sem-logo");
        img.remove();
    }
};

// ─────────────────────────────────────────────────────────────
// Foto oficial do jogador (users/{uid}.fotoOficial, arquivo em
// imagens/jogadores/{uid}.jpg). Se não existir ou falhar ao
// carregar, cai pro avatar de iniciais coloridas.
// ─────────────────────────────────────────────────────────────

// Versão para HTML gerado por template string (ex: cards de lista),
// onde o elemento inteiro (div de iniciais OU img) é montado de uma vez.
export function avatarJogadorHtml(fotoOficial, nome, cor, classeAvatar, classeImg) {
    const iniciais  = gerarIniciais(nome);
    const corSegura = cor || "#555";
    if (!fotoOficial) {
        return `<div class="${classeAvatar}" style="background:${corSegura}22;color:${corSegura}">${iniciais}</div>`;
    }
    return `<img class="${classeAvatar} ${classeImg}" src="${fotoOficial}" alt=""
                 data-avatar-classe="${classeAvatar}" data-cor-fallback="${corSegura}" data-iniciais-fallback="${iniciais}"
                 onerror="handleFotoJogadorError(this)">`;
}

// Handler global (chamado via onerror inline): troca a <img> quebrada
// por uma <div> de iniciais coloridas, igual ao fallback de logo.
window.handleFotoJogadorError = function (img) {
    const div = document.createElement("div");
    div.className = img.dataset.avatarClasse || "";
    const cor = img.dataset.corFallback || "#555";
    div.style.background = `${cor}22`;
    div.style.color      = cor;
    div.textContent      = img.dataset.iniciaisFallback || "";
    img.replaceWith(div);
};

// Versão para um elemento fixo já existente no DOM (ex: avatar do
// modal rápido ou do banner da página do jogador) — atualiza o
// conteúdo/estilo do elemento em vez de recriar o container inteiro,
// já que o mesmo elemento é reaproveitado entre aberturas/jogadores.
export function aplicarAvatarJogador(elemento, fotoOficial, nome, cor, classeImg) {
    const iniciais  = gerarIniciais(nome);
    const corSegura = cor || "#555";

    const mostrarIniciais = () => {
        elemento.innerHTML = "";
        elemento.textContent = iniciais;
        elemento.style.background = `${corSegura}22`;
        elemento.style.color      = corSegura;
    };

    if (!fotoOficial) {
        mostrarIniciais();
        return;
    }

    elemento.textContent = "";
    elemento.style.background = "transparent";
    const img = document.createElement("img");
    img.className = classeImg;
    img.src   = fotoOficial;
    img.alt   = "";
    img.onerror = mostrarIniciais;
    elemento.appendChild(img);
}
