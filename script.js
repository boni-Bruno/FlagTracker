/* =========================================================================
 * Visualizador de Bandeiras - Tribal Wars
 * Autor: Bruno (TazarYoot) + Claude
 * Execução: javascript: $.getScript('URL_DO_SCRIPT')
 *
 * CHANGELOG
 * v1.0.0 (2026-06-20)
 *   - Primeira versão.
 *   - Busca a página game.php?screen=overview_villages&mode=flags via $.get
 *   - Faz parsing das linhas para extrair: id da aldeia, nome, coordenadas
 *     e a bandeira atualmente alocada.
 *   - Painel flutuante arrastável, tema marrom/dourado (igual Attack Planner).
 *   - Busca por nome/coordenada, filtro por bandeira, ordenação por coluna.
 *   - Nome da aldeia é link clicável -> screen=overview daquela aldeia.
 *
 * NOTA IMPORTANTE SOBRE A DETECÇÃO DE BANDEIRA:
 *   Não tenho acesso ao HTML real da página de bandeiras do br140, então a
 *   função parseFlagsPage() usa 3 heurísticas em cascata (ver comentários
 *   dentro da função). Se a bandeira aparecer errada ou vazia para todas as
 *   aldeias, abra o console (F12), veja os avisos "[FlagViewer]" e me envie
 *   um trecho do HTML da linha de uma aldeia (botão direito > Inspecionar
 *   no ícone da bandeira) para eu ajustar os seletores.
 * ========================================================================= */

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.0.0';
  console.log(`[FlagViewer] v${SCRIPT_VERSION} iniciando...`);

  if (typeof game_data === 'undefined') {
    alert('Erro: este script deve ser executado dentro do Tribal Wars.');
    return;
  }

  // Remove painel anterior, se existir (permite re-executar o script)
  $('#fv-overlay').remove();

  // ---------------------------------------------------------------------
  // UI - tema marrom/dourado, igual ao Attack Planner
  // ---------------------------------------------------------------------
  const colors = {
    bg: '#f4e4bc',
    border: '#7d510f',
    header: '#603000',
    gold: '#c1a264'
  };

  const overlayHtml = `
    <div id="fv-overlay" style="position:fixed; top:50px; left:50%; transform:translateX(-50%);
        z-index:9999; width:720px; max-height:80vh; background:${colors.bg};
        border:3px solid ${colors.border}; border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,0.5);
        font-family:Verdana, Arial, sans-serif; font-size:12px; color:#3b2a14; overflow:hidden;">
      <div id="fv-header" style="background:${colors.header}; color:${colors.gold}; padding:8px 12px;
          cursor:move; display:flex; justify-content:space-between; align-items:center;">
        <strong>🚩 Visualizador de Bandeiras — v${SCRIPT_VERSION}</strong>
        <span id="fv-close" style="cursor:pointer; font-weight:bold; padding:0 6px;">✕</span>
      </div>
      <div style="padding:8px 12px; border-bottom:1px solid ${colors.border}; display:flex; gap:8px; align-items:center;">
        <input id="fv-search" type="text" placeholder="Buscar aldeia ou coordenada..."
            style="flex:1; padding:4px 6px; border:1px solid ${colors.border}; border-radius:3px;">
        <select id="fv-filter-flag" style="padding:4px 6px; border:1px solid ${colors.border}; border-radius:3px;">
          <option value="">Todas as bandeiras</option>
        </select>
        <span id="fv-status" style="white-space:nowrap; color:#603000;">Carregando...</span>
      </div>
      <div style="max-height:60vh; overflow-y:auto;">
        <table id="fv-table" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:${colors.header}; color:${colors.gold};">
              <th style="padding:6px; text-align:left; cursor:pointer;" data-sort="name">Aldeia ▾</th>
              <th style="padding:6px; text-align:left; cursor:pointer;" data-sort="coord">Coord. ▾</th>
              <th style="padding:6px; text-align:left;">Bandeira</th>
            </tr>
          </thead>
          <tbody id="fv-tbody"></tbody>
        </table>
      </div>
    </div>`;

  $('body').append(overlayHtml);

  // Arrastar painel
  (function makeDraggable() {
    let isDown = false, offX = 0, offY = 0;
    const $h = $('#fv-header'), $o = $('#fv-overlay');
    $h.on('mousedown', function (e) {
      isDown = true;
      const rect = $o[0].getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      $o.css({ transform: 'none', left: rect.left + 'px', top: rect.top + 'px' });
    });
    $(document).on('mousemove.fv', function (e) {
      if (!isDown) return;
      $o.css({ left: (e.clientX - offX) + 'px', top: (e.clientY - offY) + 'px' });
    });
    $(document).on('mouseup.fv', function () { isDown = false; });
  })();

  $('#fv-close').on('click', function () {
    $('#fv-overlay').remove();
    $(document).off('.fv');
  });

  // ---------------------------------------------------------------------
  // Coleta de dados
  // ---------------------------------------------------------------------
  let villages = []; // { id, name, coordX, coordY, flagId, flagSrc, flagTitle }

  function buildVillageLink(id) {
    return `game.php?village=${id}&screen=overview`;
  }

  function parseFlagsPage(html, target) {
    const $doc = $('<div>').html(html);

    // Tenta seletores conhecidos da tabela de aldeias primeiro
    let $rows = $doc.find('#villages_list tbody tr, table.villages_list tbody tr, table#flags_table tbody tr');

    // Fallback genérico: qualquer <tr> com link para overview de aldeia
    if ($rows.length === 0) {
      $rows = $doc.find('tr').filter(function () {
        return $(this).find('a[href*="screen=overview"][href*="village="]').length > 0;
      });
    }

    let addedBefore = target.length;

    $rows.each(function () {
      const $row = $(this);
      const $link = $row.find('a[href*="screen=overview"][href*="village="]').first();
      if ($link.length === 0) return;

      const href = $link.attr('href');
      const idMatch = href.match(/village=(\d+)/);
      if (!idMatch) return;
      const id = idMatch[1];

      // Evita duplicar aldeia já capturada (caso página repita linha)
      if (target.some(v => v.id === id)) return;

      const name = $link.text().trim();

      // Coordenadas: procura padrão XXX|YYY no texto da linha
      const rowText = $row.text();
      const coordMatch = rowText.match(/(\d{1,3})\|(\d{1,3})/);
      const coordX = coordMatch ? coordMatch[1] : '';
      const coordY = coordMatch ? coordMatch[2] : '';

      // ---- Detecção da bandeira ativa (3 heurísticas em cascata) ----
      const $flagImgs = $row.find('img[src*="flag"]');
      let $activeImg = $();

      // Heurística 1: a bandeira atual normalmente é estática (não está
      // dentro de um <a>/<button> clicável); as outras opções de troca são.
      $activeImg = $flagImgs.filter(function () {
        return $(this).closest('a, button').length === 0;
      }).first();

      // Heurística 2: classe indicando seleção/ativo
      if ($activeImg.length === 0) {
        $activeImg = $flagImgs.filter(function () {
          const cls = $(this).attr('class') || '';
          return /active|selected|current|chosen|highlight/i.test(cls);
        }).first();
      }

      // Heurística 3: fallback - primeira imagem de bandeira encontrada
      if ($activeImg.length === 0) {
        $activeImg = $flagImgs.first();
      }

      const flagSrc = $activeImg.attr('src') || '';
      const flagTitle = $activeImg.attr('title') || $activeImg.attr('alt') || '';
      const flagMatch = flagSrc.match(/flag[_-]?(\w+)?\.(png|webp|gif)/i);
      const flagId = flagSrc ? (flagMatch && flagMatch[1] ? flagMatch[1] : 'default') : 'none';

      target.push({ id, name, coordX, coordY, flagId, flagSrc, flagTitle });
    });

    return target.length - addedBefore; // quantidade de novas linhas adicionadas
  }

  function loadAllPages() {
    const baseUrl = 'game.php?screen=overview_villages&mode=flags';
    let page = 0;
    const MAX_PAGES = 40; // proteção contra loop infinito

    function loadPage() {
      $.get(`${baseUrl}&page=${page}`, function (html) {
        const added = parseFlagsPage(html, villages);
        $('#fv-status').text(`Carregando... ${villages.length} aldeia(s)`);

        if (added > 0 && page < MAX_PAGES) {
          page++;
          setTimeout(loadPage, 150); // pequeno respiro entre requisições
        } else {
          finishLoading();
        }
      }).fail(function () {
        console.warn('[FlagViewer] Falha ao carregar página', page);
        finishLoading();
      });
    }

    loadPage();
  }

  function finishLoading() {
    console.log('[FlagViewer] Total de aldeias carregadas:', villages.length);
    if (villages.length === 0) {
      $('#fv-status').text('Nenhuma aldeia encontrada — veja o console (F12).');
      console.warn('[FlagViewer] Nenhuma linha reconhecida. Pode ser necessário ajustar os seletores em parseFlagsPage().');
      return;
    }
    $('#fv-status').text(`${villages.length} aldeia(s)`);
    populateFlagFilter();
    renderTable();
  }

  function populateFlagFilter() {
    const seen = new Set();
    villages.forEach(v => {
      const key = v.flagTitle || v.flagId;
      if (key && !seen.has(key)) {
        seen.add(key);
        $('#fv-filter-flag').append(`<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Renderização / interação
  // ---------------------------------------------------------------------
  let sortKey = 'name', sortAsc = true;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function renderTable() {
    const search = ($('#fv-search').val() || '').toLowerCase();
    const flagFilter = $('#fv-filter-flag').val();

    let filtered = villages.filter(v => {
      const matchSearch = !search ||
        v.name.toLowerCase().includes(search) ||
        `${v.coordX}|${v.coordY}`.includes(search);
      const matchFlag = !flagFilter || v.flagTitle === flagFilter || v.flagId === flagFilter;
      return matchSearch && matchFlag;
    });

    filtered.sort((a, b) => {
      let va, vb;
      if (sortKey === 'coord') {
        va = `${a.coordX.padStart(3, '0')}${a.coordY.padStart(3, '0')}`;
        vb = `${b.coordX.padStart(3, '0')}${b.coordY.padStart(3, '0')}`;
      } else {
        va = (a.name || '').toLowerCase();
        vb = (b.name || '').toLowerCase();
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    const rowsHtml = filtered.map((v, i) => {
      const bg = i % 2 === 0 ? '#f4e4bc' : '#e3d2a4';
      const flagCell = v.flagSrc
        ? `<img src="${v.flagSrc}" title="${escapeHtml(v.flagTitle)}" style="height:18px; vertical-align:middle;"> <span style="font-size:11px;">${escapeHtml(v.flagTitle)}</span>`
        : '<span style="color:#888;">— sem bandeira —</span>';
      return `<tr style="background:${bg};">
        <td style="padding:5px 6px;"><a href="${buildVillageLink(v.id)}" style="color:#603000; font-weight:bold; text-decoration:none;">${escapeHtml(v.name)}</a></td>
        <td style="padding:5px 6px;">${v.coordX}|${v.coordY}</td>
        <td style="padding:5px 6px;">${flagCell}</td>
      </tr>`;
    }).join('');

    $('#fv-tbody').html(rowsHtml || '<tr><td colspan="3" style="padding:10px; text-align:center;">Nenhum resultado</td></tr>');
  }

  $('#fv-search').on('input', renderTable);
  $('#fv-filter-flag').on('change', renderTable);
  $('#fv-table thead th[data-sort]').on('click', function () {
    const key = $(this).data('sort');
    if (sortKey === key) { sortAsc = !sortAsc; } else { sortKey = key; sortAsc = true; }
    renderTable();
  });

  loadAllPages();
})();
