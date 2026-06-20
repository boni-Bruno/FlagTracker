/* =========================================================================
 * Visualizador de Bandeiras - Tribal Wars
 * Autor: Bruno (TazarYoot) + Claude
 * Execução: javascript: $.getScript('URL_DO_SCRIPT')
 *
 * CHANGELOG
 * v2.0.0 (2026-06-20)
 *   - Reescrita completa com base na estrutura real confirmada (não existe
 *     uma tela "lista de bandeiras" com todas as aldeias de uma vez; é
 *     preciso entrar aldeia por aldeia em game.php?screen=flags&village=ID).
 *   - Lista de aldeias (id/nome/coordenada) vem de UMA chamada a
 *     overview_villages&mode=prod, lendo span.quickedit-vn (mesma fonte já
 *     validada no script do Armazém).
 *   - Bandeira atual de cada aldeia vem de #current_flag dentro da página
 *     de flags daquela aldeia (img + <strong> nome + <p> bônus).
 *   - Usa DOMParser (não $('<div>').html()) pra evitar execução de <script>
 *     embutido na resposta, que quebrava o parsing silenciosamente.
 *   - Requisições aldeia-por-aldeia feitas em sequência com pequeno delay
 *     (300ms) entre cada uma, com barra de progresso no painel.
 * v1.0.0 (2026-06-20)
 *   - Primeira versão, baseada em suposição de URL errada (descartada).
 * ========================================================================= */

(function () {
  'use strict';

  const SCRIPT_VERSION = '2.0.0';
  const REQUEST_DELAY_MS = 300;
  console.log(`[FlagViewer] v${SCRIPT_VERSION} iniciando...`);

  if (typeof game_data === 'undefined') {
    alert('Erro: este script deve ser executado dentro do Tribal Wars.');
    return;
  }

  $('#fv-overlay').remove();

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------
  const colors = { bg: '#f4e4bc', border: '#7d510f', header: '#603000', gold: '#c1a264' };

  const overlayHtml = `
    <div id="fv-overlay" style="position:fixed; top:50px; left:50%; transform:translateX(-50%);
        z-index:9999; width:760px; max-height:80vh; background:${colors.bg};
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
          <option value="__none__">Sem bandeira</option>
        </select>
        <span id="fv-status" style="white-space:nowrap; color:#603000;">Carregando lista de aldeias...</span>
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
  // Helpers
  // ---------------------------------------------------------------------
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function parseDoc(html) {
    // DOMParser em vez de $('<div>').html() - evita execução de <script>
    // embutido na resposta, que quebra o parsing silenciosamente.
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function buildVillageLink(id) {
    return `game.php?village=${id}&screen=overview`;
  }

  // ---------------------------------------------------------------------
  // 1) Lista de aldeias (id/nome/coordenada) - uma única requisição
  // ---------------------------------------------------------------------
  let villages = []; // { id, name, coordX, coordY, flagSrc, flagName, flagDesc, loaded }

  function parseVillageList(html) {
    const doc = parseDoc(html);
    const list = [];
    $(doc).find('span.quickedit-vn').each(function () {
      const id = $(this).attr('data-id');
      const name = $(this).text().trim();
      if (!id || !name) return;
      const $row = $(this).closest('tr');
      const rowText = $row.length ? $row.text() : '';
      const coordMatch = rowText.match(/(\d{1,3})\|(\d{1,3})/);
      list.push({
        id: String(id),
        name,
        coordX: coordMatch ? coordMatch[1] : '',
        coordY: coordMatch ? coordMatch[2] : '',
        flagSrc: '', flagName: '', flagDesc: '', loaded: false
      });
    });
    return list;
  }

  // ---------------------------------------------------------------------
  // 2) Bandeira atual de uma aldeia (uma requisição por aldeia)
  // ---------------------------------------------------------------------
  function parseCurrentFlag(html) {
    const doc = parseDoc(html);
    const $current = $(doc).find('#current_flag');
    const $img = $current.find('img').first();
    if ($img.length === 0) {
      return { flagSrc: '', flagName: '', flagDesc: '' };
    }
    return {
      flagSrc: $img.attr('src') || '',
      flagName: $current.find('strong').first().text().trim(),
      flagDesc: $current.find('p').first().text().trim()
    };
  }

  function loadFlagsSequentially(index) {
    if (index >= villages.length) {
      finishLoading();
      return;
    }
    const v = villages[index];
    $('#fv-status').text(`Carregando bandeiras... ${index + 1}/${villages.length}`);

    $.get(`game.php?village=${v.id}&screen=flags`, function (html) {
      const flag = parseCurrentFlag(html);
      v.flagSrc = flag.flagSrc;
      v.flagName = flag.flagName;
      v.flagDesc = flag.flagDesc;
      v.loaded = true;
      renderTable(); // atualiza progressivamente, aldeia por aldeia
      setTimeout(() => loadFlagsSequentially(index + 1), REQUEST_DELAY_MS);
    }).fail(function () {
      console.warn('[FlagViewer] Falha ao buscar bandeira da aldeia', v.id);
      v.loaded = true;
      setTimeout(() => loadFlagsSequentially(index + 1), REQUEST_DELAY_MS);
    });
  }

  function finishLoading() {
    console.log('[FlagViewer] Concluído:', villages.length, 'aldeia(s)');
    $('#fv-status').text(`${villages.length} aldeia(s)`);
    populateFlagFilter();
    renderTable();
  }

  function populateFlagFilter() {
    const seen = new Set();
    villages.forEach(v => {
      const key = v.flagName;
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

  function renderTable() {
    const search = ($('#fv-search').val() || '').toLowerCase();
    const flagFilter = $('#fv-filter-flag').val();

    let filtered = villages.filter(v => {
      const matchSearch = !search ||
        v.name.toLowerCase().includes(search) ||
        `${v.coordX}|${v.coordY}`.includes(search);
      const matchFlag = !flagFilter ||
        (flagFilter === '__none__' ? (v.loaded && !v.flagName) : v.flagName === flagFilter);
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
      let flagCell;
      if (!v.loaded) {
        flagCell = '<span style="color:#999;">carregando...</span>';
      } else if (v.flagSrc) {
        flagCell = `<img src="${v.flagSrc}" title="${escapeHtml(v.flagDesc)}" style="height:24px; vertical-align:middle;"> <span style="font-size:11px;">${escapeHtml(v.flagName)}</span>`;
      } else {
        flagCell = '<span style="color:#888;">— sem bandeira —</span>';
      }
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

  // ---------------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------------
  $.get(`game.php?village=${game_data.village.id}&screen=overview_villages&mode=prod&group=0`, function (html) {
    villages = parseVillageList(html);
    console.log('[FlagViewer] Aldeias encontradas:', villages.length);
    if (villages.length === 0) {
      $('#fv-status').text('Nenhuma aldeia encontrada — veja o console (F12).');
      console.warn('[FlagViewer] span.quickedit-vn não encontrado. Pode ser necessário ajustar parseVillageList().');
      return;
    }
    renderTable();
    loadFlagsSequentially(0);
  }).fail(function () {
    $('#fv-status').text('Erro ao carregar lista de aldeias.');
    console.warn('[FlagViewer] Falha na requisição de overview_villages.');
  });
})();
