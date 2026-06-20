/* =========================================================================
 * Visualizador de Bandeiras - Tribal Wars
 * Autor: Bruno (TazarYoot) + Claude
 * Execução: javascript: $.getScript('URL_DO_SCRIPT')
 *
 * CHANGELOG
 * v3.3.0 (2026-06-20)
 *   - Filtro de grupos agora cobre TODOS os grupos (dinâmicos + manuais),
 *     lidos da barra "Grupos:" em mode=groups&type=static (a[data-group-id]),
 *     que lista os dois tipos juntos com o ID real de cada um.
 * v3.2.0 (2026-06-20)
 *   - Busca por nome substituída por filtro de Grupos (dinâmicos, lidos de
 *     screen=overview_villages&mode=groups&type=dynamic). Ao selecionar um
 *     grupo, busca os membros via mode=prod&group=ID e filtra a tabela já
 *     carregada (sem refazer as requisições de bandeira/edifícios).
 *   - OBS: cobre apenas grupos dinâmicos por enquanto; grupos manuais
 *     (type=static) podem ser adicionados se Bruno também usar esse tipo.
 * v3.1.0 (2026-06-20)
 *   - Armazém e Fazenda agora mostram a quantidade completa (ex: 400.000),
 *     em vez da abreviação "k".
 *   - Coluna Aldeia sem quebra de linha (white-space:nowrap) + scroll
 *     horizontal no painel pra acomodar nomes longos.
 * v3.0.0 (2026-06-20)
 *   - Novas colunas: Pontos, Armazém (nível + capacidade), Fazenda
 *     (nível + capacidade de população), Academia (nível), Bandeira
 *     (ícone + nome + percentual do bônus).
 *   - Todos os dados de edifício/pontos vêm do bloco "var game_data" já
 *     embutido na própria resposta de screen=flags&village=ID (mesma
 *     requisição que já buscava a bandeira) - sem requisições extras.
 *   - Extração via regex sobre o HTML bruto (não JSON.parse), igual à
 *     técnica validada no Armazém - mais resistente a JS extra na página.
 *   - Ordenação habilitada em todas as colunas (clique no cabeçalho).
 *   - Coluna de coordenada removida (não estava nos requisitos); coluna
 *     Aldeia mantida como estava.
 *   - Cabeçalho da tabela com cor mais contrastante (dourado mais vivo).
 *   - PENDENTE: troca da busca por filtro de Grupos - aguardando estrutura
 *     HTML dos grupos do jogo. Busca mantida por enquanto.
 * v2.0.0 (2026-06-20)
 *   - Reescrita completa com base na estrutura real confirmada.
 * v1.0.0 (2026-06-20)
 *   - Primeira versão, baseada em suposição de URL errada (descartada).
 * ========================================================================= */

(function () {
  'use strict';

  const SCRIPT_VERSION = '3.3.0';
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
  const colors = {
    bg: '#f4e4bc',
    border: '#7d510f',
    header: '#4a2500',
    gold: '#ffdd66'      // dourado mais vivo (antes #c1a264, ficava apagado)
  };

  const overlayHtml = `
    <div id="fv-overlay" style="position:fixed; top:40px; left:50%; transform:translateX(-50%);
        z-index:9999; width:920px; max-height:85vh; background:${colors.bg};
        border:3px solid ${colors.border}; border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,0.5);
        font-family:Verdana, Arial, sans-serif; font-size:12px; color:#3b2a14; overflow:hidden;">
      <div id="fv-header" style="background:${colors.header}; color:${colors.gold}; padding:8px 12px;
          cursor:move; display:flex; justify-content:space-between; align-items:center;
          text-shadow:0 1px 1px #000;">
        <strong>🚩 Visualizador de Bandeiras — v${SCRIPT_VERSION}</strong>
        <span id="fv-close" style="cursor:pointer; font-weight:bold; padding:0 6px;">✕</span>
      </div>
      <div style="padding:8px 12px; border-bottom:1px solid ${colors.border}; display:flex; gap:8px; align-items:center;">
        <select id="fv-filter-group" style="flex:1; padding:4px 6px; border:1px solid ${colors.border}; border-radius:3px;">
          <option value="">Todas as aldeias</option>
        </select>
        <select id="fv-filter-flag" style="padding:4px 6px; border:1px solid ${colors.border}; border-radius:3px;">
          <option value="">Todas as bandeiras</option>
          <option value="__none__">Sem bandeira</option>
        </select>
        <span id="fv-status" style="white-space:nowrap; color:#603000;">Carregando lista de aldeias...</span>
      </div>
      <div style="max-height:65vh; overflow-y:auto; overflow-x:auto;">
        <table id="fv-table" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:${colors.header}; color:${colors.gold}; text-shadow:0 1px 1px #000;">
              <th style="padding:7px 6px; text-align:left; cursor:pointer; font-weight:bold;" data-sort="name">Aldeia ▾</th>
              <th style="padding:7px 6px; text-align:right; cursor:pointer; font-weight:bold;" data-sort="points">Pontos ▾</th>
              <th style="padding:7px 6px; text-align:center; cursor:pointer; font-weight:bold;" data-sort="storage">Armazém ▾</th>
              <th style="padding:7px 6px; text-align:center; cursor:pointer; font-weight:bold;" data-sort="farm">Fazenda ▾</th>
              <th style="padding:7px 6px; text-align:center; cursor:pointer; font-weight:bold;" data-sort="academy">Academia ▾</th>
              <th style="padding:7px 6px; text-align:left; cursor:pointer; font-weight:bold;" data-sort="flag">Bandeira ▾</th>
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
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function buildVillageLink(id) {
    return `game.php?village=${id}&screen=overview`;
  }

  function formatFull(n) {
    const num = Number(n);
    if (n === null || n === undefined || isNaN(num)) return '?';
    return num.toLocaleString('pt-BR');
  }

  function formatPoints(n) {
    const num = Number(n);
    if (n === null || n === undefined || isNaN(num)) return '...';
    return num.toLocaleString('pt-BR');
  }

  // ---------------------------------------------------------------------
  // 1) Lista de aldeias (id/nome) - uma única requisição
  // ---------------------------------------------------------------------
  let villages = [];
  /* cada item: { id, name, points, storageLevel, storageMax, farmLevel,
     popMax, academyLevel, flagSrc, flagName, flagDesc, flagPct, loaded } */

  function parseVillageList(html) {
    const doc = parseDoc(html);
    const list = [];
    $(doc).find('span.quickedit-vn').each(function () {
      const id = $(this).attr('data-id');
      const name = $(this).text().trim();
      if (!id || !name) return;
      list.push({
        id: String(id), name,
        points: null, storageLevel: null, storageMax: null,
        farmLevel: null, popMax: null, academyLevel: null,
        flagSrc: '', flagName: '', flagDesc: '', flagPct: null,
        loaded: false
      });
    });
    return list;
  }

  function parseGroupList(html) {
    const doc = parseDoc(html);
    const groups = [];
    $(doc).find('a.group-menu-item[data-group-id]').each(function () {
      const id = $(this).attr('data-group-id');
      let name = $(this).text().trim().replace(/^\[/, '').replace(/\]$/, '').trim();
      if (id && name) groups.push({ id: String(id), name });
    });
    return groups;
  }

  let currentGroupMemberIds = null; // null = sem filtro de grupo (todas as aldeias)

  function loadGroups() {
    // a barra "Grupos:" (dinâmicos + manuais juntos, com IDs reais) aparece
    // na página type=static
    $.get(`game.php?village=${game_data.village.id}&screen=overview_villages&mode=groups&type=static`, function (html) {
      const groups = parseGroupList(html);
      groups.forEach(g => {
        $('#fv-filter-group').append(`<option value="${g.id}">${escapeHtml(g.name)}</option>`);
      });
      console.log('[FlagViewer] Grupos encontrados:', groups.length);
    }).fail(function () {
      console.warn('[FlagViewer] Falha ao carregar lista de grupos.');
    });
  }

  function applyGroupFilter(groupId) {
    if (!groupId) {
      currentGroupMemberIds = null;
      renderTable();
      return;
    }
    $('#fv-status').text('Filtrando por grupo...');
    $.get(`game.php?village=${game_data.village.id}&screen=overview_villages&mode=prod&group=${groupId}`, function (html) {
      const members = parseVillageList(html);
      currentGroupMemberIds = new Set(members.map(v => v.id));
      renderTable();
      $('#fv-status').text(`${villages.length} aldeia(s)`);
    }).fail(function () {
      console.warn('[FlagViewer] Falha ao filtrar pelo grupo', groupId);
      currentGroupMemberIds = null;
      renderTable();
    });
  }

  // ---------------------------------------------------------------------
  // 2) Bandeira + dados de edifício de uma aldeia (uma requisição/aldeia)
  // ---------------------------------------------------------------------
  function extractVillageBlock(html) {
    const startMarker = '"village":{';
    const startIdx = html.indexOf(startMarker);
    if (startIdx === -1) return '';
    let endIdx = html.indexOf('},"nav":', startIdx);
    if (endIdx === -1) endIdx = html.indexOf('"link_base"', startIdx);
    if (endIdx === -1) return '';
    return html.substring(startIdx + startMarker.length - 1, endIdx + 1);
  }

  function extractNum(str, key) {
    const m = str.match(new RegExp('"' + key + '"\\s*:\\s*"?(-?\\d+(?:\\.\\d+)?)"?'));
    return m ? m[1] : null;
  }

  function extractSubBlock(str, key) {
    const m = str.match(new RegExp('"' + key + '"\\s*:\\s*\\{([^}]*)\\}'));
    return m ? m[1] : '';
  }

  function parseVillageStats(html) {
    const vBlock = extractVillageBlock(html);
    const buildingsBlock = extractSubBlock(vBlock, 'buildings');
    return {
      points: extractNum(vBlock, 'points'),
      storageMax: extractNum(vBlock, 'storage_max'),
      popMax: extractNum(vBlock, 'pop_max'),
      storageLevel: extractNum(buildingsBlock, 'storage'),
      farmLevel: extractNum(buildingsBlock, 'farm'),
      academyLevel: extractNum(buildingsBlock, 'snob')
    };
  }

  function parseCurrentFlag(html) {
    const doc = parseDoc(html);
    const $current = $(doc).find('#current_flag');
    const $img = $current.find('img').first();
    if ($img.length === 0) {
      return { flagSrc: '', flagName: '', flagDesc: '', flagPct: null };
    }
    const flagDesc = $current.find('p').first().text().trim();
    const pctMatch = flagDesc.match(/([+-]?\d+)%/);
    return {
      flagSrc: $img.attr('src') || '',
      flagName: $current.find('strong').first().text().trim(),
      flagDesc,
      flagPct: pctMatch ? pctMatch[1] : null
    };
  }

  function loadFlagsSequentially(index) {
    if (index >= villages.length) {
      finishLoading();
      return;
    }
    const v = villages[index];
    $('#fv-status').text(`Carregando dados... ${index + 1}/${villages.length}`);

    $.get(`game.php?village=${v.id}&screen=flags`, function (html) {
      const stats = parseVillageStats(html);
      const flag = parseCurrentFlag(html);
      Object.assign(v, stats, flag);
      v.loaded = true;
      renderTable();
      setTimeout(() => loadFlagsSequentially(index + 1), REQUEST_DELAY_MS);
    }).fail(function () {
      console.warn('[FlagViewer] Falha ao buscar dados da aldeia', v.id);
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

  function getSortValue(v, key) {
    switch (key) {
      case 'points': return v.points === null ? -1 : Number(v.points);
      case 'storage': return v.storageLevel === null ? -1 : Number(v.storageLevel);
      case 'farm': return v.farmLevel === null ? -1 : Number(v.farmLevel);
      case 'academy': return v.academyLevel === null ? -1 : Number(v.academyLevel);
      case 'flag': return v.flagPct === null ? -9999 : Number(v.flagPct);
      default: return (v.name || '').toLowerCase();
    }
  }

  function renderTable() {
    const flagFilter = $('#fv-filter-flag').val();

    let filtered = villages.filter(v => {
      const matchGroup = !currentGroupMemberIds || currentGroupMemberIds.has(v.id);
      const matchFlag = !flagFilter ||
        (flagFilter === '__none__' ? (v.loaded && !v.flagName) : v.flagName === flagFilter);
      return matchGroup && matchFlag;
    });

    filtered.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    const rowsHtml = filtered.map((v, i) => {
      const bg = i % 2 === 0 ? '#f4e4bc' : '#e3d2a4';

      if (!v.loaded) {
        return `<tr style="background:${bg};">
          <td style="padding:5px 6px; white-space:nowrap;"><a href="${buildVillageLink(v.id)}" style="color:#603000; font-weight:bold; text-decoration:none;">${escapeHtml(v.name)}</a></td>
          <td colspan="5" style="padding:5px 6px; color:#999;">carregando...</td>
        </tr>`;
      }

      const pointsCell = formatPoints(v.points);
      const storageCell = `Nível ${v.storageLevel ?? '?'}<br><span style="font-size:10px; color:#5c4322;">(${formatFull(v.storageMax)})</span>`;
      const farmCell = `Nível ${v.farmLevel ?? '?'}<br><span style="font-size:10px; color:#5c4322;">(${formatFull(v.popMax)} pop)</span>`;
      const academyCell = `Nível ${v.academyLevel ?? '?'}`;
      const flagCell = v.flagSrc
        ? `<img src="${v.flagSrc}" title="${escapeHtml(v.flagDesc)}" style="height:24px; vertical-align:middle;"> <span style="font-size:11px;">${escapeHtml(v.flagName)}${v.flagPct !== null ? ' (' + v.flagPct + '%)' : ''}</span>`
        : '<span style="color:#888;">— sem bandeira —</span>';

      return `<tr style="background:${bg};">
        <td style="padding:5px 6px; white-space:nowrap;"><a href="${buildVillageLink(v.id)}" style="color:#603000; font-weight:bold; text-decoration:none;">${escapeHtml(v.name)}</a></td>
        <td style="padding:5px 6px; text-align:right;">${pointsCell}</td>
        <td style="padding:5px 6px; text-align:center;">${storageCell}</td>
        <td style="padding:5px 6px; text-align:center;">${farmCell}</td>
        <td style="padding:5px 6px; text-align:center;">${academyCell}</td>
        <td style="padding:5px 6px;">${flagCell}</td>
      </tr>`;
    }).join('');

    $('#fv-tbody').html(rowsHtml || '<tr><td colspan="6" style="padding:10px; text-align:center;">Nenhum resultado</td></tr>');
  }

  $('#fv-filter-group').on('change', function () { applyGroupFilter($(this).val()); });
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
      console.warn('[FlagViewer] span.quickedit-vn não encontrado.');
      return;
    }
    renderTable();
    loadFlagsSequentially(0);
  }).fail(function () {
    $('#fv-status').text('Erro ao carregar lista de aldeias.');
    console.warn('[FlagViewer] Falha na requisição de overview_villages.');
  });

  loadGroups();
})();
