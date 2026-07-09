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

// slug (sem separador) → { cor, corSecundaria? }
export const IDENTIDADE_FRANQUIAS = {
    abbasketball:  { cor: "#1c3f7c", corSecundaria: "#f2f4f8" }, // AB Basketball — azul escuro + branco
    dallas:        { cor: "#4d7ea8", corSecundaria: "#c7d0d9" }, // Dallas — azul médio + prata
    grajabulls:    { cor: "#c1272d" },                           // Graja Bulls — vermelho
    blackpanthers: { cor: "#7b3fe4" },                           // Black Panthers — roxo
    ugb:           { cor: "#d4af37" },                           // UGB — dourado
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
