/* Painel — static mirror of the internal /dashboard analytics view.
   Renders from data.json .stats, reproducing the same KPIs, 12-month trend,
   breakdowns and activity feed as the app on the resort network. */

const CL = { Clothing:'Roupa', Electronics:'Eletrónica', Documents:'Documentos', Keys:'Chaves',
  'Bags & Luggage':'Malas e Bagagem', 'Jewelry & Watches':'Joias e Relógios', Toiletries:'Artigos de Higiene',
  'Books & Media':'Livros e Média', 'Sports Equipment':'Equip. Desportivo', 'Children Items':'Artigos de Criança',
  Other:'Outros' };
const clabel = (c) => CL[c] || c || 'Outros';
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CARD = 'an-card';

function barRow(label, count, max, color) {
  const pct = max > 0 ? Math.round(count / max * 100) : 0;
  return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px;">'
    + `<div style="width:130px;font-size:0.8rem;color:#555;text-align:right;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(label)}">${esc(label)}</div>`
    + '<div style="flex:1;background:#F0F4F0;border-radius:6px;height:20px;position:relative;overflow:hidden;">'
    +   `<div style="position:absolute;top:0;left:0;bottom:0;width:${Math.max(pct, 2)}%;background:${color};border-radius:6px;"></div>`
    + '</div>'
    + `<div style="width:30px;font-size:0.8rem;font-weight:700;color:#111;text-align:right;flex-shrink:0;">${count}</div>`
    + '</div>';
}

function fmtDateTime(d) {
  if (!d) return '';
  const m = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const dt = new Date(String(d).replace(' ', 'T'));
  if (isNaN(dt.getTime())) return String(d);
  return `${dt.getDate()} ${m[dt.getMonth()]} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
}

function trendSvg(monthly) {
  const maxV = monthly.reduce((m, x) => Math.max(m, x.registered, x.returned), 1);
  const chartH = 160, baseY = 180, padL = 26, plotW = 694 - padL, slot = plotW / 12;
  let s = '<svg viewBox="0 0 720 210" width="100%" style="display:block;" preserveAspectRatio="xMidYMid meet">';
  for (const f of [0, 0.5, 1]) {
    const y = baseY - f * chartH;
    s += `<line x1="${padL}" y1="${y}" x2="714" y2="${y}" stroke="#EEF2EE" stroke-width="1"/>`
      +  `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#bbb">${Math.round(f * maxV)}</text>`;
  }
  monthly.forEach((mo, i) => {
    const x = padL + i * slot;
    const rH = mo.registered / maxV * chartH, tH = mo.returned / maxV * chartH;
    s += `<rect x="${(x + slot/2 - 9).toFixed(1)}" y="${(baseY - rH).toFixed(1)}" width="8" height="${rH.toFixed(1)}" rx="2" fill="#2E5E4E"><title>${esc(mo.label)}: ${mo.registered} registados</title></rect>`
      +  `<rect x="${(x + slot/2 + 1).toFixed(1)}" y="${(baseY - tH).toFixed(1)}" width="8" height="${tH.toFixed(1)}" rx="2" fill="#D6A84B"><title>${esc(mo.label)}: ${mo.returned} devolvidos</title></rect>`
      +  `<text x="${(x + slot/2).toFixed(1)}" y="${baseY + 14}" text-anchor="middle" font-size="9" fill="#999">${esc(mo.label)}</text>`;
    if (mo.isYearStart) s += `<text x="${(x + slot/2).toFixed(1)}" y="${baseY + 25}" text-anchor="middle" font-size="8" fill="#ccc">'${esc(mo.year)}</text>`;
  });
  return s + '</svg>';
}

function render(st) {
  const k = st.kpi, sc = st.statusCounts, ts = st.typeSplit;
  const maxOf = (a, key) => a.reduce((m, r) => Math.max(m, r[key]), 0);
  let h = '';

  // Attention now
  if (k.expiringSoon > 0 || k.overdue > 0) {
    h += '<div style="background:linear-gradient(135deg,#FEF3F2,#FFF7ED);border:1px solid #FED7AA;border-radius:16px;padding:18px 22px;margin-bottom:24px;">'
      + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2.2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
      + '<span style="font-weight:700;color:#9A3412;font-size:0.95rem;">Atenção agora</span>';
    if (k.overdue > 0)      h += `<span style="background:#DC2626;color:#fff;font-size:0.78rem;font-weight:700;padding:4px 12px;border-radius:20px;">${k.overdue} atrasados (&gt;90d)</span>`;
    if (k.expiringSoon > 0) h += `<span style="background:#F59E0B;color:#fff;font-size:0.78rem;font-weight:700;padding:4px 12px;border-radius:20px;">${k.expiringSoon} a expirar (&le;7d)</span>`;
    h += '</div>';
    if (st.expiringList && st.expiringList.length) {
      h += '<div style="margin-top:14px;display:flex;flex-direction:column;gap:6px;">';
      for (const it of st.expiringList) {
        const left = 90 - it.days;
        h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px;background:rgba(255,255,255,0.7);border-radius:9px;">'
          + `<span style="font-size:0.85rem;font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(it.title)}</span>`
          + `<span style="font-size:0.74rem;color:#9A3412;font-weight:700;flex-shrink:0;">${esc(clabel(it.category))} · ${left <= 0 ? 'Expirado' : left + 'd restantes'}</span>`
          + '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
  }

  // KPIs
  h += '<div class="an-kpis">'
    + `<div class="${CARD}"><div class="an-kpi__lbl">Total registado</div><div class="an-kpi__n">${k.total}</div><div class="an-kpi__sub">${ts.lost} perdidos · ${ts.storage} proprietários</div></div>`
    + `<div class="${CARD}"><div class="an-kpi__lbl">Em mãos agora</div><div class="an-kpi__n" style="color:#2563EB;">${k.active}</div><div class="an-kpi__sub">${sc.found} encontrados · ${sc.stored} armazenados</div></div>`
    + `<div class="${CARD}"><div class="an-kpi__lbl">Devolvidos</div><div class="an-kpi__n" style="color:#059669;">${k.returned}</div><div class="an-kpi__sub">Taxa de devolução: ${k.returnRate}%</div></div>`
    + `<div class="${CARD}"><div class="an-kpi__lbl">Descartados</div><div class="an-kpi__n" style="color:#9CA3AF;">${k.disposed}</div><div class="an-kpi__sub">${k.avgDaysToReturn == null ? 'Sem devoluções' : 'Devolução média: ' + k.avgDaysToReturn + ' dias'}</div></div>`
    + '</div>';

  // Pills
  h += '<div class="an-pills">'
    + `<div class="an-pill"><div class="an-kpi__lbl">Hoje</div><div style="font-size:1.5rem;font-weight:800;color:#111;">${k.registeredToday}</div></div>`
    + `<div class="an-pill"><div class="an-kpi__lbl">Registos / mês</div><div style="font-size:1.5rem;font-weight:800;color:#111;">${k.registeredThisMonth}</div></div>`
    + `<div class="an-pill"><div class="an-kpi__lbl">Devolvidos / mês</div><div style="font-size:1.5rem;font-weight:800;color:#111;">${k.returnedThisMonth}</div></div>`
    + `<div class="an-pill"><div class="an-kpi__lbl">Devolução média</div><div style="font-size:1.5rem;font-weight:800;color:#111;">${k.avgDaysToReturn == null ? '—' : k.avgDaysToReturn + 'd'}</div></div>`
    + `<div class="an-pill"><div class="an-kpi__lbl">Taxa devolução</div><div style="font-size:1.5rem;font-weight:800;color:#111;">${k.returnRate}%</div></div>`
    + '</div>';

  // Trend
  h += `<div class="${CARD}" style="margin-bottom:16px;">`
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">'
    + '<h2 class="an-sec-title" style="margin:0;">Tendência (12 meses)</h2>'
    + '<div style="display:flex;gap:16px;font-size:0.76rem;color:#666;">'
    + '<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:2px;background:#2E5E4E;display:inline-block;"></span>Registados</span>'
    + '<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:2px;background:#D6A84B;display:inline-block;"></span>Devolvidos</span>'
    + '</div></div>' + trendSvg(st.monthly) + '</div>';

  // Category + where lost
  const noData = (t) => `<p style="color:#999;font-size:0.85rem;">${t}</p>`;
  h += '<div class="an-2col">'
    + `<div class="${CARD}"><h2 class="an-sec-title">Por categoria</h2>`
    + (st.byCategory.length ? st.byCategory.map((r) => barRow(clabel(r.category), r.c, maxOf(st.byCategory,'c'), '#2E5E4E')).join('') : noData('Sem dados.'))
    + '</div>'
    + `<div class="${CARD}"><h2 class="an-sec-title">Onde se perde mais</h2>`
    + (st.byLocation.length ? st.byLocation.map((r) => barRow(r.loc, r.c, maxOf(st.byLocation,'c'), '#2563EB')).join('') : noData('Sem locais registados.'))
    + '</div></div>';

  // Storage + finder
  h += '<div class="an-2col">'
    + `<div class="${CARD}"><h2 class="an-sec-title">Em armazenamento agora</h2>`
    + (st.byStorage.length ? st.byStorage.map((r) => barRow(r.loc, r.c, maxOf(st.byStorage,'c'), '#7C3AED')).join('') : noData('Nada em armazenamento.'))
    + '</div>'
    + `<div class="${CARD}"><h2 class="an-sec-title">Quem mais encontra</h2>`
    + (st.byFinder.length ? st.byFinder.map((r) => barRow(r.fb, r.c, maxOf(st.byFinder,'c'), '#0891B2')).join('') : noData('Sem dados.'))
    + '</div></div>';

  // Recent activity
  h += `<div class="${CARD}" style="margin-bottom:8px;"><h2 class="an-sec-title">Atividade recente</h2>`;
  if (st.recentActivity && st.recentActivity.length) {
    h += '<div style="display:flex;flex-direction:column;">';
    st.recentActivity.forEach((a, i) => {
      h += `<div style="display:flex;gap:12px;padding:10px 0;${i < st.recentActivity.length - 1 ? 'border-bottom:1px solid #F2F5F2;' : ''}">`
        + `<div style="width:8px;height:8px;border-radius:50%;background:${i === 0 ? '#2E5E4E' : '#D4DDD6'};margin-top:6px;flex-shrink:0;"></div>`
        + '<div style="flex:1;min-width:0;"><div style="font-size:0.86rem;color:#111;">'
        + `<span style="font-weight:600;">${esc(a.action)}</span>`
        + (a.item_title ? ` · <span style="color:#2E5E4E;">${esc(a.item_title)}</span>` : '')
        + '</div>'
        + (a.details ? `<div style="font-size:0.78rem;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.details)}</div>` : '')
        + '</div>'
        + `<div style="font-size:0.74rem;color:#aaa;flex-shrink:0;text-align:right;">${esc(a.un || 'Sistema')}<br>${esc(fmtDateTime(a.created_at))}</div>`
        + '</div>';
    });
    h += '</div>';
  } else h += noData('Sem atividade ainda.');
  h += '</div>';

  document.getElementById('body').innerHTML = h;
}

const hh = new Date().getHours();
document.getElementById('saudacao').textContent = hh < 12 ? 'Bom dia' : (hh < 20 ? 'Boa tarde' : 'Boa noite');

fetch('./data.json?v=' + Date.now(), { cache: 'no-store' })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => {
    if (!d.stats) throw new Error('sem stats');
    if (d.updated) {
      const dt = new Date(d.updated);
      document.getElementById('updated').textContent = 'Atualizado a ' + dt.toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    }
    render(d.stats);
  })
  .catch((e) => {
    document.getElementById('body').innerHTML = '<p style="color:#999;">Não foi possível carregar o painel.</p>';
    console.error(e);
  });
