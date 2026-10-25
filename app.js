/* Soeuringue — application (données stockées uniquement sur l'appareil) */
(function () {
  'use strict';
  const E = window.Engine;
  const KEY = 'soeuringue_v1';
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const JOURS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']; // getDay()
  const JOURS_ORDRE = [1, 2, 3, 4, 5, 6, 0];
  const JOURS_LONG = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

  // ---------- état ----------
  let S = load();
  const UI = { month: E.iso(new Date()).slice(0, 7), draft: null, patientDate: E.iso(new Date()), soinsVue: 'jour', soinsDate: E.iso(new Date()) };
  const copts = () => ({ tarifs: S.tarifs, regles: S.regles, absences: S.absences });
  const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  function blank() {
    return { v: 1, cabinets: [], patients: [], soins: [], virements: [],
      tarifs: JSON.parse(JSON.stringify(E.DEFAULT_TARIFS)), regles: Object.assign({}, E.DEFAULT_REGLES),
      apiKey: '', aiModel: 'claude-haiku-5-5', tournees: {}, absences: [], faits: [], transmissions: {} };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const s = Object.assign(blank(), JSON.parse(raw));
      s.tarifs = Object.assign(JSON.parse(JSON.stringify(E.DEFAULT_TARIFS)), s.tarifs || {});
      s.regles = Object.assign({}, E.DEFAULT_REGLES, s.regles || {});
      return s;
    } catch (e) { return blank(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Impossible d'enregistrer : mémoire pleine ?"); }
  }
  if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => {}); }

  // ---------- utilitaires ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const eur = n => fmt.format(Math.round((n || 0) * 100) / 100);
  const eur0 = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round(n || 0));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const today = () => E.iso(new Date());
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const monthLabel = ym => { const [y, m] = ym.split('-'); return MOIS[+m - 1] + ' ' + y; };
  const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const dateFr = s => { const d = E.parseIso(s); return JOURS_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]; };
  const dateCourt = s => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
  const cab = id => S.cabinets.find(c => c.id === id);
  const pat = id => S.patients.find(p => p.id === id);

  function toast(msg) {
    $$('.toast').forEach(x => x.remove());
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function sheet(html, mount) {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) close(); });
    $$('[data-close]', m).forEach(b => b.addEventListener('click', close));
    if (mount) mount(m, close);
    return close;
  }
  function confirmBox(msg, okLabel, cb) {
    sheet('<h2>' + esc(msg) + '</h2><div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" id="cf-ok">' + esc(okLabel) + '</button></div>',
      (m, close) => $('#cf-ok', m).addEventListener('click', () => { close(); cb(); }));
  }

  // ---------- calculs ----------
  function monthData(ym) {
    const passages = E.coteMois(S, ym);
    const byCab = {}, byPat = {};
    S.cabinets.forEach(c => byCab[c.id] = { facture: 0, part: 0, recu: 0 });
    passages.forEach(ps => {
      const p = pat(ps.patientId); if (!p) return;
      byPat[p.id] = (byPat[p.id] || 0) + ps.total;
      if (byCab[p.cabinetId]) byCab[p.cabinetId].facture += ps.total;
    });
    S.virements.filter(v => v.mois === ym).forEach(v => { if (byCab[v.cabinetId]) byCab[v.cabinetId].recu += Number(v.montant) || 0; });
    let tot = { facture: 0, part: 0, recu: 0 };
    S.cabinets.forEach(c => {
      const b = byCab[c.id]; b.part = b.facture * (1 - (Number(c.retro) || 0) / 100);
      tot.facture += b.facture; tot.part += b.part; tot.recu += b.recu;
    });
    return { passages, byCab, byPat, tot };
  }
  function recText(s) {
    const r = s.rec || { type: 'once' };
    let t = r.type === 'once' ? 'Le ' + dateCourt(s.start)
      : r.type === 'daily' ? 'Tous les jours'
      : r.type === 'every2' ? 'Tous les 2 jours'
      : 'Les ' + JOURS_ORDRE.filter(d => (r.days || []).includes(d)).map(d => JOURS_LONG[d]).join(' ');
    if (r.type !== 'once') t += ' · depuis le ' + dateCourt(s.start) + (s.end ? ' jusqu’au ' + dateCourt(s.end) : '');
    return t;
  }
  const actsText = acts => (acts || []).map(a => (a.qty > 1 ? a.qty + ' × ' : '') + E.actLabel(a)).join(' · ');

  // ---------- reconnaissance locale ----------
  const RULES = [
    [/bilan.*plaie|\bami ?11\b/, 'bilan_plaie'],
    [/bas de contention|\btension\b|constantes|temperature|saturation/, 'HORS'],
    [/renouvel.*bsi|bsi.*renouvel|\bdi ?1[,.]2/, 'bsi_renouv'],
    [/bilan.*bsi|bsi initial|\bdi ?2[,.]5/, 'bsi_initial'],
    [/\bbsa\b|(dependance|bsi|forfait) leger/, 'bsa_f'],
    [/\bbsb\b|(dependance|bsi|forfait) intermediaire/, 'bsb_f'],
    [/\bbsc\b|(dependance|bsi|forfait) lourd/, 'bsc_f'],
    [/dependan|toilette|nursing|hygiene|\bbsi\b/, 'dependance'],
    [/\bvac\b|\btpn\b|pression negative/, 'tpn'],
    [/compression|bandes? de contention sur|urgo ?k2|coban|biflex/, 'pans_compression'],
    [/stomie|tracheo/, 'stomie'],
    [/analges|emla/, 'analgesie'],
    [/escarre|ulcere|mechage|meche|irrigation|lourd|complexe|brulure|amputation|fistule|perforant|greffe|osteosynthese|detersion|defibrin/, 'pans_lourd'],
    [/agrafe|\bfils\b|points de suture/, 'FILS'],
    [/pansement|\bpst\b|\bpans\b|plaie/, 'pans_simple'],
    [/dextro|glycemi|\bhgt\b|\bglyc/, 'dextro'],
    [/insuline|lantus|novorapid|humalog|toujeo|levemir|abasaglar|apidra|fiasp|tresiba/, 'insuline'],
    [/prise de sang|\bpds\b|bilan sanguin|prelevement sanguin|\bnfs\b|\binr\b|plaquett|\bcrp\b|hemoculture|\bbs\b sang/, 'prise_sang'],
    [/ecbu|urine|coproculture|prelevement/, 'prelev'],
    [/vaccin/, 'vaccin'],
    [/chimio/, 'chimio'],
    [/astreinte|surveillance.*24 ?h/, 'perf_astreinte'],
    [/(retrait|debranchement definitif|ablation).*(perf|ligne|diffuseur)/, 'perf_retrait'],
    [/changement de (flacon|poche)|\bflacon\b|branchement en y|debranchement temporaire/, 'perf_chg'],
    [/perf.*(longue|> ?1 ?h|plus d.?une heure|diffuseur|[2-9] ?h|1[0-9] ?h|24 ?h)/, 'perf_longue'],
    [/heure (de perf )?(en )?plus|heure supplementaire|\bami ?6\b/, 'perf_heure'],
    [/perf/, 'perf_courte'],
    [/chambre implantable|\bpac\b/, 'inj_iv_pac'],
    [/\bvvc\b|picc/, 'inj_iv_vvc'],
    [/intraveineuse|\bivd?\b/, 'inj_iv'],
    [/intradermique|\bid\b/, 'inj_id'],
    [/implant|zoladex/, 'implant'],
    [/injection|piqure|\bsc\b|sous[- ]?cut|\bim\b|intramusc|lovenox|innohep|fragmine|heparine|anticoag|arixtra/, 'inj_sc'],
    [/aerosol|nebul/, 'aerosol'],
    [/lavage vesical|vesirig/, 'lavage_vesical'],
    [/(retrait|ablation|enlever).*sonde/, 'retrait_sonde'],
    [/alimentation|enterale|gavage|nutri/, 'alim_enterale'],
    [/lavement|fecalome|microlax|normacol/, 'lavement'],
    [/pilulier|medicament|traitement oral|administration/, 'admin_medic'],
    [/prado/, 'prado']
  ];
  const NUMS = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
  function parseLocal(text) {
    const segs = norm(text).split(/\+|,|;|\n|\bet\b|\bpuis\b/).map(s => s.trim()).filter(Boolean);
    const acts = [], unknown = [];
    segs.forEach(seg => {
      let id = null;
      for (const [re, v] of RULES) if (re.test(seg)) { id = v; break; }
      if (id === 'FILS') id = /plus de 10|> ?10|\b(1[1-9]|[2-9]\d)\b/.test(seg) ? 'ablation_fils_plus' : 'ablation_fils';
      if (id === 'HORS') { unknown.push(seg + ' (hors NGAP : inclus dans le BSI ou non facturable)'); return; }
      if (!id) { unknown.push(seg); return; }
      let qty = 1;
      const m = seg.match(/^(\d+)\s*(x|fois)?\b/) || seg.match(/\bx ?(\d+)\b/);
      if (m) qty = Math.min(9, parseInt(m[1], 10)) || 1;
      const w = seg.match(/^(un|une|deux|trois|quatre|cinq|six)\b/); if (w) qty = NUMS[w[1]];
      const ex = acts.find(a => a.id === id && id !== 'pans_simple' && id !== 'insuline');
      if (ex) ex.qty += qty; else acts.push({ id, qty });
    });
    return { acts, unknown };
  }

  // ---------- IA (texte des soins uniquement, jamais le nom du patient) ----------
  async function parseAI(text) {
    const list = Object.entries(E.ACTS).filter(([k]) => k !== 'manuel').map(([k, v]) => k + ' : ' + v.l).join('\n');
    const system = "Tu convertis une description de soins infirmiers libéraux (dictée ou tapée, en français, parfois avec des abréviations) en actes d'un catalogue NGAP. " +
      "Réponds UNIQUEMENT avec un objet JSON de la forme {\"actes\":[{\"id\":\"...\",\"qty\":1}],\"inconnus\":[\"...\"]}. " +
      "N'utilise que les id du catalogue ci-dessous. qty = nombre d'actes identiques au même passage. Si un soin ne correspond à aucun id, mets son texte dans inconnus. " +
      "Les forfaits BSA, BSB, BSC (dépendance légère, intermédiaire, lourde) correspondent à bsa_f, bsb_f, bsc_f. Toilette, nursing ou dépendance sans niveau précisé : dependance.\n\nCatalogue :\n" + list;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': S.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: S.aiModel || 'claude-haiku-5-5', max_tokens: 500, system, messages: [{ role: 'user', content: text }] })
    });
    if (!res.ok) { const t = await res.text(); throw new Error('Erreur ' + res.status + (res.status === 401 ? ' : clé API refusée' : '') + ' ' + t.slice(0, 120)); }
    const data = await res.json();
    const out = (data.content || []).map(c => c.text || '').join('');
    const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    const acts = (json.actes || []).filter(a => E.ACTS[a.id] && a.id !== 'manuel').map(a => ({ id: a.id, qty: Math.max(1, Math.min(9, parseInt(a.qty, 10) || 1)) }));
    return { acts, unknown: json.inconnus || [] };
  }

  // ---------- rendu ----------
  const app = $('#app');
  function setTab(name) { $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === name)); }
  function brandTop(title, right) {
    return '<div class="top"><div class="brand"><img src="icon-180.png" alt=""><h1>' + esc(title) + '</h1></div>' + (right || '') + '</div>';
  }
  function backTop(href, label, right) {
    return '<div class="top"><a class="back" href="' + href + '">‹ ' + esc(label) + '</a>' + (right || '') + '</div>';
  }
  function installBanner() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (standalone || localStorage.getItem('soeur_banner_off')) return '';
    return '<div class="banner noprint">Pour l’installer sur l’iPhone : bouton <b>Partager</b> de Safari, puis <b>Sur l’écran d’accueil</b>. Utilise ensuite toujours l’icône : les données sont gardées dans l’appli installée. <button class="back" id="bn-off" style="min-height:32px">OK</button></div>';
  }

  function route() {
    const h = location.hash.replace(/^#/, '') || 'mois';
    const [path, query] = h.split('?');
    const parts = path.split('/');
    const q = Object.fromEntries(new URLSearchParams(query || ''));
    window.scrollTo(0, 0); document.body.classList.remove('noTabs');
    switch (parts[0]) {
      case 'cabinets': setTab('cabinets'); return viewCabinets();
      case 'cabinet': setTab('cabinets'); return viewCabinet(parts[1]);
      case 'patients': setTab('patients'); return viewPatients(parts[1]);
      case 'patient': setTab('patients'); return viewPatient(parts[1]);
      case 'ajout': setTab(''); document.body.classList.add('noTabs'); return viewAjout(q);
      case 'soins': setTab('soins'); return viewSoins();
      case 'transmissions': setTab('transmissions'); return viewTransmissions();
      case 'reglages': setTab('mois'); return viewReglages();
      case 'tarifs': setTab('mois'); return viewTarifs();
      case 'detail': setTab('mois'); return viewDetail(q);
      default: setTab('mois'); return viewMois();
    }
  }
  window.addEventListener('hashchange', route);

  // ----- Mois -----
  function monthNav() {
    return '<div class="rowx noprint" style="margin-bottom:12px"><button class="icon-btn" id="m-prev" aria-label="Mois précédent" style="background:#fff">‹</button>' +
      '<div style="font-weight:700;font-size:17px;text-transform:capitalize">' + monthLabel(UI.month) + '</div>' +
      '<button class="icon-btn" id="m-next" aria-label="Mois suivant" style="background:#fff">›</button></div>';
  }
  function bindMonthNav() {
    $('#m-prev').onclick = () => { UI.month = shiftMonth(UI.month, -1); route(); };
    $('#m-next').onclick = () => { UI.month = shiftMonth(UI.month, 1); route(); };
  }
  function viewMois() {
    if (!S.cabinets.length) {
      app.innerHTML = installBanner() + '<div class="empty"><img src="logo-full.png" alt="Soeuringue"><h2>Bienvenue</h2><p class="note">Commence par créer le cabinet où tu remplaces. Tu pourras en ajouter d’autres ensuite.</p></div>' +
        '<button class="btn accent" id="first-cab">Créer mon premier cabinet</button><a class="btn ghost" href="#reglages" style="margin-top:10px">Importer mes patients depuis un tableau</a>';
      bindBanner();
      $('#first-cab').onclick = () => editCabinet(null);
      return;
    }
    const d = monthData(UI.month);
    const ecart = d.tot.recu - d.tot.part;
    let h = installBanner() + brandTop('Soeuringue', '<a class="icon-btn" href="#reglages" aria-label="Réglages" style="display:flex;align-items:center;justify-content:center;background:#fff;text-decoration:none;color:var(--ink)"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></a>') + monthNav();
    h += '<div class="hero"><div class="lbl">Ce que tu devrais toucher</div><div class="big">' + eur0(d.tot.part) + '</div>' +
      '<div class="sub">' + eur(d.tot.facture) + ' facturés par les titulaires · rétrocession déduite</div>' +
      '<div class="row soft"><span>Reçu des titulaires</span><span>' + eur(d.tot.recu) + '</span></div>' +
      (d.tot.recu > 0 || d.tot.part > 0 ? '<div class="row white ' + (ecart >= -0.5 ? 'ok' : '') + '"><span>' + (ecart >= -0.5 ? 'Tout est reçu' : 'Il manque') + '</span><span>' + (ecart >= -0.5 ? '✓' : eur(-ecart)) + '</span></div>' : '') +
      '</div>';
    h += '<div class="section">Par cabinet</div>';
    S.cabinets.forEach(c => {
      const b = d.byCab[c.id]; const e = b.recu - b.part;
      const pill = b.part === 0 && b.recu === 0 ? '' : e >= -0.5 ? '<span class="pill ok">OK</span>' : '<span class="pill warn">− ' + eur0(-e) + '</span>';
      h += '<a class="card" href="#cabinet/' + c.id + '" style="display:block;text-decoration:none;color:inherit"><div class="rowx" style="margin-bottom:10px"><b style="font-size:16px">' + esc(c.nom) + '</b>' + pill + '</div>' +
        '<div class="grid3"><div>Facturé<b>' + eur0(b.facture) + '</b></div><div>Ta part<b>' + eur0(b.part) + '</b></div><div>Reçu<b>' + eur0(b.recu) + '</b></div></div></a>';
    });
    h += '<div class="btns"><a class="btn" href="#ajout">+ Noter un passage</a></div>';
    h += '<a class="btn ghost" href="#detail">Détail du mois (PDF)</a>';
    app.innerHTML = h; bindMonthNav(); bindBanner();
  }
  function bindBanner() { const b = $('#bn-off'); if (b) b.onclick = () => { localStorage.setItem('soeur_banner_off', '1'); route(); }; }

  // ----- Cabinets -----
  function viewCabinets() {
    const d = monthData(UI.month);
    let h = brandTop('Cabinets');
    if (!S.cabinets.length) h += '<p class="note">Aucun cabinet pour l’instant.</p>';
    else {
      h += '<div class="list">';
      S.cabinets.forEach(c => {
        const n = S.patients.filter(p => p.cabinetId === c.id).length;
        h += '<a class="item" href="#cabinet/' + c.id + '"><div><div class="t">' + esc(c.nom) + '</div><div class="s">' + (c.titulaire ? esc(c.titulaire) + ' · ' : '') + 'rétrocession ' + (c.retro || 0) + ' %</div></div><span class="v">' + eur0(d.byCab[c.id].part) + '</span></a>';
      });
      h += '</div><p class="note">Montants : ta part en ' + monthLabel(UI.month) + '.</p>';
    }
    h += '<button class="btn accent" id="new-cab">+ Nouveau cabinet</button>';
    app.innerHTML = h; $('#new-cab').onclick = () => editCabinet(null);
  }
  function editCabinet(id) {
    const c = id ? cab(id) : { nom: '', retro: 10 };
    sheet('<h2>' + (id ? 'Modifier le cabinet' : 'Nouveau cabinet') + '</h2>' +
      '<label class="f" for="c-nom">Nom du cabinet</label><input class="in" id="c-nom" value="' + esc(c.nom) + '" autocomplete="off" placeholder="ex : Cabinet Rosa Parks">' +
      '<label class="f" for="c-tit">Nom de la titulaire</label><input class="in" id="c-tit" value="' + esc(c.titulaire || '') + '" autocomplete="off" autocapitalize="words">' +
      '<label class="f" for="c-tel">Téléphone de la titulaire</label><input class="in" id="c-tel" type="tel" value="' + esc(c.tel || '') + '" autocomplete="off">' +
      '<label class="f" for="c-retro">Rétrocession au titulaire (%)</label><input class="in" id="c-retro" type="number" inputmode="decimal" min="0" max="100" step="0.5" value="' + esc(c.retro) + '">' +
      '<div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="c-ok">Enregistrer</button></div>' +
      (id ? '<button class="btn danger" id="c-del">Supprimer ce cabinet</button>' : ''),
      (m, close) => {
        $('#c-ok', m).onclick = () => {
          const nom = $('#c-nom', m).value.trim(); if (!nom) return toast('Donne un nom au cabinet');
          const retro = parseFloat(String($('#c-retro', m).value).replace(',', '.')) || 0;
          const extra = { titulaire: $('#c-tit', m).value.trim(), tel: $('#c-tel', m).value.trim() };
          if (id) Object.assign(c, { nom, retro }, extra); else S.cabinets.push(Object.assign({ id: uid(), nom, retro }, extra));
          save(); close(); route();
        };
        const del = $('#c-del', m);
        if (del) del.onclick = () => {
          const n = S.patients.filter(p => p.cabinetId === id).length;
          if (n) return toast('Déplace ou supprime d’abord ses ' + n + ' patient(s)');
          confirmBox('Supprimer « ' + c.nom + ' » ?', 'Supprimer', () => { S.cabinets = S.cabinets.filter(x => x.id !== id); S.virements = S.virements.filter(v => v.cabinetId !== id); save(); close(); location.hash = '#cabinets'; });
        };
      });
  }
  function viewCabinet(id) {
    const c = cab(id); if (!c) { location.hash = '#cabinets'; return; }
    const d = monthData(UI.month); const b = d.byCab[id];
    const nPts = S.patients.filter(p => p.cabinetId === id).length;
    let h = backTop('#cabinets', 'Cabinets', '<button class="back" id="cab-edit">Modifier</button>');
    h += '<h1 style="font-size:26px;margin:0 0 2px">' + esc(c.nom) + '</h1><p class="note" style="margin:0 0 12px">Rétrocession ' + (c.retro || 0) + ' % · <a href="#patients/' + id + '">' + nPts + ' patient' + (nPts > 1 ? 's' : '') + ' ›</a></p>';
    h += '<div class="card rowx"><div><div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Titulaire</div><div style="font-size:17px;font-weight:700;margin-top:2px">' + (c.titulaire ? esc(c.titulaire) : '<span class="note">Non renseignée — touche Modifier</span>') + '</div></div>' +
      (c.tel ? '<a class="btn accent small" style="min-height:44px" href="tel:' + esc(c.tel.replace(/[^\d+]/g, '')) + '">Appeler</a>' : '') + '</div>';
    h += monthNav();
    h += '<div class="card grid3"><div>Facturé<b>' + eur(b.facture) + '</b></div><div>Ta part<b>' + eur(b.part) + '</b></div><div>Reçu<b style="color:' + (b.recu + 0.5 < b.part ? 'var(--warn)' : 'var(--ink)') + '">' + eur(b.recu) + '</b></div></div>';
    h += '<button class="btn ghost" id="vir-add">Noter un virement reçu</button>';
    const virs = S.virements.filter(v => v.cabinetId === id && v.mois === UI.month);
    if (virs.length) {
      h += '<div class="section">Virements pour ' + monthLabel(UI.month) + '</div><div class="list">';
      virs.forEach(v => h += '<button class="item" data-vir="' + v.id + '"><div><div class="t">' + eur(v.montant) + '</div><div class="s">Reçu le ' + dateCourt(v.date) + (v.note ? ' · ' + esc(v.note) : '') + '</div></div><span class="s">Modifier</span></button>');
      h += '</div>';
    }
    h += '<div class="btns"><a class="btn" href="#ajout?cabinet=' + id + '">+ Noter un passage</a></div>';
    app.innerHTML = h; bindMonthNav();
    $('#cab-edit').onclick = () => editCabinet(id);
    $('#vir-add').onclick = () => editVirement(id, null);
    $$('[data-vir]').forEach(el => el.onclick = () => editVirement(id, el.dataset.vir));
  }
  function editVirement(cabId, vid) {
    const v = vid ? S.virements.find(x => x.id === vid) : { montant: '', date: today(), mois: UI.month, note: '' };
    let opts = ''; for (let i = -6; i <= 1; i++) { const ym = shiftMonth(UI.month, i); opts += '<option value="' + ym + '"' + (ym === v.mois ? ' selected' : '') + '>' + monthLabel(ym) + '</option>'; }
    sheet('<h2>' + (vid ? 'Modifier le virement' : 'Virement reçu') + '</h2><p class="note">' + esc(cab(cabId).nom) + '</p>' +
      '<label class="f" for="v-m">Montant reçu (€)</label><input class="in" id="v-m" type="number" inputmode="decimal" step="0.01" value="' + esc(v.montant) + '">' +
      '<label class="f" for="v-mois">Pour le mois de</label><select class="in" id="v-mois">' + opts + '</select>' +
      '<label class="f" for="v-d">Date de réception</label><input class="in" id="v-d" type="date" value="' + esc(v.date) + '">' +
      '<label class="f" for="v-n">Note (facultatif)</label><input class="in" id="v-n" value="' + esc(v.note) + '">' +
      '<div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="v-ok">Enregistrer</button></div>' +
      (vid ? '<button class="btn danger" id="v-del">Supprimer</button>' : ''),
      (m, close) => {
        $('#v-ok', m).onclick = () => {
          const montant = parseFloat(String($('#v-m', m).value).replace(',', '.'));
          if (!(montant >= 0)) return toast('Indique le montant reçu');
          const data = { montant, mois: $('#v-mois', m).value, date: $('#v-d', m).value || today(), note: $('#v-n', m).value.trim() };
          if (vid) Object.assign(v, data); else S.virements.push(Object.assign({ id: uid(), cabinetId: cabId }, data));
          save(); close(); route();
        };
        const del = $('#v-del', m); if (del) del.onclick = () => { S.virements = S.virements.filter(x => x.id !== vid); save(); close(); route(); };
      });
  }

  // ----- Patients -----
  function viewPatients(cabId) {
    const d = monthData(UI.month);
    const c = cabId ? cab(cabId) : null;
    if (cabId && !c) { location.hash = '#patients'; return; }
    const patItem = (p, showCab) => '<a class="item" href="#patient/' + p.id + '"><div><div class="t">' + esc(p.nom) + '</div><div class="s">' + (showCab ? esc((cab(p.cabinetId) || {}).nom || '') + ' · ' : '') + esc(p.adresse || '') + (p.adresse ? '' : badges(p)) + '</div></div><span class="v">' + eur0(d.byPat[p.id] || 0) + '</span></a>';
    let h;
    if (c) {
      h = backTop('#patients', 'Cabinets', '<button class="btn accent small" id="p-new" style="min-height:44px">+ Nouveau patient</button>') +
        '<h1 style="font-size:26px;margin:0 0 10px">' + esc(c.nom) + '</h1>';
    } else {
      h = brandTop('Patients');
    }
    h += '<input class="in noprint" id="p-search" placeholder="' + (c ? 'Rechercher dans ce cabinet' : 'Rechercher dans tous les cabinets') + '" autocomplete="off" style="margin-bottom:12px"><div id="p-list"></div>';
    app.innerHTML = h;
    const draw = () => {
      const qv = norm($('#p-search').value).trim();
      let out = '';
      if (c) {
        const pts = S.patients.filter(p => p.cabinetId === c.id && (!qv || norm(p.nom).includes(qv) || norm(p.adresse).includes(qv))).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
        out = pts.length ? '<div class="list">' + pts.map(p => patItem(p, false)).join('') + '</div><p class="note">' + pts.length + ' patient(s)</p>' : '<p class="note">Aucun patient' + (qv ? ' trouvé' : ' dans ce cabinet') + '.</p>';
      } else if (qv) {
        const pts = S.patients.filter(p => norm(p.nom).includes(qv) || norm(p.adresse).includes(qv)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
        out = pts.length ? '<div class="list">' + pts.map(p => patItem(p, true)).join('') + '</div>' : '<p class="note">Aucun patient trouvé.</p>';
      } else {
        out = S.cabinets.length ? '<div class="list">' + S.cabinets.map(cb => {
          const n = S.patients.filter(p => p.cabinetId === cb.id).length;
          return '<a class="item" href="#patients/' + cb.id + '"><div><div class="t">' + esc(cb.nom) + '</div><div class="s">' + (cb.titulaire ? esc(cb.titulaire) + ' · ' : '') + n + ' patient' + (n > 1 ? 's' : '') + '</div></div><span class="s">›</span></a>';
        }).join('') + '</div>' : '<p class="note">Crée d’abord un cabinet dans l’onglet Cabinets.</p>';
      }
      $('#p-list').innerHTML = out;
    };
    $('#p-search').oninput = draw; draw();
    const nb = $('#p-new'); if (nb) nb.onclick = () => createPatient(c.id);
  }
  function createPatient(cabId) {
    if (!S.cabinets.length) return toast('Crée d’abord un cabinet');
    const tmp = {};
    sheet('<h2>Nouveau patient</h2><label class="f" for="cp-nom">Nom</label><input class="in" id="cp-nom" autocomplete="off" autocapitalize="words" placeholder="ex : M. Bernard Martin">' +
      '<label class="f" for="cp-cab">Cabinet</label><select class="in" id="cp-cab">' + S.cabinets.map(c => '<option value="' + c.id + '"' + (c.id === (cabId || UI.lastCab) ? ' selected' : '') + '>' + esc(c.nom) + '</option>').join('') + '</select>' +
      coordFields(tmp, 'cp-') + patientFields(tmp, 'cp-') +
      '<div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="cp-ok">Créer</button></div>',
      (m, close) => $('#cp-ok', m).onclick = () => {
        const nom = $('#cp-nom', m).value.trim(); if (!nom) return toast('Indique le nom');
        const cabId = $('#cp-cab', m).value;
        if (S.patients.some(p => p.cabinetId === cabId && norm(p.nom) === norm(nom))) return toast('Ce patient existe déjà dans ce cabinet');
        const p = Object.assign({ id: uid(), nom, cabinetId: cabId }, readPatientFields(m, 'cp-'), readCoord(m, 'cp-'));
        S.patients.push(p); save(); close(); UI.lastCab = cabId;
        if (p.adresse) UI.mapsPrompt = p.id;
        location.hash = '#patient/' + p.id;
      });
  }
  function badges(p) {
    const b = [];
    if (p.bsi) b.push(p.bsi);
    if (p.diab) b.push('Diabétique sous insuline');
    if (p.cancer) b.push('Cancéreux / immunodéprimé');
    if (p.palliatif) b.push('Soins palliatifs');
    if (p.enfant7) b.push('Moins de 7 ans');
    if (p.km > 0) b.push(p.km + ' km');
    return esc(b.join(' · ') || 'Patient');
  }
  function coordFields(p, prefix) {
    const f = (k, l, type, ph) => '<label class="f" for="' + prefix + k + '">' + l + '</label><input class="in" id="' + prefix + k + '"' + (type ? ' type="' + type + '"' : '') + ' value="' + esc(p[k] || '') + '" placeholder="' + (ph || '') + '" autocomplete="off">';
    return f('adresse', 'Adresse', '', 'n°, rue, code postal, ville') +
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">' +
      '<div>' + f('code', 'Code d’accès', '', '') + '</div><div>' + f('etage', 'Étage', '', '') + '</div><div>' + f('porte', 'Porte', '', '') + '</div></div>' +
      f('tel', 'Téléphone', 'tel', '06…') +
      f('nomNote', 'Nom dans la note (si différent)', '', 'ex : Martin') +
      '<label class="f" for="' + prefix + 'noteSoin">Note de soin</label><textarea class="in" id="' + prefix + 'noteSoin" placeholder="ex : pansement complexe mollet gauche tous les jours">' + esc(p.noteSoin || '') + '</textarea>';
  }
  function readCoord(m, prefix) {
    const o = {}; ['adresse', 'code', 'etage', 'porte', 'tel', 'noteSoin', 'nomNote'].forEach(k => { const el = $('#' + prefix + k, m); if (el) o[k] = el.value.trim(); });
    return o;
  }
  function mapsUrl(p) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.adresse); }
  function patientFields(p, prefix) {
    const bs = ['', 'BSA', 'BSB', 'BSC'];
    return '<label class="f" for="' + prefix + 'bsi">Forfait dépendance (BSI)</label><select class="in" id="' + prefix + 'bsi">' +
      bs.map(x => '<option value="' + x + '"' + ((p.bsi || '') === x ? ' selected' : '') + '>' + (x ? x + ' (' + eur(S.tarifs[x.toLowerCase()]) + ' / jour)' : 'Pas de BSI') + '</option>').join('') + '</select><p class="note" style="margin:4px 4px 0">Niveau par défaut. Si tu tapes BSA, BSB ou BSC dans un soin, c’est ce niveau-là qui compte.</p>' +
      '<label class="chk"><span>Diabétique sous insuline</span><input type="checkbox" id="' + prefix + 'diab"' + (p.diab ? ' checked' : '') + '></label>' +
      '<label class="chk"><span>Cancéreux ou immunodéprimé</span><input type="checkbox" id="' + prefix + 'cancer"' + (p.cancer ? ' checked' : '') + '></label>' +
      '<label class="chk"><span>Soins palliatifs (MCI à chaque passage)</span><input type="checkbox" id="' + prefix + 'pall"' + (p.palliatif ? ' checked' : '') + '></label>' +
      '<label class="chk"><span>Enfant de moins de 7 ans</span><input type="checkbox" id="' + prefix + 'enf"' + (p.enfant7 ? ' checked' : '') + '></label>' +
      '<label class="f" for="' + prefix + 'km">Distance hors agglomération (km, aller) — laisser 0 en ville</label><input class="in" id="' + prefix + 'km" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(p.km || 0) + '">';
  }
  function readPatientFields(m, prefix) {
    return { bsi: $('#' + prefix + 'bsi', m).value || '', diab: $('#' + prefix + 'diab', m).checked, cancer: $('#' + prefix + 'cancer', m).checked,
      palliatif: $('#' + prefix + 'pall', m).checked, enfant7: $('#' + prefix + 'enf', m).checked, km: parseFloat(String($('#' + prefix + 'km', m).value).replace(',', '.')) || 0 };
  }
  function editPatient(id) {
    const p = pat(id);
    sheet('<h2>Modifier le patient</h2><label class="f" for="pe-nom">Nom</label><input class="in" id="pe-nom" value="' + esc(p.nom) + '" autocomplete="off">' +
      '<label class="f" for="pe-cab">Cabinet</label><select class="in" id="pe-cab">' + S.cabinets.map(c => '<option value="' + c.id + '"' + (c.id === p.cabinetId ? ' selected' : '') + '>' + esc(c.nom) + '</option>').join('') + '</select>' +
      coordFields(p, 'pe-') + patientFields(p, 'pe-') +
      '<div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="pe-ok">Enregistrer</button></div><button class="btn danger" id="pe-del">Supprimer ce patient</button>',
      (m, close) => {
        $('#pe-ok', m).onclick = () => {
          const nom = $('#pe-nom', m).value.trim(); if (!nom) return toast('Indique le nom');
          const hadAddr = p.adresse;
          Object.assign(p, { nom, cabinetId: $('#pe-cab', m).value }, readPatientFields(m, 'pe-'), readCoord(m, 'pe-')); save(); close();
          if (p.adresse && p.adresse !== hadAddr) UI.mapsPrompt = p.id;
          route();
        };
        $('#pe-del', m).onclick = () => confirmBox('Supprimer ' + p.nom + ' et tous ses soins ?', 'Supprimer', () => {
          IDB.all().then(all => delPhotos(all.filter(x => x.patientId === id).map(x => x.id))).catch(() => {});
          S.patients = S.patients.filter(x => x.id !== id); S.soins = S.soins.filter(s => s.patientId !== id); save(); close(); location.hash = '#patients/' + p.cabinetId;
        });
      });
  }
  function cotationBox(passages, title) {
    if (!passages.length) return '<div class="cot"><div class="h">' + esc(title) + '</div><div class="note">Aucun soin ce jour-là.</div></div>';
    let h = '<div class="cot"><div class="h">' + esc(title) + '</div>';
    let tot = 0;
    passages.forEach(ps => {
      if (passages.length > 1) h += '<div style="font-weight:700;margin-top:6px">Passage de ' + ps.heure.replace(':', ' h ') + '</div>';
      ps.lines.forEach(l => h += '<div class="line"><span>' + esc(l.label.replace(/ (Entier|Demi|Gratuit|Inclus)$/, '')) + '<span class="tag ' + l.taux + '">' + l.taux + '</span><br><span class="d">' + esc(l.detail) + '</span></span><b>' + eur(l.montant) + '</b></div>');
      tot += ps.total;
    });
    return h + '<div class="line tot"><span>Total facturé</span><span>' + eur(tot) + '</span></div></div>';
  }
  function viewPatient(id) {
    const p = pat(id); if (!p) { location.hash = '#patients'; return; }
    const c = cab(p.cabinetId);
    const d = monthData(UI.month);
    const soins = S.soins.filter(s => s.patientId === id).sort((a, b) => (a.heure || '').localeCompare(b.heure || ''));
    const recs = soins.filter(s => (s.rec || {}).type !== 'once');
    const actifs = recs.filter(s => !s.end || s.end >= today()), finis = recs.filter(s => s.end && s.end < today());
    const passes = soins.filter(s => (s.rec || {}).type === 'once').sort((a, b) => b.start.localeCompare(a.start) || (b.heure || '').localeCompare(a.heure || ''));
    const isAbs = s => (S.absences || []).some(a => a.patientId === s.patientId && a.date === s.start);
    let h = '<div class="top" style="margin-bottom:4px;min-height:40px"><a class="back" href="#patients/' + p.cabinetId + '">‹ ' + esc(c ? c.nom : 'Patients') + '</a><button class="back" id="pt-edit">Modifier</button></div>';
    h += '<h1 style="font-size:24px;margin:0;line-height:1.2">' + esc(p.nom) + '</h1>';
    const bd = badges(p); if (bd !== 'Patient') h += '<p class="note" style="margin:2px 0 0;font-size:13px">' + bd + '</p>';
    h += trLines(id, today()).replace(/class="tr /g, 'style="margin-top:6px" class="tr ');
    if (p.adresse || p.code || p.etage || p.porte || p.tel) {
      const tag = (l, v) => v ? '<span class="pill info" style="font-size:13px;padding:5px 10px">' + l + ' <b>' + esc(v) + '</b></span>' : '';
      h += '<div class="card" style="padding:12px 14px;margin-top:10px">';
      if (p.adresse) h += '<div style="font-size:15px;font-weight:600;line-height:1.3">' + esc(p.adresse) + '</div>';
      if (p.code || p.etage || p.porte) h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' + tag('Code', p.code) + tag('Étage', p.etage) + tag('Porte', p.porte) + '</div>';
      if (p.adresse || p.tel) h += '<div style="display:grid;grid-template-columns:repeat(' + ((p.adresse && p.tel) ? 2 : 1) + ',minmax(0,1fr));gap:8px;margin-top:10px">' +
        (p.adresse ? '<a class="btn accent" style="min-height:44px;font-size:15px" href="' + mapsUrl(p) + '" target="_blank" rel="noopener">Maps</a>' : '') +
        (p.tel ? '<a class="btn ghost" style="min-height:44px;font-size:15px" href="tel:' + esc(p.tel.replace(/[^\d+]/g, '')) + '">Appeler</a>' : '') + '</div>';
      h += '</div>';
    }
    if (p.noteSoin) h += '<a class="card rowx" href="#ajout?patient=' + id + '&note=1" style="background:#FDF6E8;padding:10px 14px;text-decoration:none;color:inherit;gap:10px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px">' + esc(p.noteSoin) + '</span><b style="color:var(--accent);font-size:14px;white-space:nowrap">Créer le soin ›</b></a>';
    const nph = patientPhotos(id).length;
    h += '<div class="g2" style="grid-template-columns:1fr auto auto;margin:2px 0 4px"><a class="btn" href="#ajout?patient=' + id + '" style="min-height:46px">+ Passage</a>' +
      '<button class="btn ' + (p.ordo ? 'accent' : 'ghost') + ' small" id="pt-ordo" style="min-height:46px;padding:0 12px">📄 Ordo' + (p.ordo ? ' ✓' : '') + '</button>' +
      '<button class="btn ghost small" id="pt-photos" style="min-height:46px;padding:0 12px">📷' + (nph ? ' ' + nph : '') + '</button></div>';
    const passItem = s => '<div class="item" style="padding:6px 8px 6px 14px;min-height:54px"><button class="back" data-pass="' + s.id + '" style="flex:1;min-width:0;text-align:left;color:inherit;display:block;font-weight:400;min-height:42px"><div class="t" style="font-size:15px">' + esc(dateFr(s.start)) + (isAbs(s) ? ' <span class="pill warn" style="font-size:11px">absent</span>' : '') + '</div><div class="s" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">' + esc(actsText(s.acts)) + '</div></button>' +
      '<button class="chip" data-redo="' + s.id + '" style="min-height:40px;padding:0 12px;font-size:14px;flex:none">Refaire</button></div>';
    h += '<div class="rowx" style="margin:12px 4px 6px"><span class="note" style="font-weight:700;text-transform:uppercase;letter-spacing:.5px;font-size:12px">Derniers passages</span>' + (passes.length > 3 ? '<button class="back" id="pt-all" style="min-height:32px;font-size:14px">' + (UI.allPass ? 'Voir moins' : 'Voir tout (' + passes.length + ')') + '</button>' : '') + '</div>';
    h += passes.length ? '<div class="list" style="margin-bottom:8px">' + passes.slice(0, UI.allPass ? 999 : 3).map(passItem).join('') + '</div>' : '<p class="note" style="margin:0 4px 8px">Aucun passage noté pour l’instant.</p>';
    const soinItem = s => '<button class="item" data-soin-menu="' + s.id + '" style="padding:8px 14px"><div><div class="t" style="font-size:15px">' + esc(actsText(s.acts)) + '</div><div class="s">' + esc(recText(s)) + (s.dimanche ? ' · dim./fériés' : '') + '</div></div><span class="s">⋯</span></button>';
    if (actifs.length) h += '<div class="note" style="font-weight:700;text-transform:uppercase;letter-spacing:.5px;font-size:12px;margin:10px 4px 6px">Soins répétés</div><div class="list" style="margin-bottom:8px">' + actifs.map(soinItem).join('') + '</div>';
    const mt = d.byPat[id] || 0;
    h += '<div class="rowx" style="background:var(--ink);color:#fff;border-radius:14px;padding:10px 14px;margin-top:4px"><span style="font-size:14px">' + esc(monthLabel(UI.month).replace(/^./, x => x.toUpperCase())) + ' · ta part ' + eur(mt * (1 - ((c && c.retro) || 0) / 100)) + '</span><b>' + eur(mt) + '</b></div>';
    if (finis.length) h += '<div class="note" style="font-weight:700;text-transform:uppercase;letter-spacing:.5px;font-size:12px;margin:14px 4px 6px">Soins répétés terminés</div><div class="list">' + finis.map(soinItem).join('') + '</div>';
    app.innerHTML = h;
    $('#pt-edit').onclick = () => editPatient(id);
    $$('[data-soin-menu]').forEach(b => b.onclick = () => soinMenu(b.dataset.soinMenu));
    $$('[data-redo]').forEach(b => b.onclick = () => redoToday(b.dataset.redo));
    $$('[data-pass]').forEach(b => b.onclick = () => passageSheet(b.dataset.pass));
    $('#pt-ordo').onclick = () => ordoMenu(id, () => route());
    $('#pt-photos').onclick = () => photosSheet(id);
    const all = $('#pt-all'); if (all) all.onclick = () => { UI.allPass = !UI.allPass; route(); };
    if (UI.mapsPrompt === id && p.adresse) { UI.mapsPrompt = null; mapsSheet(p); }
  }
  function passageSheet(sid) {
    const s = S.soins.find(x => x.id === sid); const p = pat(s.patientId);
    const pass = E.coteJour(p, S.soins, s.start, copts());
    const phs = (s.photos || []);
    sheet(cotationBox(pass, dateFr(s.start).replace(/^./, x => x.toUpperCase()) + (pass.length > 1 ? ' (tous les passages du jour)' : '')).replace('class="cot"', 'class="cot" style="margin-top:0"') +
      (phs.length ? '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:10px">' + phs.map(id => '<button class="back" data-big="' + id + '" style="padding:0;min-height:0;display:block"><img data-pid="' + id + '" alt="Photo du soin" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:#dde7ee;display:block"></button>').join('') + '</div>' : '') +
      '<div class="btns"><button class="btn ghost" id="ps-redo">Refaire</button><a class="btn ghost" href="#ajout?soin=' + sid + '" id="ps-edit">Modifier</a></div>' +
      '<div class="btns" style="margin-top:0"><button class="btn danger" id="ps-del">Supprimer</button><button class="btn" data-close>Fermer</button></div>',
      (m, close) => {
        fillThumbs(m); $$('[data-big]', m).forEach(b => b.onclick = async () => viewPhoto(await photoUrl(b.dataset.big), dateFr(s.start)));
        $('#ps-redo', m).onclick = () => { close(); redoToday(sid); };
        $('#ps-edit', m).addEventListener('click', () => close());
        $('#ps-del', m).onclick = () => confirmBox('Supprimer le passage du ' + dateFr(s.start) + ' ?', 'Supprimer', () => { delPhotos(s.photos); S.soins = S.soins.filter(x => x.id !== sid); save(); close(); route(); });
      });
  }
  function mapsSheet(p) {
    sheet('<h2>Ajouter dans Google Maps ?</h2><p class="note">Google Maps va s’ouvrir sur l’adresse de ' + esc(p.nom) + '. Touche <b>Enregistrer</b>, puis choisis ta liste de patients.</p>' +
      '<div class="btns"><button class="btn ghost" data-close>Plus tard</button><a class="btn accent" id="mp-go" href="' + mapsUrl(p) + '" target="_blank" rel="noopener">Ouvrir Maps</a></div>', (m, close) => { $('#mp-go', m).addEventListener('click', () => setTimeout(close, 300)); });
  }
  function redoToday(sid) {
    const s = S.soins.find(x => x.id === sid);
    const t = today(), demain = E.addDays(t, 1), hier = E.addDays(t, -1);
    let def = E.addDays(s.start, 1); if (def > demain) def = demain;
    const chip = (d, l) => '<button class="chip' + (d === def ? ' on' : '') + '" data-d="' + d + '" style="min-height:44px">' + l + '</button>';
    sheet('<h2>Refaire ce soin</h2><p class="note">' + esc(actsText(s.acts)) + '</p><label class="f">Pour quel jour ?</label>' +
      '<div class="chips" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr))">' + chip(hier, 'Hier') + chip(t, 'Aujourd’hui') + chip(demain, 'Demain') + '</div>' +
      '<label class="f" for="rd-date">Ou une autre date</label><input class="in" type="date" id="rd-date" value="' + def + '">' +
      '<div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="rd-ok">Noter le ' + esc(dateFr(def)) + '</button></div>',
      (m, close) => {
        const set = d => { $('#rd-date', m).value = d; $$('[data-d]', m).forEach(b => b.classList.toggle('on', b.dataset.d === d)); $('#rd-ok', m).textContent = 'Noter le ' + dateFr(d); };
        $$('[data-d]', m).forEach(b => b.onclick = () => set(b.dataset.d));
        $('#rd-date', m).onchange = e => e.target.value && set(e.target.value);
        $('#rd-ok', m).onclick = () => {
          const d = $('#rd-date', m).value || def;
          const sig = x => JSON.stringify((x.acts || []).map(a => [a.id, a.qty, a.coef || 0]));
          if (S.soins.some(x => x.patientId === s.patientId && (x.rec || {}).type === 'once' && x.start === d && sig(x) === sig(s))) { toast('Déjà noté le ' + dateFr(d)); return; }
          S.soins.push({ id: uid(), patientId: s.patientId, heure: s.heure, acts: JSON.parse(JSON.stringify(s.acts)), rec: { type: 'once' }, start: d, end: '', dimanche: E.isDimancheOuFerie(d), nuit: false });
          save(); close(); toast('Noté pour le ' + dateFr(d)); route();
        };
      });
  }
  function soinMenu(sid) {
    const s = S.soins.find(x => x.id === sid);
    sheet('<h2>' + esc(actsText(s.acts)) + '</h2><p class="note">' + esc(recText(s)) + '</p>' +
      ((s.rec || {}).type !== 'once' ? '<button class="btn ghost" id="sm-stop" style="margin-top:12px">Arrêter ce soin à partir d’aujourd’hui</button>' : '') +
      '<a class="btn ghost" href="#ajout?soin=' + sid + '" style="margin-top:10px">Modifier</a>' +
      '<button class="btn ghost" id="sm-dup" style="margin-top:10px">Copier vers une autre date ou heure</button>' +
      '<button class="btn danger" id="sm-del" style="margin-top:10px">' + ((s.rec || {}).type === 'once' ? 'Supprimer ce passage' : 'Supprimer (efface aussi le passé)') + '</button>' +
      '<button class="btn" data-close style="margin-top:10px">Fermer</button>',
      (m, close) => {
        const st = $('#sm-stop', m); if (st) st.onclick = () => { s.end = E.addDays(today(), -1) < s.start ? s.start : E.addDays(today(), -1); save(); close(); toast('Soin arrêté'); route(); };
        $('#sm-dup', m).onclick = () => { close(); location.hash = '#ajout?dup=' + sid; };
        $('#sm-del', m).onclick = () => confirmBox('Supprimer ce soin, passé compris ?', 'Supprimer', () => { delPhotos(s.photos); S.soins = S.soins.filter(x => x.id !== sid); save(); close(); route(); });
      });
  }

  // ----- Ajout / modification d'un soin -----
  function viewAjout(q) {
    if (!S.cabinets.length) { toast('Crée d’abord un cabinet'); location.hash = '#mois'; return; }
    const existing = q.soin ? S.soins.find(s => s.id === q.soin) : null;
    const dup = q.dup ? S.soins.find(s => s.id === q.dup) : null;
    const base = existing || dup;
    const p0 = base ? pat(base.patientId) : q.patient ? pat(q.patient) : null;
    const start = existing ? existing.start : (q.date || today());
    UI.draft = {
      id: existing ? existing.id : null,
      cabinetId: p0 ? p0.cabinetId : (q.cabinet || (S.cabinets.length === 1 ? S.cabinets[0].id : (UI.lastCab && cab(UI.lastCab) ? UI.lastCab : S.cabinets[0].id))),
      patientId: p0 ? p0.id : null, patientName: p0 ? p0.nom : '',
      newP: { bsi: '', diab: false, cancer: false, palliatif: false, enfant7: false, km: 0, adresse: '', code: '', etage: '', porte: '', tel: '', noteSoin: '' },
      texte: (q.note && p0 && p0.noteSoin) ? p0.noteSoin : '', acts: base ? JSON.parse(JSON.stringify(base.acts)) : [], unknown: [],
      heure: base ? base.heure : nowHM(),
      rec: existing ? JSON.parse(JSON.stringify(existing.rec)) : { type: 'once', days: [1, 2, 3, 4, 5] },
      start, end: existing ? (existing.end || '') : '',
      dimanche: existing ? !!existing.dimanche : E.isDimancheOuFerie(start),
      showDetail: false, back: q.back || '',
      photoIds: existing ? (existing.photos || []).slice() : [], newPhotos: []
    };
    if (UI.draft.texte) { const r = parseLocal(UI.draft.texte); mergeActs(r.acts); UI.draft.unknown = r.unknown; }
    drawAjout();
  }
  function drawAjout() {
    const D = UI.draft;
    const rep = D.rec.type !== 'once';
    const df = E.isDimancheOuFerie(D.start);
    let h = '<div class="top" style="margin-bottom:8px;min-height:40px"><a class="back" href="javascript:history.back()">' + (D.id ? 'Annuler' : 'Fermer') + '</a><b style="font-size:17px">' + (D.id ? 'Modifier le soin' : 'Nouveau soin') + '</b><span style="width:60px"></span></div>';
    // cabinet + patient
    h += '<div class="g2" style="grid-template-columns:38% 1fr"><select class="in sm" id="a-cab" aria-label="Cabinet">' + S.cabinets.map(c => '<option value="' + c.id + '"' + (c.id === D.cabinetId ? ' selected' : '') + '>' + esc(c.nom) + '</option>').join('') + '</select>' +
      '<div style="position:relative"><input class="in sm" id="a-pat" value="' + esc(D.patientName) + '" placeholder="Patient" aria-label="Patient" autocomplete="off" autocapitalize="words"><div id="a-sugg" class="sugg-pop"></div></div></div>';
    h += '<div id="a-newp"></div><div id="a-tools"></div>';
    // texte + reconnaître
    h += '<div class="g2" style="grid-template-columns:1fr auto;margin-top:8px"><textarea class="in sm" id="a-txt" rows="2" aria-label="Soins du passage" placeholder="Tape ou dicte : escarre + insuline + glycémie" style="min-height:50px;height:50px">' + esc(D.texte) + '</textarea>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><button class="btn small" id="a-local" style="min-height:' + (S.apiKey ? 22 : 50) + 'px;font-size:14px;padding:0 12px">Reconnaître</button>' +
      (S.apiKey ? '<button class="btn ghost small" id="a-ai" style="min-height:22px;font-size:13px;padding:0 12px">IA</button>' : '') + '</div></div>';
    if (D.unknown.length) h += '<div class="unknown" style="padding:6px 10px;margin:6px 0;font-size:13px">Pas reconnu : <b>' + D.unknown.map(esc).join(', ') + '</b></div>';
    // actes
    h += '<div class="rowx" style="margin:10px 4px 4px"><span class="note" style="font-weight:700;text-transform:uppercase;letter-spacing:.5px;font-size:12px">Actes du passage</span><button class="back" id="a-addact" style="min-height:32px;font-size:15px">+ Ajouter</button></div><div id="a-acts" style="max-height:192px;overflow:auto">';
    if (!D.acts.length) h += '<p class="note" style="margin:4px">Aucun acte : tape les soins puis « Reconnaître », ou « + Ajouter ».</p>';
    D.acts.forEach((a, i) => {
      const def = E.ACTS[a.id] || E.ACTS.manuel;
      h += '<div class="act sm"><span class="n">' + esc(E.actLabel(a)) + '</span><span class="c">' + (def.manuel ? 'AMI ' + E.fmtCoef(a.coef || 0) : def.dependance ? (def.niveau ? eur(S.tarifs[def.niveau.toLowerCase()]) : 'forfait') : (def.di ? 'DI ' : 'AMI ') + E.fmtCoef(def.c)) + '</span>' +
        '<span class="qty"><button class="icon-btn" data-minus="' + i + '" aria-label="Moins">−</button><span>' + a.qty + '</span><button class="icon-btn" data-plus="' + i + '" aria-label="Plus">+</button></span></div>';
    });
    h += '</div>';
    // date + heure + répéter
    h += '<div class="g2" style="grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) auto;margin-top:8px;align-items:center"><input class="in sm" type="date" id="a-start" value="' + esc(D.start) + '" aria-label="' + (rep ? 'À partir du' : 'Date') + '"><input class="in sm" type="time" id="a-h" value="' + esc(D.heure) + '" aria-label="Heure">' +
      '<button class="chip' + (rep ? ' on' : '') + '" id="a-rep" aria-pressed="' + rep + '" style="min-height:44px;padding:0 10px;font-size:14px">Répéter</button></div>';
    if (rep) {
      h += '<div class="chips" style="margin-top:8px">' + [['daily', 'Tous les jours'], ['every2', 'Tous les 2 j'], ['weekdays', 'Certains jours']].map(([k, l]) => '<button class="chip' + (D.rec.type === k ? ' on' : '') + '" data-rec="' + k + '" style="min-height:40px">' + l + '</button>').join('') + '</div>';
      if (D.rec.type === 'weekdays') h += '<div class="days">' + JOURS_ORDRE.map(d => '<button class="chip' + ((D.rec.days || []).includes(d) ? ' on' : '') + '" data-day="' + d + '" aria-label="' + JOURS_LONG[d] + '">' + JOURS[d] + '</button>').join('') + '</div>';
      h += '<div class="g2" style="grid-template-columns:auto 1fr;align-items:center;margin-top:8px"><label class="note" for="a-end">Jusqu’au</label><input class="in sm" type="date" id="a-end" value="' + esc(D.end) + '"></div>';
      h += '<label class="chk sm"><span>Dimanches et fériés compris</span><input type="checkbox" id="a-dim"' + (D.dimanche ? ' checked' : '') + '></label>';
    } else if (df) {
      h += '<label class="chk sm"><span>Majoration ' + (E.parseIso(D.start).getDay() === 0 ? 'dimanche' : 'jour férié') + ' (+' + eur(S.tarifs.dimanche) + ')</span><input type="checkbox" id="a-dim"' + (D.dimanche ? ' checked' : '') + '></label>';
    }
    h += '<div id="a-cot"></div>';
    h += '<div class="savebar"><div style="display:flex;gap:10px;max-width:528px;margin:0 auto">' + (D.id ? '' : '<button class="btn ghost" id="a-abs" style="flex:0 0 108px">Absent</button>') + '<button class="btn" id="a-save" style="flex:1">Enregistrer</button></div></div>';
    app.innerHTML = h;
    bindAjout(); drawSugg(); drawTools(); drawPreview();
  }
  function drawTools() {
    const D = UI.draft; const box = $('#a-tools'); if (!box) return;
    const p = D.patientId && pat(D.patientId);
    const o = p && p.ordo;
    const nPh = D.photoIds.length + D.newPhotos.length;
    box.innerHTML = '<div class="g2" style="grid-template-columns:repeat(' + (o ? 3 : 2) + ',minmax(0,1fr));margin-top:6px">' +
      '<button class="chip" id="a-ordo" style="min-height:40px;font-size:14px;padding:0 6px;white-space:nowrap">📄 ' + (o ? 'Ordo ✓' : 'Ordonnance') + '</button>' +
      (o ? '<button class="chip on" id="a-apply" style="min-height:42px;font-size:14px;padding:0 6px">Appliquer</button>' : '') +
      '<button class="chip' + (nPh ? ' on' : '') + '" id="a-photo" style="min-height:40px;font-size:14px;padding:0 6px;white-space:nowrap">📷 Photo' + (nPh ? ' (' + nPh + ')' : '') + '</button></div>';
    $('#a-ordo').onclick = () => {
      syncDraft();
      if (!D.patientName.trim()) return toast('Choisis d’abord le patient');
      const pid = ensureDraftPatient();
      ordoMenu(pid, () => { save(); drawSugg(); drawTools(); });
    };
    const ap = $('#a-apply'); if (ap) ap.onclick = () => {
      syncDraft();
      D.acts = JSON.parse(JSON.stringify(o.acts)); D.unknown = [];
      drawAjout();
      toast(o.end && o.end < D.start ? 'Attention : ordonnance terminée le ' + dateCourt(o.end) : 'Soins de l’ordonnance appliqués');
    };
    $('#a-photo').onclick = () => { syncDraft(); nPh ? draftPhotosSheet() : addDraftPhoto(); };
  }
  function addDraftPhoto() {
    pickImage(async f => {
      try { const b = await compressImage(f, 1400, 0.72); UI.draft.newPhotos.push({ tmp: uid(), blob: b, url: URL.createObjectURL(b) }); drawTools(); toast('Photo ajoutée'); }
      catch (e) { toast('Photo illisible'); }
    });
  }
  function draftPhotosSheet() {
    const D = UI.draft;
    const thumbs = D.photoIds.map(id => '<div style="position:relative"><img data-pid="' + id + '" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#dde7ee;display:block"><button class="icon-btn" data-rmo="' + id + '" aria-label="Retirer" style="position:absolute;top:4px;right:4px;width:34px;height:34px;background:rgba(255,255,255,.9)">✕</button></div>').join('') +
      D.newPhotos.map(x => '<div style="position:relative"><img src="' + x.url + '" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;display:block"><button class="icon-btn" data-rmn="' + x.tmp + '" aria-label="Retirer" style="position:absolute;top:4px;right:4px;width:34px;height:34px;background:rgba(255,255,255,.9)">✕</button></div>').join('');
    sheet('<h2>Photos du soin</h2><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">' + thumbs + '</div><div class="btns"><button class="btn ghost" data-close>Fermer</button><button class="btn accent" id="dp-add">📷 Ajouter</button></div>',
      (m, close) => {
        fillThumbs(m);
        $('#dp-add', m).onclick = () => { close(); addDraftPhoto(); };
        $$('[data-rmo]', m).forEach(b => b.onclick = () => { D.photoIds = D.photoIds.filter(x => x !== b.dataset.rmo); (D.removedPhotos = D.removedPhotos || []).push(b.dataset.rmo); close(); drawTools(); });
        $$('[data-rmn]', m).forEach(b => b.onclick = () => { D.newPhotos = D.newPhotos.filter(x => x.tmp !== b.dataset.rmn); close(); drawTools(); });
      });
  }
  async function commitDraftPhotos(pid, date) {
    const D = UI.draft; const ids = D.photoIds.slice();
    for (const x of D.newPhotos) { const id = uid(); try { await IDB.put({ id, patientId: pid, date, kind: 'soin', blob: x.blob }); ids.push(id); } catch (e) { toast('Photo non enregistrée (mémoire pleine ?)'); } }
    if (D.removedPhotos) await delPhotos(D.removedPhotos);
    D.newPhotos = []; return ids;
  }
  function syncDraft() {
    const D = UI.draft;
    D.cabinetId = $('#a-cab').value; D.texte = $('#a-txt').value; D.patientName = $('#a-pat').value;
    D.heure = $('#a-h').value; D.start = $('#a-start').value || today();
    const e = $('#a-end'); D.end = e ? e.value : '';
    const d = $('#a-dim'); if (d) D.dimanche = d.checked;
    const np = $('#np-bsi'); if (np) D.newP.bsi = np.value;
  }
  function bindAjout() {
    const D = UI.draft;
    $('#a-cab').onchange = () => { syncDraft(); UI.lastCab = D.cabinetId; const p = D.patientId && pat(D.patientId); if (p && p.cabinetId !== D.cabinetId) { D.patientId = null; } drawSugg(); drawPreview(); };
    $('#a-local').onclick = () => {
      syncDraft();
      if (!D.texte.trim()) return toast('Tape ou dicte d’abord les soins');
      const r = parseLocal(D.texte); mergeActs(r.acts); D.unknown = r.unknown; D.texte = ''; drawAjout();
      if (!r.acts.length) toast('Rien reconnu, utilise « + Ajouter »');
    };
    const ai = $('#a-ai');
    if (ai) ai.onclick = async () => {
      syncDraft();
      if (!D.texte.trim()) return toast('Tape ou dicte d’abord les soins');
      if (!navigator.onLine) { const r = parseLocal(D.texte); mergeActs(r.acts); D.unknown = r.unknown; D.texte = ''; drawAjout(); return toast('Pas de réseau : reconnaissance locale utilisée'); }
      ai.disabled = true; ai.textContent = '…';
      try { const r = await parseAI(D.texte); mergeActs(r.acts); D.unknown = r.unknown; D.texte = ''; drawAjout(); toast('Vérifie les actes proposés'); }
      catch (e) { const r = parseLocal(D.texte); mergeActs(r.acts); D.unknown = r.unknown; D.texte = ''; drawAjout(); toast('IA indisponible, reconnaissance locale utilisée'); console.warn(e); }
    };
    $$('[data-minus]').forEach(b => b.onclick = () => { syncDraft(); const i = +b.dataset.minus; D.acts[i].qty--; if (D.acts[i].qty <= 0) D.acts.splice(i, 1); drawAjout(); });
    $$('[data-plus]').forEach(b => b.onclick = () => { syncDraft(); const i = +b.dataset.plus; D.acts[i].qty = Math.min(9, D.acts[i].qty + 1); drawAjout(); });
    $('#a-addact').onclick = () => { syncDraft(); pickAct(); };
    $('#a-pat').oninput = () => { D.patientName = $('#a-pat').value; const had = D.patientId; D.patientId = null; drawSugg(); if (had && !D.patientId) drawTools(); drawPreview(); };
    $('#a-rep').onclick = () => { syncDraft(); if (D.rec.type === 'once') { D.rec.type = 'daily'; D.dimanche = true; } else { D.rec.type = 'once'; D.end = ''; D.dimanche = E.isDimancheOuFerie(D.start); } drawAjout(); };
    $$('[data-rec]').forEach(b => b.onclick = () => { syncDraft(); D.rec.type = b.dataset.rec; if (b.dataset.rec === 'weekdays' && !(D.rec.days || []).length) D.rec.days = [1, 2, 3, 4, 5]; drawAjout(); });
    $$('[data-day]').forEach(b => b.onclick = () => { syncDraft(); const d = +b.dataset.day; D.rec.days = (D.rec.days || []).includes(d) ? D.rec.days.filter(x => x !== d) : (D.rec.days || []).concat(d); drawAjout(); });
    $('#a-start').onchange = () => { syncDraft(); if (D.rec.type === 'once') { D.dimanche = E.isDimancheOuFerie(D.start); drawAjout(); } else drawPreview(); };
    ['#a-h', '#a-dim', '#a-end'].forEach(s => { const el = $(s); if (el) el.onchange = () => { syncDraft(); drawPreview(); }; });
    $('#a-save').onclick = saveSoin;
    const ab = $('#a-abs'); if (ab) ab.onclick = () => {
      syncDraft();
      if (!D.patientName.trim()) return toast('Indique d’abord le patient');
      absentSheet(D.patientName.trim(), facture => {
        const pid = ensureDraftPatient();
        setAbsence(pid, D.start, facture);
        if (facture && D.acts.length) saveSoin(true); else afterSave(pid, D.start, facture ? 'Absent noté (facturé)' : 'Absent noté (non facturé)');
      });
    };
  }
  function mergeActs(list) {
    const D = UI.draft;
    list.forEach(a => { const ex = D.acts.find(x => x.id === a.id && a.id !== 'manuel'); if (ex) ex.qty = Math.min(9, ex.qty + a.qty); else D.acts.push({ id: a.id, qty: a.qty }); });
  }
  function pickAct() {
    const groups = {};
    Object.entries(E.ACTS).forEach(([k, v]) => { (groups[v.g] = groups[v.g] || []).push([k, v]); });
    let h = '<h2>Ajouter un acte</h2>';
    Object.entries(groups).forEach(([g, items]) => {
      h += '<div class="section">' + esc(g) + '</div><div class="list">';
      items.forEach(([k, v]) => h += '<button class="item" data-pick="' + k + '"><span class="t" style="font-weight:600">' + esc(v.l) + '</span><span class="s">' + (v.manuel ? 'coef. libre' : v.dependance ? 'forfait' : (v.di ? 'DI ' : 'AMI ') + E.fmtCoef(v.c)) + '</span></button>');
      h += '</div>';
    });
    h += '<button class="btn" data-close>Fermer</button>';
    sheet(h, (m, close) => $$('[data-pick]', m).forEach(b => b.onclick = () => {
      const id = b.dataset.pick;
      if (id === 'manuel') { close(); return manualAct(); }
      mergeActs([{ id, qty: 1 }]); close(); drawAjout();
    }));
  }
  function manualAct() {
    sheet('<h2>Acte manuel</h2><p class="note">Pour un cas particulier : tu choisis toi-même le coefficient et le taux.</p>' +
      '<label class="f" for="ma-l">Nom de l’acte</label><input class="in" id="ma-l" placeholder="ex : Soin de bouche">' +
      '<label class="f" for="ma-c">Coefficient AMI</label><input class="in" id="ma-c" type="number" inputmode="decimal" step="0.01" value="1">' +
      '<label class="f" for="ma-t">Taux</label><select class="in" id="ma-t"><option value="">Selon l’article 11B</option><option value="1">Toujours à taux plein</option><option value="0.5">Toujours à 50 %</option></select>' +
      '<div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="ma-ok">Ajouter</button></div>',
      (m, close) => $('#ma-ok', m).onclick = () => {
        const coef = parseFloat(String($('#ma-c', m).value).replace(',', '.')); if (!(coef > 0)) return toast('Coefficient invalide');
        const a = { id: 'manuel', qty: 1, coef, label: $('#ma-l', m).value.trim() || 'Acte manuel' };
        const t = $('#ma-t', m).value; if (t) a.taux = parseFloat(t);
        UI.draft.acts.push(a); close(); drawAjout();
      });
  }
  function drawSugg() {
    const D = UI.draft; const box = $('#a-sugg'); const np = $('#a-newp');
    const qv = norm(D.patientName).trim();
    const list = S.patients.filter(p => p.cabinetId === D.cabinetId && (!qv || norm(p.nom).includes(qv)));
    const exact = S.patients.find(p => p.cabinetId === D.cabinetId && norm(p.nom) === qv);
    if (exact && D.patientId !== exact.id) { D.patientId = exact.id; setTimeout(drawTools, 0); }
    box.innerHTML = (!D.patientId && qv && list.length) ? '<div class="sugg">' + list.slice(0, 5).map(p => '<button data-sp="' + p.id + '">' + esc(p.nom) + '<span class="note"> — ' + esc(badges(p)) + '</span></button>').join('') + '</div>' : '';
    $$('[data-sp]', box).forEach(b => b.onclick = () => { syncDraft(); const p = pat(b.dataset.sp); D.patientId = p.id; D.patientName = p.nom; $('#a-pat').value = p.nom; drawSugg(); drawTools(); drawPreview(); });
    if (!D.patientId && qv) {
      np.innerHTML = '<div class="newp"><span class="note" style="flex:1"><b>Nouveau patient</b></span><select class="in sm" id="np-bsi" aria-label="Forfait dépendance" style="width:auto;min-height:40px">' +
        ['', 'BSA', 'BSB', 'BSC'].map(x => '<option value="' + x + '"' + ((D.newP.bsi || '') === x ? ' selected' : '') + '>' + (x || 'Sans BSI') + '</option>').join('') + '</select>' +
        '<button class="back" id="np-more" style="min-height:40px">Fiche ›</button></div>';
      $('#np-bsi', np).onchange = () => { syncDraft(); drawPreview(); };
      $('#np-more', np).onclick = () => { syncDraft(); newPatientSheet(D.newP, D.patientName.trim(), () => { drawSugg(); drawPreview(); }); };
    } else if (D.patientId) {
      const p = pat(D.patientId);
      np.innerHTML = '<p class="note" style="margin:4px 4px 0;font-size:13px">' + badges(p) + (p.adresse ? ' · ' + esc(p.adresse) : '') + '</p>';
    } else np.innerHTML = '';
  }
  function newPatientSheet(target, nom, done) {
    sheet('<h2>' + esc(nom || 'Nouveau patient') + '</h2>' + coordFields(target, 'nps-') + patientFields(target, 'nps-') +
      '<div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="nps-ok">Valider</button></div>',
      (m, close) => $('#nps-ok', m).onclick = () => { Object.assign(target, readPatientFields(m, 'nps-'), readCoord(m, 'nps-')); close(); done && done(); });
  }
  function draftPatient() {
    const D = UI.draft;
    if (D.patientId) return pat(D.patientId);
    return Object.assign({ id: '__new', nom: D.patientName, cabinetId: D.cabinetId }, D.newP);
  }
  function drawPreview() {
    const D = UI.draft; const box = $('#a-cot'); if (!box) return;
    if (!D.acts.length) { box.innerHTML = ''; return; }
    const p = draftPatient();
    const tmp = { id: '__draft', patientId: p.id, heure: D.heure || '08:00', acts: D.acts, rec: D.rec, start: D.start || today(), end: D.end, dimanche: D.dimanche };
    const others = S.soins.filter(s => s.patientId === p.id && s.id !== D.id);
    // premier jour où le soin a lieu
    let day = tmp.start; for (let i = 0; i < 14 && !E.occursOn(tmp, day); i++) day = E.addDays(day, 1);
    const pass = E.coteJour(p, others.concat([tmp]), day, copts()).filter(ps => ps.heure === tmp.heure);
    const withOthers = others.some(s => E.occursOn(s, day) && (s.heure || '08:00') === tmp.heure);
    const lines = pass.flatMap(ps => ps.lines).filter(l => l.montant > 0);
    const summary = lines.map(l => l.label.replace(/^1 /, '').replace(/ 1 Entier$| Entier$/, '').replace(/ Demi$/, '/2').replace(/ \(\d+ % du forfait\)/, '').replace(/^Majoration dimanche\/férié$/, 'Dim.')).join(' + ');
    const total = pass.reduce((a, ps) => a + ps.total, 0);
    let html = D.showDetail ? cotationBox(pass, 'Cotation — ' + dateFr(day) + (withOthers ? ' (avec les autres soins de ce passage)' : ''))
      : '<button class="cotline" id="a-cotline"><span>' + esc(summary) + (withOthers ? ' <span class="note">(+ autres soins)</span>' : '') + '</span><b>' + eur(total) + '</b></button>';
    if (D.showDetail) html = '<div id="a-cotline" style="cursor:pointer">' + html + '</div>';
    if (D.acts.some(a => a.id === 'dependance') && !p.bsi && !D.acts.some(a => E.ACTS[a.id] && E.ACTS[a.id].niveau)) html += '<div class="unknown">Niveau de dépendance inconnu : tape BSA, BSB ou BSC, ou choisis le niveau dans la fiche du patient.</div>';
    box.innerHTML = html;
    const cl = $('#a-cotline'); if (cl) cl.onclick = () => { D.showDetail = !D.showDetail; drawPreview(); };
  }
  function ensureDraftPatient() {
    const D = UI.draft;
    if (D.patientId) return D.patientId;
    const np = Object.assign({ id: uid(), nom: D.patientName.trim(), cabinetId: D.cabinetId }, D.newP);
    S.patients.push(np); D.patientId = np.id; if (np.adresse) UI.mapsPrompt = np.id;
    return np.id;
  }
  function absentSheet(nom, cb) {
    sheet('<h2>' + esc(nom) + ' absent</h2><p class="note">C’est la titulaire qui décide. Ton choix ne sert qu’à estimer tes revenus, il n’apparaît pas dans le bilan.</p>' +
      '<div class="btns"><button class="btn ghost" id="ab-non">Sans facturation</button><button class="btn accent" id="ab-oui">Avec facturation</button></div><button class="btn" data-close>Annuler</button>',
      (m, close) => { $('#ab-oui', m).onclick = () => { close(); cb(true); }; $('#ab-non', m).onclick = () => { close(); cb(false); }; });
  }
  function setAbsence(pid, date, facture) {
    S.absences = (S.absences || []).filter(a => !(a.patientId === pid && a.date === date));
    S.absences.push({ id: uid(), patientId: pid, date, facture: !!facture });
    save();
  }
  function afterSave(pid, date, msg) {
    const D = UI.draft; const p = pat(pid);
    UI.lastCab = D.cabinetId; save();
    if (D.back === 'tournee') { UI.soinsVue = 'jour'; UI.soinsDate = date; toast(msg); location.hash = '#soins'; return; }
    toast(msg + ' — patient suivant ?');
    viewAjout({ date, cabinet: D.cabinetId });
    if (UI.mapsPrompt === pid && p && p.adresse) { UI.mapsPrompt = null; mapsSheet(p); }
  }
  async function saveSoin(fromAbsent) {
    if (UI.saving) return;
    UI.saving = true; setTimeout(() => { UI.saving = false; }, 1500);
    if (fromAbsent !== true) syncDraft();
    const D = UI.draft;
    if (!D.acts.length) return toast('Ajoute au moins un acte');
    if (!D.patientName.trim()) return toast('Indique le patient');
    if (D.rec.type === 'weekdays' && !(D.rec.days || []).length) return toast('Choisis au moins un jour');
    if (D.end && D.end < D.start) return toast('La date de fin est avant le début');
    const pid = ensureDraftPatient();
    const lvAct = D.acts.map(a => E.ACTS[a.id] && E.ACTS[a.id].niveau).filter(Boolean).sort().pop();
    if (lvAct && !pat(pid).bsi) pat(pid).bsi = lvAct;
    const data = { patientId: pid, heure: D.heure || nowHM(), acts: D.acts, rec: D.rec, start: D.start || today(), end: D.rec.type === 'once' ? '' : (D.end || ''), dimanche: D.dimanche, nuit: false };
    data.photos = await commitDraftPhotos(pid, data.start);
    if (D.id) { Object.assign(S.soins.find(s => s.id === D.id), data); save(); toast('Soin modifié'); location.hash = '#patient/' + pid; return; }
    S.soins.push(Object.assign({ id: uid() }, data));
    afterSave(pid, data.start, fromAbsent === true ? 'Absent noté (facturé)' : 'Enregistré pour ' + pat(pid).nom);
  }


  // ----- Détail du mois (PDF) -----
  function viewDetail(q) {
    const cabId = q.cabinet || '';
    const cabs = cabId ? S.cabinets.filter(c => c.id === cabId) : S.cabinets;
    const d = monthData(UI.month);
    let h = '<div class="noprint">' + backTop('#mois', 'Mois') + monthNav() +
      '<select class="in" id="dt-cab" style="margin-bottom:12px"><option value="">Tous les cabinets</option>' + S.cabinets.map(c => '<option value="' + c.id + '"' + (c.id === cabId ? ' selected' : '') + '>' + esc(c.nom) + '</option>').join('') + '</select>' +
      '<button class="btn accent" id="dt-print" style="margin-bottom:14px">Exporter en PDF</button></div>';
    h += '<div class="print-only" style="margin-bottom:10px"><div style="display:flex;align-items:center;gap:10px"><img src="icon-180.png" alt="" style="width:40px;height:40px;border-radius:9px"><div><b style="font-size:18px">Soeuringue — détail de ' + monthLabel(UI.month) + '</b><div class="note">Estimation calculée selon la NGAP, édité le ' + dateCourt(today()) + '</div></div></div></div>';
    cabs.forEach(c => {
      const b = d.byCab[c.id];
      const rows = d.passages.filter(ps => { const p = pat(ps.patientId); return p && p.cabinetId === c.id; })
        .sort((a, b2) => a.date.localeCompare(b2.date) || a.heure.localeCompare(b2.heure) || pat(a.patientId).nom.localeCompare(pat(b2.patientId).nom));
      h += '<h2 style="font-size:19px;margin:16px 0 8px">' + esc(c.nom) + '</h2>';
      h += '<div class="card grid3"><div>Facturé<b>' + eur(b.facture) + '</b></div><div>Ta part (' + (100 - (c.retro || 0)) + ' %)<b>' + eur(b.part) + '</b></div><div>Reçu<b>' + eur(b.recu) + '</b></div></div>';
      if (b.recu + 0.5 < b.part) h += '<p class="note" style="color:var(--warn);font-weight:700;margin:0 4px 10px">Écart : il manque ' + eur(b.part - b.recu) + '</p>';
      if (!rows.length) { h += '<p class="note">Aucun soin ce mois-ci.</p>'; return; }
      h += '<div class="tablewrap"><table class="det"><thead><tr><th>Date</th><th>Heure</th><th>Patient</th><th>Acte</th><th class="m">Montant</th></tr></thead><tbody>';
      rows.forEach(ps => {
        const nm = esc(pat(ps.patientId).nom);
        ps.lines.forEach((l, i) => {
          h += '<tr><td>' + (i === 0 ? dateCourt(ps.date) : '') + '</td><td>' + (i === 0 ? ps.heure : '') + '</td><td>' + (i === 0 ? nm : '') + '</td><td>' + esc(l.label) + '<div class="note" style="font-size:11px">' + esc(l.detail) + '</div></td><td class="m">' + eur(l.montant) + '</td></tr>';
        });
        h += '<tr><td colspan="4" style="text-align:right;color:var(--muted);font-size:12px">Total du passage</td><td class="m"><b>' + eur(ps.total) + '</b></td></tr>';
      });
      h += '</tbody></table></div>';
    });
    h += '<p class="note">Estimation à partir des soins saisis. Elle ne remplace pas la facturation des titulaires.</p>';
    app.innerHTML = h; bindMonthNav();
    $('#dt-cab').onchange = e => { location.hash = '#detail' + (e.target.value ? '?cabinet=' + e.target.value : ''); };
    $('#dt-print').onclick = () => window.print();
  }

  // ----- Mes soins : tournée du jour, revenus par soin, bilan -----
  function nomNote(p) {
    if (p.nomNote) return p.nomNote;
    let w = String(p.nom || '').replace(/^(m\.|mr\.?|mme\.?|mlle\.?|monsieur|madame|mademoiselle)\s+/i, '').trim().split(/\s+/).filter(Boolean);
    const caps = w.filter(x => x.length > 1 && x === x.toUpperCase() && /[A-ZÀ-Ý]/.test(x));
    const nom = caps.length ? caps.join(' ') : (w[w.length - 1] || p.nom || '');
    return nom === nom.toUpperCase() ? nom.toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase()) : nom;
  }
  function statut(pid, date) {
    const absent = (S.absences || []).find(a => a.patientId === pid && a.date === date);
    const notes = S.soins.filter(s => s.patientId === pid && (s.rec || {}).type === 'once' && s.start === date && (s.acts || []).length);
    const fait = (S.faits || []).some(f => f.patientId === pid && f.date === date);
    const prevu = S.soins.some(s => s.patientId === pid && (s.rec || {}).type !== 'once' && E.occursOn(s, date));
    return { absent, notes, fait, prevu, done: notes.length > 0 || fait };
  }
  function periodDays() {
    const d = UI.soinsDate;
    if (UI.soinsVue === 'jour') return [d];
    if (UI.soinsVue === 'mois') return E.monthDays(d.slice(0, 7));
    const st = weekStartOf(d);
    return [0, 1, 2, 3, 4, 5, 6].map(i => E.addDays(st, i));
  }
  function periodLabel(days) {
    if (UI.soinsVue === 'jour') { const t = dateFr(days[0]); return t.charAt(0).toUpperCase() + t.slice(1); }
    if (UI.soinsVue === 'mois') { const t = monthLabel(days[0].slice(0, 7)); return t.charAt(0).toUpperCase() + t.slice(1); }
    return 'Du ' + dateCourt(days[0]).slice(0, 5) + ' au ' + dateCourt(days[6]).slice(0, 5);
  }
  const MAJ = { IFD: 'Déplacements (IFD)', IFI: 'Déplacements BSI (IFI)', IK: 'Indemnités kilométriques', MCI: 'MCI', MAU: 'MAU', DIM: 'Majoration dimanche / férié', MIE: 'MIE', NUIT: 'Majoration de nuit' };
  function viewSoins() {
    const days = periodDays();
    const passages = E.coteJours(S, days);
    const retro = pid => { const p = pat(pid); const c = p && cab(p.cabinetId); return ((c && c.retro) || 0) / 100; };
    let fact = 0, part = 0; const actes = {}, majs = {}, forf = {};
    passages.forEach(ps => {
      fact += ps.total; part += ps.total * (1 - retro(ps.patientId));
      ps.lines.forEach(l => {
        if (!(l.montant > 0)) return;
        if (MAJ[l.code]) { const k = MAJ[l.code]; (majs[k] = majs[k] || { n: 0, m: 0 }); majs[k].n++; majs[k].m += l.montant; }
        else if (/^BS[ABC]$/.test(l.code)) { const k = 'Forfait ' + l.code; (forf[k] = forf[k] || { set: new Set(), m: 0 }); forf[k].set.add(ps.patientId + ps.date); forf[k].m += l.montant; }
        else { const k = l.detail || l.label; (actes[k] = actes[k] || { n: 0, m: 0 }); actes[k].n++; actes[k].m += l.montant; }
      });
    });
    let h = brandTop('Mes soins');
    h += '<div class="chips noprint" style="margin-bottom:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr))">' + [['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois']].map(([k, l]) => '<button class="chip' + (UI.soinsVue === k ? ' on' : '') + '" data-vue="' + k + '" aria-pressed="' + (UI.soinsVue === k) + '">' + l + '</button>').join('') + '</div>';
    h += '<div class="rowx" style="margin-bottom:12px"><button class="icon-btn" id="s-prev" aria-label="Période précédente" style="background:#fff">‹</button><button class="back" id="s-date" style="font-size:17px;color:var(--ink)">' + esc(periodLabel(days)) + '</button><button class="icon-btn" id="s-next" aria-label="Période suivante" style="background:#fff">›</button></div>';
    h += '<input type="date" id="s-pick" value="' + UI.soinsDate + '" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" tabindex="-1" aria-hidden="true">';
    // tournée du jour
    if (UI.soinsVue === 'jour') {
      const d = UI.soinsDate; const ordre = (S.tournees || {})[d] || [];
      h += '<div class="section" style="margin-top:4px">Tournée du jour</div>';
      if (!ordre.length) h += '<button class="btn accent" id="t-create">Créer la tournée du jour</button>';
      else {
        h += '<div class="list">';
        ordre.forEach((pid, i) => {
          const p = pat(pid); if (!p) return;
          const st = statut(pid, d);
          const pill = st.absent ? '<span class="pill warn">❌ absent' + (st.absent.facture ? ' · facturé' : '') + '</span>' : st.done ? '<span class="pill ok">✅ fait</span>' : st.prevu ? '<span class="pill info">prévu</span>' : '<span class="pill" style="background:#EEF1F4;color:var(--muted)">à faire</span>';
          h += '<div class="item" style="display:block;cursor:default;padding:10px 12px 10px 14px"><div class="rowx" style="align-items:flex-start"><a href="#patient/' + pid + '" style="text-decoration:none;color:inherit;flex:1;min-width:0"><div class="t"><span style="color:var(--accent)">' + (i + 1) + '.</span> ' + esc(p.nom) + '</div>' +
            '<div class="s">' + esc([p.adresse, p.code ? 'code ' + p.code : '', p.etage ? 'ét. ' + p.etage : ''].filter(Boolean).join(' · ')) + '</div>' +
            (st.notes.length ? '<div class="s" style="color:var(--ink)">' + esc(st.notes.map(s => actsText(s.acts)).join(' · ')) + '</div>' : '') + trLines(pid, d) + '</a>' + pill + '</div>' +
            '<div style="display:flex;gap:8px;margin-top:8px">' +
            '<a class="chip" style="display:inline-flex;align-items:center;text-decoration:none;min-height:40px;font-size:14px" href="#ajout?patient=' + pid + '&date=' + d + '&back=tournee">+ Soins</a>' +
            (st.prevu && !st.done && !st.absent ? '<button class="chip" data-fait="' + pid + '" style="min-height:40px;font-size:14px">Fait</button>' : '') +
            (st.absent ? '<button class="chip" data-unabs="' + pid + '" style="min-height:40px;font-size:14px">Annuler l’absence</button>' : '<button class="chip" data-abs="' + pid + '" style="min-height:40px;font-size:14px">Absent</button>') +
            '</div></div>';
        });
        h += '</div><div class="btns"><button class="btn ghost" id="t-edit">Modifier la tournée</button><button class="btn accent" id="t-bilan">Bilan pour la note</button></div>';
      }
    }
    // totaux
    h += '<div class="hero" style="margin-top:14px;padding:16px 18px"><div class="lbl">Ta part ' + (UI.soinsVue === 'jour' ? 'du jour' : UI.soinsVue === 'semaine' ? 'de la semaine' : 'du mois') + '</div><div class="big" style="font-size:34px">' + eur(part) + '</div><div class="sub">' + eur(fact) + ' facturés · ' + passages.length + ' passage' + (passages.length > 1 ? 's' : '') + '</div></div>';
    // revenu par soin
    const rows = (obj, cnt) => Object.entries(obj).sort((a, b) => b[1].m - a[1].m).map(([k, v]) => '<div class="line" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>' + esc(k) + ' <span class="note">× ' + cnt(v) + '</span></span><b>' + eur(v.m) + '</b></div>').join('');
    if (passages.length) {
      h += '<div class="section">Revenu par soin (facturé)</div><div class="card" style="padding:6px 16px">' + rows(forf, v => v.set.size) + rows(actes, v => v.n) + '</div>';
      if (Object.keys(majs).length) h += '<div class="section">Déplacements et majorations</div><div class="card" style="padding:6px 16px">' + rows(majs, v => v.n) + '</div>';
      h += '<div class="section">Passages</div><div class="list">';
      passages.slice().sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure)).forEach(ps => {
        const p = pat(ps.patientId);
        h += '<a class="item" href="#patient/' + ps.patientId + '"><div><div class="t">' + (UI.soinsVue !== 'jour' ? esc(dateCourt(ps.date).slice(0, 5)) + ' · ' : '') + esc(p ? p.nom : '?') + (ps.absent ? ' <span class="pill warn" style="font-size:11px">absent</span>' : '') + '</div><div class="s">' + esc(ps.lines.filter(l => l.montant > 0 && !MAJ[l.code]).map(l => l.detail || l.label).join(' · ')) + '</div></div><span class="v">' + eur(ps.total) + '</span></a>';
      });
      h += '</div>';
    } else h += '<p class="note">Aucun soin noté sur cette période.</p>';
    h += '<div class="btns"><a class="btn" href="#ajout?date=' + UI.soinsDate + '">+ Noter un passage</a></div>';
    app.innerHTML = h;
    $$('[data-vue]').forEach(b => b.onclick = () => { UI.soinsVue = b.dataset.vue; route(); });
    const step = n => { UI.soinsDate = UI.soinsVue === 'mois' ? shiftMonth(UI.soinsDate.slice(0, 7), n) + '-01' : E.addDays(UI.soinsDate, n * (UI.soinsVue === 'semaine' ? 7 : 1)); route(); };
    $('#s-prev').onclick = () => step(-1); $('#s-next').onclick = () => step(1);
    $('#s-date').onclick = () => { const pk = $('#s-pick'); if (pk.showPicker) { try { pk.showPicker(); return; } catch (e) {} } UI.soinsDate = today(); route(); };
    $('#s-pick').onchange = e => { if (e.target.value) { UI.soinsDate = e.target.value; route(); } };
    const tc = $('#t-create'); if (tc) tc.onclick = () => editTournee(UI.soinsDate);
    const te = $('#t-edit'); if (te) te.onclick = () => editTournee(UI.soinsDate);
    const tb = $('#t-bilan'); if (tb) tb.onclick = () => bilanSheet(UI.soinsDate);
    $$('[data-fait]').forEach(b => b.onclick = () => { S.faits = (S.faits || []).concat({ patientId: b.dataset.fait, date: UI.soinsDate }); save(); route(); });
    $$('[data-abs]').forEach(b => b.onclick = () => absentSheet(pat(b.dataset.abs).nom, f => { setAbsence(b.dataset.abs, UI.soinsDate, f); toast('Absent noté'); route(); }));
    $$('[data-unabs]').forEach(b => b.onclick = () => { S.absences = S.absences.filter(a => !(a.patientId === b.dataset.unabs && a.date === UI.soinsDate)); save(); route(); });
  }
  function editTournee(date) {
    let ordre = ((S.tournees || {})[date] || []).filter(id => pat(id));
    let q = '';
    let selCab = S.cabinets.length === 1 ? S.cabinets[0].id : null;
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" style="max-height:92vh"></div>';
    document.body.appendChild(m);
    const sh = $('.sheet', m);
    const close = () => m.remove();
    const draw = () => {
      let h = '<h2>Tournée du ' + esc(dateFr(date)) + '</h2><p class="note">Choisis le cabinet, puis touche les patients dans l’ordre où tu vas les voir.</p>';
      h += '<div class="section">Ordre de passage (' + ordre.length + ')</div>';
      h += ordre.length ? '<div class="list">' + ordre.map((id, i) => '<div class="item" style="cursor:default;padding:6px 6px 6px 14px;min-height:48px"><span style="flex:1"><b style="color:var(--accent)">' + (i + 1) + '.</b> ' + esc(pat(id).nom) + '</span><span style="display:flex;gap:4px"><button class="icon-btn" data-up="' + i + '" aria-label="Monter"' + (i ? '' : ' disabled') + '>↑</button><button class="icon-btn" data-down="' + i + '" aria-label="Descendre"' + (i < ordre.length - 1 ? '' : ' disabled') + '>↓</button><button class="icon-btn" data-rm="' + i + '" aria-label="Retirer">✕</button></span></div>').join('') + '</div>' : '<p class="note">Aucun patient pour l’instant.</p>';
      if (!selCab) {
        h += '<div class="section">Choisis le cabinet</div><div class="list">' + S.cabinets.map(cb => {
          const n = S.patients.filter(p => p.cabinetId === cb.id && !ordre.includes(p.id)).length;
          return '<button class="item" data-cab="' + cb.id + '" style="min-height:52px"><div><div class="t">' + esc(cb.nom) + '</div><div class="s">' + n + ' patient' + (n > 1 ? 's' : '') + ' à ajouter</div></div><span style="font-size:20px;color:var(--accent)">›</span></button>';
        }).join('') + '</div>';
      } else {
        const cb = cab(selCab);
        h += '<div class="rowx" style="margin:16px 4px 8px">' + (S.cabinets.length > 1 ? '<button class="back" id="t-cabs" style="min-height:36px">‹ Cabinets</button>' : '<span></span>') + '<b>' + esc(cb.nom) + '</b></div>';
        h += '<input class="in" id="tq" placeholder="Rechercher dans ce cabinet" autocomplete="off" value="' + esc(q) + '" style="margin-bottom:8px">';
        const pts = S.patients.filter(p => p.cabinetId === selCab && !ordre.includes(p.id) && (!q || norm(p.nom).includes(norm(q)) || norm(p.adresse).includes(norm(q)))).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
        h += pts.length ? '<div class="list">' + pts.map(p => '<button class="item" data-add="' + p.id + '" style="min-height:48px;padding:8px 14px"><span><span class="t" style="font-weight:600">' + esc(p.nom) + '</span>' + (statut(p.id, date).prevu ? ' <span class="pill info" style="font-size:11px">prévu</span>' : '') + '</span><span style="font-size:22px;color:var(--accent)">+</span></button>').join('') + '</div>' : '<p class="note">' + (q ? 'Aucun patient trouvé.' : 'Tous les patients de ce cabinet sont dans la tournée.') + '</p>';
      }
      h += '<div class="btns" style="position:sticky;bottom:0;background:var(--bg);padding-top:8px;margin-bottom:0"><button class="btn ghost" id="t-cancel">Annuler</button><button class="btn accent" id="t-ok">Valider</button></div>';
      sh.innerHTML = h;
      $$('[data-add]', sh).forEach(b => b.onclick = () => { ordre.push(b.dataset.add); const st = sh.scrollTop; draw(); sh.scrollTop = st; });
      $$('[data-rm]', sh).forEach(b => b.onclick = () => { ordre.splice(+b.dataset.rm, 1); draw(); });
      $$('[data-up]', sh).forEach(b => b.onclick = () => { const i = +b.dataset.up; [ordre[i - 1], ordre[i]] = [ordre[i], ordre[i - 1]]; draw(); });
      $$('[data-down]', sh).forEach(b => b.onclick = () => { const i = +b.dataset.down; [ordre[i + 1], ordre[i]] = [ordre[i], ordre[i + 1]]; draw(); });
      $$('[data-cab]', sh).forEach(b => b.onclick = () => { selCab = b.dataset.cab; q = ''; draw(); });
      const tc = $('#t-cabs', sh); if (tc) tc.onclick = () => { selCab = null; q = ''; draw(); };
      const tq = $('#tq', sh); if (tq) tq.oninput = () => { q = tq.value; const pos = tq.selectionStart; draw(); const n = $('#tq', sh); n.focus(); n.setSelectionRange(pos, pos); };
      $('#t-cancel', sh).onclick = close;
      $('#t-ok', sh).onclick = () => { S.tournees = S.tournees || {}; if (ordre.length) S.tournees[date] = ordre; else delete S.tournees[date]; save(); close(); route(); };
    };
    draw();
  }
  function bilanText(date) {
    let ordre = ((S.tournees || {})[date] || []).filter(id => pat(id));
    // patients vus ou absents ce jour-là sans être dans la tournée : ajoutés à la fin
    S.patients.forEach(p => { const st = statut(p.id, date); if ((st.done || st.absent) && !ordre.includes(p.id)) ordre.push(p.id); });
    const groups = [];
    ordre.forEach(id => { const p = pat(id); let g = groups.find(x => x.cab === p.cabinetId); if (!g) groups.push(g = { cab: p.cabinetId, ids: [] }); g.ids.push(id); });
    const dd = date.slice(8, 10) + '/' + date.slice(5, 7);
    let pending = 0;
    const txt = groups.map(g => {
      const c = cab(g.cab); const titre = (c ? c.nom : '').replace(/^cabinet\s+/i, '');
      return titre + ' ' + dd + '\n\n' + g.ids.map(id => { const st = statut(id, date); if (!st.absent && !st.done) pending++; return nomNote(pat(id)) + ' : ' + (st.absent ? '❌' : st.done ? '✅' : ''); }).join('\n');
    }).join('\n\n\n');
    return { txt, pending };
  }
  function bilanSheet(date) {
    const { txt, pending } = bilanText(date);
    sheet('<h2>Bilan pour la note</h2>' + (pending ? '<div class="unknown">' + pending + ' patient(s) sans statut : leur ligne reste vide.</div>' : '') +
      '<textarea class="in" id="bl-txt" style="min-height:240px;font-size:16px;line-height:1.5" readonly>' + esc(txt) + '</textarea>' +
      '<div class="btns"><button class="btn ghost" id="bl-share">Partager</button><button class="btn accent" id="bl-copy">Copier</button></div><button class="btn" data-close>Fermer</button>',
      (m, close) => {
        $('#bl-copy', m).onclick = async () => {
          try { await navigator.clipboard.writeText(txt); toast('Copié : colle-le dans la note'); close(); }
          catch (e) { const t = $('#bl-txt', m); t.removeAttribute('readonly'); t.select(); document.execCommand('copy'); toast('Copié'); }
        };
        $('#bl-share', m).onclick = async () => { if (navigator.share) { try { await navigator.share({ text: txt }); } catch (e) {} } else toast('Partage indisponible ici, utilise Copier'); };
      });
  }

  // ----- Transmissions (semaine du mardi au lundi) -----
  function weekStartOf(date) { const off = (E.parseIso(date).getDay() - 2 + 7) % 7; return E.addDays(date, -off); }
  function trGet(week, mode, pid) { const w = (S.transmissions || {})[week]; return w && w[mode] && w[mode][pid]; }
  function trSet(week, mode, pid, val) {
    S.transmissions = S.transmissions || {};
    const w = S.transmissions[week] = S.transmissions[week] || { recues: {}, donner: {} };
    w[mode] = w[mode] || {};
    if (val) w[mode][pid] = val; else delete w[mode][pid];
    save();
  }
  const trText = t => t ? (t.ras ? 'RAS ✅' : t.text) : '';
  function trLines(pid, date) {
    const wk = weekStartOf(date); const r = trGet(wk, 'recues', pid), d = trGet(wk, 'donner', pid);
    return (r ? '<div class="tr r">📥 ' + esc(trText(r)) + '</div>' : '') + (d ? '<div class="tr g">📤 ' + esc(trText(d)) + '</div>' : '');
  }
  function viewTransmissions() {
    if (!UI.trMode) UI.trMode = 'recues';
    if (!UI.trWeek) { const t = today(); UI.trWeek = weekStartOf(E.parseIso(t).getDay() === 1 && UI.trMode === 'recues' ? E.addDays(t, 1) : t); }
    if (S.cabinets.length === 1) UI.trCab = S.cabinets[0].id;
    const wk = UI.trWeek, end = E.addDays(wk, 6);
    const MC = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const fmt = s => { const d = E.parseIso(s); return JOURS_LONG[d.getDay()].replace(/^./, x => x.toUpperCase()) + ' ' + d.getDate() + ' ' + MC[d.getMonth()]; };
    let h = brandTop('Transmissions');
    h += '<div class="chips" style="display:grid;grid-template-columns:1fr 1fr;margin-bottom:10px"><button class="chip tr-chip-r' + (UI.trMode === 'recues' ? ' on' : '') + '" data-mode="recues" aria-pressed="' + (UI.trMode === 'recues') + '">📥 Reçues</button><button class="chip tr-chip-g' + (UI.trMode === 'donner' ? ' on' : '') + '" data-mode="donner" aria-pressed="' + (UI.trMode === 'donner') + '">📤 À donner</button></div>';
    h += '<div class="rowx" style="margin-bottom:12px"><button class="icon-btn" id="w-prev" aria-label="Semaine précédente" style="background:#fff">‹</button><b style="font-size:16px">' + fmt(wk) + ' → ' + fmt(end) + '</b><button class="icon-btn" id="w-next" aria-label="Semaine suivante" style="background:#fff">›</button></div>';
    const c = UI.trCab && cab(UI.trCab);
    if (!c) {
      h += '<div class="section">Choisis le cabinet</div><div class="list">' + S.cabinets.map(cb => {
        const n = Object.keys((((S.transmissions || {})[wk] || {})[UI.trMode]) || {}).filter(pid => (pat(pid) || {}).cabinetId === cb.id).length;
        return '<button class="item" data-trcab="' + cb.id + '"><div><div class="t">' + esc(cb.nom) + '</div><div class="s">' + (n ? n + ' transmission' + (n > 1 ? 's' : '') + ' notée' + (n > 1 ? 's' : '') : 'Aucune transmission notée') + '</div></div><span style="font-size:20px;color:var(--accent)">›</span></button>';
      }).join('') + '</div>';
      if (!S.cabinets.length) h += '<p class="note">Crée d’abord un cabinet.</p>';
    } else {
      h += '<div class="rowx" style="margin:0 4px 8px">' + (S.cabinets.length > 1 ? '<button class="back" id="tr-cabs" style="min-height:36px">‹ Cabinets</button>' : '<span></span>') + '<b>' + esc(c.nom) + '</b></div>';
      h += '<input class="in" id="tr-q" placeholder="Rechercher un patient" autocomplete="off" value="' + esc(UI.trQ || '') + '" style="margin-bottom:10px"><div id="tr-list"></div>';
    }
    app.innerHTML = h;
    $$('[data-mode]').forEach(b => b.onclick = () => { UI.trMode = b.dataset.mode; route(); });
    $('#w-prev').onclick = () => { UI.trWeek = E.addDays(UI.trWeek, -7); route(); };
    $('#w-next').onclick = () => { UI.trWeek = E.addDays(UI.trWeek, 7); route(); };
    $$('[data-trcab]').forEach(b => b.onclick = () => { UI.trCab = b.dataset.trcab; UI.trQ = ''; route(); });
    const back = $('#tr-cabs'); if (back) back.onclick = () => { UI.trCab = null; route(); };
    if (!c) return;
    const draw = () => {
      const q = norm(UI.trQ || '').trim();
      const vus = new Set(S.soins.filter(s => (s.rec || {}).type === 'once' && s.start >= wk && s.start <= end).map(s => s.patientId));
      const pts = S.patients.filter(p => p.cabinetId === c.id && (!q || norm(p.nom).includes(q) || norm(p.adresse).includes(q)))
        .sort((a, b) => (+!!trGet(wk, UI.trMode, b.id) - +!!trGet(wk, UI.trMode, a.id)) || (+vus.has(b.id) - +vus.has(a.id)) || a.nom.localeCompare(b.nom, 'fr'));
      const cls = UI.trMode === 'recues' ? 'r' : 'g';
      $('#tr-list').innerHTML = pts.length ? '<div class="list">' + pts.map(p => {
        const t = trGet(wk, UI.trMode, p.id);
        return '<div class="item" style="display:block;padding:10px 12px 10px 14px"><div class="rowx" style="gap:8px"><button class="back" data-tredit="' + p.id + '" style="flex:1;min-width:0;text-align:left;color:inherit;font-weight:700;min-height:40px;display:block">' + esc(p.nom) + (vus.has(p.id) ? ' <span class="pill info" style="font-size:11px;font-weight:700">vu</span>' : '') + '</button>' +
          (t ? '' : '<button class="chip" data-ras="' + p.id + '" style="min-height:40px;font-size:14px;padding:0 10px">RAS ✅</button><button class="chip" data-tredit="' + p.id + '" style="min-height:40px;font-size:14px;padding:0 10px">Info</button>') + '</div>' +
          (t ? '<button class="tr ' + cls + '" data-tredit="' + p.id + '" style="width:100%;text-align:left;border:0;cursor:pointer;font:inherit;font-size:14px">' + esc(trText(t)) + '</button>' : '') + '</div>';
      }).join('') + '</div>' : '<p class="note">Aucun patient' + (q ? ' trouvé' : '') + '.</p>';
      $$('[data-ras]').forEach(b => b.onclick = () => { trSet(wk, UI.trMode, b.dataset.ras, { ras: true }); draw(); });
      $$('[data-tredit]').forEach(b => b.onclick = () => trEdit(wk, UI.trMode, b.dataset.tredit, draw));
    };
    $('#tr-q').oninput = e => { UI.trQ = e.target.value; draw(); };
    draw();
  }
  function trEdit(wk, mode, pid, done) {
    const p = pat(pid); const t = trGet(wk, mode, pid);
    sheet('<h2>' + esc(p.nom) + '</h2><p class="note">' + (mode === 'recues' ? '📥 Transmission reçue' : '📤 Transmission à donner') + ' · semaine du ' + esc(dateFr(wk)) + '</p>' +
      '<textarea class="in" id="tr-txt" style="min-height:130px" placeholder="Tape ou dicte : TA à surveiller, pansement à refaire…">' + esc(t && !t.ras ? t.text : '') + '</textarea>' +
      '<div class="btns"><button class="btn ghost" id="tr-ras">RAS ✅</button><button class="btn accent" id="tr-ok">Enregistrer</button></div>' +
      (t ? '<button class="btn danger" id="tr-del">Effacer</button>' : '<button class="btn" data-close>Annuler</button>'),
      (m, close) => {
        $('#tr-ras', m).onclick = () => { trSet(wk, mode, pid, { ras: true }); close(); done && done(); };
        $('#tr-ok', m).onclick = () => { const v = $('#tr-txt', m).value.trim(); trSet(wk, mode, pid, v ? { text: v } : null); close(); done && done(); };
        const del = $('#tr-del', m); if (del) del.onclick = () => { trSet(wk, mode, pid, null); close(); done && done(); };
        setTimeout(() => { const ta = $('#tr-txt', m); if (ta && !t) ta.focus(); }, 50);
      });
  }

  // ----- Réglages -----
  function viewReglages() {
    let h = backTop('#mois', 'Accueil') + '<h1 style="font-size:24px;margin:0 0 8px">Réglages</h1>';
    h += '<div class="list"><a class="item" href="#cabinets"><div><div class="t">Cabinets et rétrocession</div><div class="s">' + S.cabinets.length + ' cabinet(s)</div></div><span class="s">›</span></a>' +
      '<a class="item" href="#tarifs"><div><div class="t">Tarifs NGAP</div><div class="s">AMI ' + eur(E.amiValue(today(), S.tarifs)) + ' aujourd’hui · avenant 11</div></div><span class="s">›</span></a></div>';
    h += '<div class="section">Règles</div>';
    h += '<label class="chk"><span>MAU possible sur un passage BSI</span><input type="checkbox" id="r-mau"' + (S.regles.mauJourBsi ? ' checked' : '') + '></label>';
    h += '<label class="f" for="r-diab">Dextro + insuline à 100 % avec le BSI à partir du</label><input class="in" type="date" id="r-diab" value="' + esc(S.regles.diabBsiPleinDepuis) + '">';
    h += '<p class="note">Un jour de BSI, les actes non dérogatoires sont comptés comme inclus dans le forfait (règle de la brochure).</p>';
    h += '<div class="section">Assistant IA (facultatif)</div><div class="card"><p class="note" style="margin-top:0">Sert seulement à traduire les phrases compliquées en actes. Seul le texte des soins est envoyé, jamais le nom du patient. Sans clé, la reconnaissance locale fonctionne quand même, même sans réseau.</p>' +
      '<label class="f" for="r-key">Clé API Anthropic</label><input class="in" id="r-key" type="password" autocomplete="off" placeholder="sk-ant-…" value="' + esc(S.apiKey) + '">' +
      '<label class="f" for="r-model">Modèle</label><input class="in" id="r-model" value="' + esc(S.aiModel) + '" autocomplete="off" autocapitalize="off">' +
      '<div class="btns"><button class="btn ghost small" id="r-test" style="flex:1">Tester</button><button class="btn accent small" id="r-keysave" style="flex:1">Enregistrer</button></div></div>';
    h += '<div class="section">Sauvegarde</div><div class="card"><p class="note" style="margin-top:0">Les données restent uniquement sur ce téléphone. Fais une sauvegarde chiffrée régulièrement (par exemple dans Fichiers ou iCloud Drive) pour ne rien perdre si tu changes de téléphone.</p>' +
      '<div class="btns"><button class="btn small" id="r-exp" style="flex:1">Sauvegarder</button><button class="btn ghost small" id="r-imp" style="flex:1">Restaurer</button></div><input type="file" id="r-file" accept=".json,application/json" hidden></div>';
    h += '<div class="section">Importer des patients</div><div class="card"><p class="note" style="margin-top:0">Depuis Google Sheets ou Excel : exporte le tableau en <b>CSV</b>, puis choisis le fichier ici. Tu indiques ensuite quelle colonne correspond à quoi. Le fichier reste sur ce téléphone.</p>' +
      '<button class="btn small" id="r-csv" style="width:100%">Choisir un fichier CSV</button><input type="file" id="r-csvfile" accept=".csv,text/csv,text/plain" hidden></div>';
    h += '<button class="btn danger" id="r-wipe" style="margin-top:8px">Tout effacer</button>';
    h += '<p class="note" style="text-align:center;margin-top:18px">Soeuringue · estimation selon la NGAP (avenant 11), brochure Idelstory et guide CBA. Pour les cas tordus, utilise l’acte manuel.</p>';
    app.innerHTML = h;
    $('#r-mau').onchange = e => { S.regles.mauJourBsi = e.target.checked; save(); };
    $('#r-diab').onchange = e => { S.regles.diabBsiPleinDepuis = e.target.value || '2028-01-01'; save(); };
    $('#r-keysave').onclick = () => { S.apiKey = $('#r-key').value.trim(); S.aiModel = $('#r-model').value.trim() || 'claude-haiku-5-5'; save(); toast('Enregistré'); };
    $('#r-test').onclick = async () => {
      S.apiKey = $('#r-key').value.trim(); S.aiModel = $('#r-model').value.trim() || 'claude-haiku-5-5'; save();
      if (!S.apiKey) return toast('Colle d’abord la clé');
      try { const r = await parseAI('pansement d’escarre + insuline + glycémie'); toast('Ça marche : ' + r.acts.map(a => E.actLabel(a)).join(', ')); }
      catch (e) { toast(e.message.slice(0, 90)); }
    };
    $('#r-exp').onclick = exportBackup;
    $('#r-imp').onclick = () => $('#r-file').click();
    $('#r-file').onchange = e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };
    $('#r-csv').onclick = () => $('#r-csvfile').click();
    $('#r-csvfile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(await f.text()); };
    $('#r-wipe').onclick = () => confirmBox('Effacer toutes les données de l’appli ?', 'Tout effacer', () => { IDB.clear().catch(() => {}); const k = S.apiKey; S = blank(); S.apiKey = k; save(); location.hash = '#mois'; route(); });
  }
  function viewTarifs() {
    const T = S.tarifs;
    const num = (k, l) => '<label class="f" for="t-' + k + '">' + l + '</label><input class="in" id="t-' + k + '" type="number" inputmode="decimal" step="0.01" value="' + esc(T[k]) + '">';
    let h = backTop('#reglages', 'Réglages') + '<h1 style="font-size:24px;margin:0 0 8px">Tarifs NGAP</h1>';
    h += '<div class="section">Lettre-clé AMI / AMX</div><div id="t-ami">';
    T.ami.forEach((p, i) => h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label class="f" for="ta-f' + i + '">À partir du</label><input class="in" type="date" id="ta-f' + i + '" value="' + esc(p.from) + '"></div><div><label class="f" for="ta-v' + i + '">Valeur (€)</label><input class="in" type="number" step="0.01" inputmode="decimal" id="ta-v' + i + '" value="' + esc(p.value) + '"></div></div>');
    h += '</div><button class="btn ghost small" id="t-addp" style="width:100%;margin-top:10px">+ Ajouter une revalorisation</button>';
    h += '<div class="section">Déplacements</div>' + num('ifd', 'IFD (€)') + num('ifi', 'IFI — patient BSI (€)') + num('ik', 'IK plaine (€ / km)');
    h += '<div class="section">Majorations</div>' + num('mci', 'MCI (€)') + num('mau', 'MAU (€)') + num('dimanche', 'Dimanche / férié (€)')  + num('mie', 'MIE (€)');
    h += '<div class="section">Forfaits BSI</div>' + num('bsa', 'BSA (€ / jour)') + num('bsb', 'BSB (€ / jour)') + num('bsc', 'BSC (€ / jour)') + num('di', 'Lettre-clé DI (€)');
    h += '<div class="btns"><button class="btn ghost" id="t-reset">Valeurs par défaut</button><button class="btn accent" id="t-save">Enregistrer</button></div>';
    app.innerHTML = h;
    $('#t-addp').onclick = () => { readTarifs(); S.tarifs.ami.push({ from: today(), value: E.amiValue(today(), S.tarifs) }); route(); };
    $('#t-save').onclick = () => { readTarifs(); save(); toast('Tarifs enregistrés'); location.hash = '#reglages'; };
    $('#t-reset').onclick = () => confirmBox('Revenir aux tarifs par défaut ?', 'Rétablir', () => { S.tarifs = JSON.parse(JSON.stringify(E.DEFAULT_TARIFS)); save(); route(); });
  }
  function readTarifs() {
    const T = S.tarifs; const f = v => parseFloat(String(v).replace(',', '.'));
    T.ami = T.ami.map((p, i) => ({ from: $('#ta-f' + i).value || p.from, value: f($('#ta-v' + i).value) || p.value })).sort((a, b) => a.from.localeCompare(b.from));
    ['ifd', 'ifi', 'ik', 'mci', 'mau', 'dimanche', 'mie', 'bsa', 'bsb', 'bsc', 'di'].forEach(k => { const v = f($('#t-' + k).value); if (v >= 0) T[k] = v; });
  }

  // ---------- import CSV (Google Sheets, Excel) ----------
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const delim = [';', ',', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
  }
  function bsiLevel(v) {
    const t = norm(v).trim(); if (!t) return '';
    if (/bsc|lourd|^c$|^3$/.test(t)) return 'BSC';
    if (/bsb|intermed|^b$|^2$/.test(t)) return 'BSB';
    if (/bsa|leger|^a$|^1$/.test(t)) return 'BSA';
    return '';
  }
  const truthy = v => /^(oui|o|x|1|vrai|true|yes|y|ok|✓|✅)$/i.test(String(v).trim()) || /insulin/i.test(norm(v));
  function importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 1) return toast('Fichier vide ou illisible');
    const head = rows[0];
    const guess = re => { const i = head.findIndex(h => re.test(norm(h))); return i; };
    let iNom = guess(/^nom\b|nom de famille|^patient|^nom$|nom du patient/); if (iNom < 0) iNom = head.findIndex(h => /nom/.test(norm(h)) && !/prenom/.test(norm(h)));
    const iPre = guess(/prenom/), iCab = guess(/cabinet|titulaire|tournee/), iBsi = guess(/bsi|dependan|forfait|\bbs[abc]\b|niveau/),
      iDiab = guess(/diab|insulin/), iCan = guess(/cancer|immuno|onco/), iKm = guess(/\bkm\b|distance|kilom/),
      iAdr = guess(/adresse|^rue/), iCp = guess(/code postal|^cp$/), iVille = guess(/ville|commune/),
      iCode = guess(/acces|digicode|interphone|^code$/), iEtage = guess(/etage/), iPorte = guess(/porte|appart/),
      iTel = guess(/tel|portable|mobile/), iSoin = guess(/soin|note|traitement|ordonnance/);
    const col = (id, label, sel, optional) => '<label class="f" for="' + id + '">' + label + '</label><select class="in" id="' + id + '">' +
      (optional ? '<option value="-1">— aucune colonne —</option>' : '') +
      head.map((h, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(h || ('Colonne ' + (i + 1))) + '</option>').join('') + '</select>';
    let html = '<h2>Importer des patients</h2><p class="note">' + (rows.length - 1) + ' ligne(s) trouvée(s). Indique les colonnes, puis vérifie l’aperçu.</p>';
    html += '<label class="chk"><span>La 1re ligne contient les titres</span><input type="checkbox" id="im-head" checked></label>';
    html += col('im-nom', 'Nom (obligatoire)', iNom < 0 ? 0 : iNom) + col('im-pre', 'Prénom', iPre, true);
    html += '<label class="f" for="im-cabmode">Cabinet</label><select class="in" id="im-cabmode">' +
      (iCab >= 0 ? '<option value="col">Pris dans la colonne « ' + esc(head[iCab]) + ' »</option>' : '') +
      S.cabinets.map(c => '<option value="' + c.id + '">Tous dans : ' + esc(c.nom) + '</option>').join('') +
      '<option value="new">Tous dans un nouveau cabinet…</option></select><div id="im-newcab"></div>';
    html += col('im-bsi', 'Niveau BSI (BSA / BSB / BSC)', iBsi, true) + col('im-diab', 'Diabétique sous insuline (oui / x / 1)', iDiab, true) +
      col('im-can', 'Cancéreux / immunodéprimé (oui / x / 1)', iCan, true) + col('im-km', 'Distance en km', iKm, true);
    html += '<div class="section">Coordonnées</div>' + col('im-adr', 'Adresse', iAdr, true) + col('im-cp', 'Code postal (si à part)', iCp, true) + col('im-ville', 'Ville (si à part)', iVille, true) +
      col('im-code', 'Code d’accès', iCode, true) + col('im-etage', 'Étage', iEtage, true) + col('im-porte', 'Numéro de porte', iPorte, true) +
      col('im-tel', 'Téléphone', iTel, true) + col('im-soin', 'Soin (gardé en note)', iSoin, true);
    html += '<div class="section">Aperçu</div><div id="im-prev"></div>';
    html += '<div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="im-ok">Importer</button></div>';
    sheet(html, (m, close) => {
      const v = id => parseInt($('#' + id, m).value, 10);
      const build = () => {
        const data = $('#im-head', m).checked ? rows.slice(1) : rows;
        const mode = $('#im-cabmode', m).value;
        const newCabName = mode === 'new' ? (($('#im-nc', m) || {}).value || '').trim() : '';
        const out = [], seen = new Set();
        data.forEach(r => {
          const g = i => (i >= 0 && r[i] != null) ? String(r[i]).trim() : '';
          const nom = [g(v('im-nom')), g(v('im-pre'))].filter(Boolean).join(' ').replace(/\s+/g, ' ');
          if (!nom) return;
          const bsi = bsiLevel(g(v('im-bsi')));
          const cabName = mode === 'col' ? g(iCab) : mode === 'new' ? newCabName : (cab(mode) || {}).nom;
          const k = norm(nom) + '|' + norm(cabName); if (seen.has(k)) return; seen.add(k);
          out.push({ nom, cabName, cabId: mode !== 'col' && mode !== 'new' ? mode : null, bsi, diab: v('im-diab') >= 0 && truthy(g(v('im-diab'))),
            cancer: v('im-can') >= 0 && truthy(g(v('im-can'))), km: parseFloat(g(v('im-km')).replace(',', '.')) || 0,
            adresse: [g(v('im-adr')), [g(v('im-cp')), g(v('im-ville'))].filter(Boolean).join(' ')].filter(Boolean).join(', '),
            code: g(v('im-code')), etage: g(v('im-etage')), porte: g(v('im-porte')), tel: g(v('im-tel')), noteSoin: g(v('im-soin')) });
        });
        return out;
      };
      const findDup = r => S.patients.find(p => norm(p.nom) === norm(r.nom) && (cab(p.cabinetId) || {}).nom && norm(cab(p.cabinetId).nom) === norm(r.cabName));
      const isDup = r => !!findDup(r);
      const FILL = ['adresse', 'code', 'etage', 'porte', 'tel', 'noteSoin', 'bsi'];
      const missing = (p, r) => FILL.filter(k => r[k] && !p[k]);
      const preview = () => {
        $('#im-newcab', m).innerHTML = $('#im-cabmode', m).value === 'new' ? '<label class="f" for="im-nc">Nom du nouveau cabinet</label><input class="in" id="im-nc" autocomplete="off">' : '';
        const nc = $('#im-nc', m); if (nc) nc.oninput = draw;
        draw();
      };
      const draw = () => {
        const list = build(); const dups = list.filter(isDup).length;
        const fills = list.filter(r => { const p = findDup(r); return p && missing(p, r).length; }).length;
        $('#im-prev', m).innerHTML = '<div class="list">' + list.slice(0, 5).map(r => '<div class="item" style="cursor:default"><div><div class="t">' + esc(r.nom) + '</div><div class="s">' + esc([r.cabName || '⚠ cabinet manquant', r.bsi, r.diab ? 'diabétique' : '', r.cancer ? 'cancéreux' : '', r.km ? r.km + ' km' : '', r.adresse, r.code ? 'code ' + r.code : '', r.etage ? 'étage ' + r.etage : '', r.porte ? 'porte ' + r.porte : '', r.tel, r.noteSoin].filter(Boolean).join(' · ')) + '</div></div>' + (isDup(r) ? '<span class="pill info">' + (missing(findDup(r), r).length ? 'à compléter' : 'déjà à jour') + '</span>' : '') + '</div>').join('') + '</div>' +
          '<p class="note">' + (list.length - dups) + ' nouveau(x) patient(s)' + (fills ? ', ' + fills + ' fiche(s) complétée(s)' : '') + (dups - fills ? ', ' + (dups - fills) + ' déjà à jour' : '') + (list.length > 5 ? ' · aperçu des 5 premiers' : '') + '.</p>';
      };
      $$('select, input', m).forEach(el => el.onchange = preview);
      preview();
      $('#im-ok', m).onclick = () => {
        const list = build();
        if ($('#im-cabmode', m).value === 'new' && !(($('#im-nc', m) || {}).value || '').trim()) return toast('Donne un nom au nouveau cabinet');
        let n = 0, newCabs = 0, nf = 0;
        list.forEach(r => {
          const ex = findDup(r);
          if (ex) { const ks = missing(ex, r); ks.forEach(k => ex[k] = r[k]); if (ks.length) nf++; return; }
          let cabId = r.cabId;
          if (!cabId) {
            const name = r.cabName || 'Cabinet importé';
            let c = S.cabinets.find(x => norm(x.nom) === norm(name));
            if (!c) { c = { id: uid(), nom: name, retro: 10 }; S.cabinets.push(c); newCabs++; }
            cabId = c.id;
          }
          S.patients.push({ id: uid(), nom: r.nom, cabinetId: cabId, bsi: r.bsi, diab: r.diab, cancer: r.cancer, palliatif: false, enfant7: false, km: r.km,
            adresse: r.adresse, code: r.code, etage: r.etage, porte: r.porte, tel: r.tel, noteSoin: r.noteSoin });
          n++;
        });
        save(); close();
        toast(n + ' nouveau(x) patient(s)' + (nf ? ', ' + nf + ' fiche(s) complétée(s)' : '') + (newCabs ? ', ' + newCabs + ' cabinet(s) créé(s) (rétrocession 10 %)' : ''));
        location.hash = '#patients';
      };
    });
  }

  // ---------- Photos (stockées dans l'appli, sur le téléphone uniquement) ----------
  const IDB = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('soeuringue_photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('photos', mode); const req = fn(t.objectStore('photos')); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }); };
    return { put: p => run('readwrite', s => s.put(p)), get: id => run('readonly', s => s.get(id)), del: id => run('readwrite', s => s.delete(id)), all: () => run('readonly', s => s.getAll()), clear: () => run('readwrite', s => s.clear()) };
  })();
  function compressImage(file, maxSide, q) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        cv.toBlob(b => b ? res(b) : rej(new Error('image illisible')), 'image/jpeg', q);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image illisible')); };
      img.src = url;
    });
  }
  function pickImage(cb) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (f) cb(f); };
    document.body.appendChild(inp); inp.click();
  }
  async function delPhotos(ids) { for (const id of ids || []) { try { await IDB.del(id); } catch (e) {} } }
  const blobUrls = new Map();
  async function photoUrl(id) { if (blobUrls.has(id)) return blobUrls.get(id); const r = await IDB.get(id); if (!r) return ''; const u = URL.createObjectURL(r.blob); blobUrls.set(id, u); return u; }
  async function fillThumbs(root) { for (const im of $$('img[data-pid]', root)) { const u = await photoUrl(im.dataset.pid); if (u) im.src = u; } }
  function viewPhoto(src, label) {
    sheet('<h2>' + esc(label || '') + '</h2><img src="' + src + '" alt="" style="width:100%;border-radius:14px;display:block"><div class="btns"><button class="btn" data-close>Fermer</button></div>');
  }
  function patientPhotos(pid) {
    const items = [];
    S.soins.filter(s => s.patientId === pid && (s.photos || []).length).forEach(s => s.photos.forEach(id => items.push({ id, date: s.start })));
    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }
  function photosSheet(pid) {
    const items = patientPhotos(pid); const p = pat(pid);
    const j0 = items.length ? items[0].date : null;
    const jl = d => 'J' + (Math.round((E.parseIso(d) - E.parseIso(j0)) / 86400000) + 1);
    let h = '<h2>Photos — ' + esc(p.nom) + '</h2>';
    h += items.length ? '<p class="note">J1 = première photo (' + esc(dateFr(j0)) + '). Touche une photo pour l’agrandir.</p><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">' +
      items.slice().reverse().map(x => '<button class="back" data-big="' + x.id + '" data-lab="' + esc(jl(x.date) + ' · ' + dateFr(x.date)) + '" style="display:block;padding:0;min-height:0"><img data-pid="' + x.id + '" alt="Photo du ' + esc(dateFr(x.date)) + '" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#dde7ee;display:block"><span class="note" style="font-size:12px">' + jl(x.date) + ' · ' + esc(dateCourt(x.date).slice(0, 5)) + '</span></button>').join('') + '</div>'
      : '<p class="note">Aucune photo. Ajoute-les avec 📷 sur l’écran du passage.</p>';
    h += '<div class="btns"><button class="btn" data-close>Fermer</button></div>';
    sheet(h, m => { fillThumbs(m); $$('[data-big]', m).forEach(b => b.onclick = async () => viewPhoto(await photoUrl(b.dataset.big), b.dataset.lab)); });
  }

  // ---------- Ordonnance : lecture locale, puis IA si besoin (avec accord) ----------
  let ocrWorker = null;
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('chargement impossible')); document.head.appendChild(s); }); }
  async function ocrImage(blob, onProgress) {
    if (!window.Tesseract) await loadScript('tesseract.min.js');
    if (!ocrWorker) {
      const base = new URL('./', location.href).href;
      ocrWorker = await Tesseract.createWorker('fra', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, workerBlobURL: false, logger: m => onProgress && onProgress(m) });
    }
    const r = await ocrWorker.recognize(blob);
    return { text: r.data.text || '', conf: r.data.confidence || 0 };
  }
  const JOURS_MOTS = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
  function parseOrdonnance(text) {
    const t = norm(text);
    const acts = [];
    t.split(/\n/).forEach(line => {
      if (/docteur|\bdr\b|rpps|adeli|finess|\btel\b|telephone|ne\(e\) le|nee? le|n° ss|securite sociale|cabinet medical|@/.test(line)) return;
      line.split(/\+|,|;|\bet\b|\bpuis\b/).map(s => s.trim()).filter(s => s.length > 2).forEach(seg => {
        let id = null;
        for (const [re, v] of RULES) if (re.test(seg)) { id = v; break; }
        if (id === 'HORS' || !id) return;
        if (id === 'FILS') id = /plus de 10|> ?10|\b(1[1-9]|[2-9]\d) (fils|agrafes)/.test(seg) ? 'ablation_fils_plus' : 'ablation_fils';
        if (!acts.some(a => a.id === id)) acts.push({ id, qty: 1 });
      });
    });
    let rec = { type: 'daily', days: [1, 2, 3, 4, 5] }, recTrouvee = false;
    const nb = t.match(/(\d|deux|trois|quatre|cinq) ?(fois|x) ?(par|\/) ?sem/);
    const joursCites = Object.keys(JOURS_MOTS).filter(j => j !== 'dimanche' && new RegExp('\\b' + j + 's?\\b').test(t)).map(j => JOURS_MOTS[j]);
    if (/tous les jours|chaque jour|quotidien|1 ?(fois|x) ?(par|\/) ?j|7 ?j ?\/ ?7|matin et soir|(2|deux|3|trois) fois par jour/.test(t)) { rec = { type: 'daily' }; recTrouvee = true; }
    else if (/tous les (2|deux) jours|1 jour sur 2|un jour sur deux|jour sur deux/.test(t)) { rec = { type: 'every2' }; recTrouvee = true; }
    else if (joursCites.length >= 1 && /\ble[s]? (lundi|mardi|mercredi|jeudi|vendredi|samedi)/.test(t)) { rec = { type: 'weekdays', days: joursCites }; recTrouvee = true; }
    else if (nb) { const n = { deux: 2, trois: 3, quatre: 4, cinq: 5 }[nb[1]] || +nb[1]; rec = { type: 'weekdays', days: [[3], [1, 4], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5]][Math.min(5, n) - 1] || [1] }; recTrouvee = true; }

    const dimanche = /dimanche|feri|7 ?j ?\/ ?7|7 jours sur 7/.test(t);
    let duree = 0;
    const md = t.match(/(pendant|durant|duree( de)?( du traitement)?|x)\s*:?\s*(\d+)\s*(jours|jour|j\b|semaines|semaine|sem|mois)/);
    if (md) { const n = +md[4]; duree = /sem/.test(md[5]) ? n * 7 : /mois/.test(md[5]) ? n * 30 : n; }
    else if (/jusqu.?a cicatrisation/.test(t)) duree = 90;
    const passages = /matin,? midi et soir|(3|trois) fois par jour/.test(t) ? 3 : /matin et soir|(2|deux) fois par jour/.test(t) ? 2 : 1;
    const md2 = t.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2}|\d{2})\b/);
    let datePresc = '';
    if (md2) { const y = md2[3].length === 2 ? '20' + md2[3] : md2[3]; const s = y + '-' + String(md2[2]).padStart(2, '0') + '-' + String(md2[1]).padStart(2, '0'); if (!isNaN(E.parseIso(s))) datePresc = s; }
    return { acts, rec, recTrouvee, dimanche, duree, passages, datePresc };
  }
  async function blobToB64(blob) { const buf = await blob.arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  async function ordoAI(blob) {
    const list = Object.entries(E.ACTS).filter(([k]) => k !== 'manuel').map(([k, v]) => k + ' : ' + v.l).join('\n');
    const small = await compressImage(blob, 1568, 0.8);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': S.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: S.aiModel || 'claude-haiku-5-5', max_tokens: 600,
        system: "Tu lis une ordonnance de soins infirmiers (photo, parfois manuscrite). Ne recopie jamais le nom, la date de naissance ni l'identité du patient ou du médecin. Réponds UNIQUEMENT avec un JSON : {\"actes\":[{\"id\":\"...\"}],\"frequence\":\"daily|every2|weekdays|once\",\"jours\":[1,3,5],\"dimanche\":true,\"duree_jours\":10,\"passages_par_jour\":1}. jours : 0=dimanche…6=samedi, seulement si frequence=weekdays. N'utilise que les id du catalogue :\n" + list,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToB64(small) } }, { type: 'text', text: 'Lis cette ordonnance et réponds avec le JSON.' }] }] })
    });
    if (!res.ok) throw new Error('Erreur ' + res.status + (res.status === 401 ? ' : clé API refusée' : ''));
    const data = await res.json(); const out = (data.content || []).map(c => c.text || '').join('');
    const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    const acts = []; (j.actes || []).forEach(a => { if (E.ACTS[a.id] && a.id !== 'manuel' && !acts.some(x => x.id === a.id)) acts.push({ id: a.id, qty: 1 }); });
    const type = ['daily', 'every2', 'weekdays', 'once'].includes(j.frequence) ? j.frequence : 'daily';
    return { acts, rec: { type, days: (j.jours || []).filter(d => d >= 0 && d <= 6) }, recTrouvee: true, dimanche: !!j.dimanche, duree: +j.duree_jours || 0, passages: +j.passages_par_jour || 1, datePresc: '' };
  }
  function ordoResume(o) {
    const r = o.rec || {};
    const freq = r.type === 'every2' ? 'tous les 2 jours' : r.type === 'weekdays' ? 'les ' + JOURS_ORDRE.filter(d => (r.days || []).includes(d)).map(d => JOURS_LONG[d]).join(' ') : r.type === 'once' ? 'une fois' : 'tous les jours';
    return actsText(o.acts) + ' · ' + freq + (o.passages > 1 ? ' · ' + o.passages + ' passages/jour' : '') + (o.dimanche ? ' · dim./fériés' : '') + (o.end ? ' · jusqu’au ' + dateCourt(o.end) : '');
  }
  function ordoMenu(pid, done) {
    const p = pat(pid); const o = p.ordo;
    if (!o) return ordoScan(pid, done);
    const expired = o.end && o.end < today();
    sheet('<h2>Ordonnance — ' + esc(p.nom) + '</h2>' + (o.photoId ? '<img data-pid="' + o.photoId + '" alt="Photo de l’ordonnance" style="width:100%;max-height:260px;object-fit:contain;border-radius:12px;background:#dde7ee;display:block;margin-bottom:10px">' : '') +
      '<div class="card" style="padding:12px 14px"><div class="note" style="font-size:12px">Enregistrée le ' + esc(dateCourt(o.date)) + (expired ? ' · <b style="color:var(--warn)">terminée</b>' : '') + '</div><div style="margin-top:4px;line-height:1.4">' + esc(ordoResume(o)) + '</div></div>' +
      '<div class="btns"><button class="btn ghost" id="om-edit">Corriger</button><button class="btn ghost" id="om-new">Nouvelle</button></div><div class="btns" style="margin-top:0"><button class="btn danger" id="om-del">Supprimer</button><button class="btn" data-close>Fermer</button></div>',
      (m, close) => {
        fillThumbs(m);
        const im = $('img[data-pid]', m); if (im) im.onclick = async () => viewPhoto(await photoUrl(o.photoId), 'Ordonnance');
        $('#om-edit', m).onclick = () => { close(); ordoReview(pid, JSON.parse(JSON.stringify(o)), null, done); };
        $('#om-new', m).onclick = () => { close(); ordoScan(pid, done); };
        $('#om-del', m).onclick = () => confirmBox('Supprimer l’ordonnance de ' + p.nom + ' ?', 'Supprimer', async () => { await delPhotos([o.photoId]); delete p.ordo; save(); close(); done && done(); });
      });
  }
  function ordoScan(pid, done) {
    pickImage(async file => {
      let closeWait = null;
      sheet('<h2>Lecture de l’ordonnance…</h2><p class="note" id="ocr-st">Préparation (la première fois, ça prend quelques secondes).</p><div style="height:8px;background:#dde7ee;border-radius:4px;overflow:hidden"><div id="ocr-bar" style="height:100%;width:5%;background:var(--accent);transition:width .2s"></div></div><p class="note" style="margin-top:12px">Tout se passe sur le téléphone, rien n’est envoyé.</p>', (m, close) => { closeWait = close; });
      let blob;
      try { blob = await compressImage(file, 2200, 0.85); } catch (e) { closeWait && closeWait(); return toast('Photo illisible'); }
      let parsed = null, conf = 0;
      try {
        const r = await ocrImage(blob, msg => {
          const st = document.getElementById('ocr-st'), bar = document.getElementById('ocr-bar');
          if (st && msg.status) st.textContent = msg.status === 'recognizing text' ? 'Lecture du texte…' : 'Préparation du lecteur…';
          if (bar && msg.status === 'recognizing text') bar.style.width = Math.round(10 + 90 * (msg.progress || 0)) + '%';
        });
        conf = r.conf; parsed = parseOrdonnance(r.text);
      } catch (e) { console.warn(e); }
      closeWait && closeWait();
      const lue = parsed && parsed.acts.length > 0 && conf >= 35;
      if (lue) return ordoReview(pid, Object.assign(parsed, { source: 'locale' }), blob, done);
      // Non lue : proposer l'IA, seulement avec accord
      sheet('<h2>Ordonnance non lue</h2><p class="note">La lecture sur le téléphone n’a pas trouvé les soins (souvent une écriture à la main).</p>' +
        (S.apiKey ? '<div class="unknown">Si tu l’envoies à l’IA, la photo part sur les serveurs d’Anthropic, avec le nom et les infos du patient qui y figurent.</div><div class="btns"><button class="btn ghost" id="on-man">Saisir à la main</button><button class="btn accent" id="on-ai">Envoyer à l’IA</button></div>'
          : '<p class="note">Pour la lecture par l’IA, ajoute une clé API dans Réglages.</p><div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="on-man">Saisir à la main</button></div>'),
        (m, close) => {
          $('#on-man', m).onclick = () => { close(); ordoReview(pid, Object.assign(parsed || { acts: [], rec: { type: 'daily' }, dimanche: false, duree: 0, passages: 1 }, { source: 'main' }), blob, done); };
          const ai = $('#on-ai', m);
          if (ai) ai.onclick = async () => {
            if (!navigator.onLine) return toast('Pas de réseau');
            ai.disabled = true; ai.textContent = 'L’IA lit…';
            try { const r = await ordoAI(blob); close(); ordoReview(pid, Object.assign(r, { source: 'ia' }), blob, done); }
            catch (e) { ai.disabled = false; ai.textContent = 'Réessayer'; toast('IA : ' + e.message.slice(0, 80)); }
          };
        });
    });
  }
  function ordoReview(pid, o, blob, done) {
    const p = pat(pid);
    o.start = o.start || o.datePresc || today();
    if (!o.end && o.duree) o.end = E.addDays(o.start, o.duree - 1);
    o.rec = o.rec || { type: 'daily' };
    const draw = (m) => {
      const sh = $('.sheet', m);
      const r = o.rec;
      let h = '<h2>Vérifie l’ordonnance</h2><p class="note">' + esc(p.nom) + (o.source === 'ia' ? ' · lue par l’IA' : o.source === 'locale' ? ' · lue sur le téléphone' : '') + '. Corrige si besoin.</p>';
      h += '<div class="section" style="margin-top:6px">Soins prescrits</div>';
      h += o.acts.length ? o.acts.map((a, i) => '<div class="act sm"><span class="n">' + esc(E.actLabel(a)) + '</span><button class="icon-btn" data-rm="' + i + '" aria-label="Retirer">✕</button></div>').join('') : '<p class="note">Aucun soin trouvé.</p>';
      h += '<button class="back" id="or-add" style="min-height:40px">+ Ajouter un soin</button>';
      h += '<div class="section">Fréquence</div><div class="chips">' + [['daily', 'Tous les jours'], ['every2', 'Tous les 2 j'], ['weekdays', 'Certains jours'], ['once', 'Une fois']].map(([k, l]) => '<button class="chip' + (r.type === k ? ' on' : '') + '" data-rt="' + k + '" style="min-height:40px">' + l + '</button>').join('') + '</div>';
      if (r.type === 'weekdays') h += '<div class="days">' + JOURS_ORDRE.map(d => '<button class="chip' + ((r.days || []).includes(d) ? ' on' : '') + '" data-dd="' + d + '" aria-label="' + JOURS_LONG[d] + '">' + JOURS[d] + '</button>').join('') + '</div>';
      h += '<div class="g2" style="grid-template-columns:1fr 1fr;margin-top:10px"><div><label class="f" for="or-s" style="margin-top:0">Début</label><input class="in sm" type="date" id="or-s" value="' + esc(o.start) + '"></div><div><label class="f" for="or-e" style="margin-top:0">Fin</label><input class="in sm" type="date" id="or-e" value="' + esc(o.end || '') + '"></div></div>';
      h += '<label class="chk sm"><span>Dimanches et fériés</span><input type="checkbox" id="or-dim"' + (o.dimanche ? ' checked' : '') + '></label>';
      h += '<label class="chk sm"><span>Passages par jour</span><select class="in sm" id="or-pj" style="width:auto;min-height:40px">' + [1, 2, 3, 4].map(n => '<option' + (o.passages === n ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>';
      h += '<div class="btns"><button class="btn ghost" id="or-cancel">Annuler</button><button class="btn accent" id="or-ok">Enregistrer</button></div>';
      sh.innerHTML = h;
      const sync = () => { o.start = $('#or-s', sh).value || o.start; o.end = $('#or-e', sh).value; o.dimanche = $('#or-dim', sh).checked; o.passages = +$('#or-pj', sh).value; };
      $$('[data-rm]', sh).forEach(b => b.onclick = () => { sync(); o.acts.splice(+b.dataset.rm, 1); draw(m); });
      $$('[data-rt]', sh).forEach(b => b.onclick = () => { sync(); o.rec = { type: b.dataset.rt, days: o.rec.days && o.rec.days.length ? o.rec.days : [1, 2, 3, 4, 5] }; draw(m); });
      $$('[data-dd]', sh).forEach(b => b.onclick = () => { sync(); const d = +b.dataset.dd; o.rec.days = (o.rec.days || []).includes(d) ? o.rec.days.filter(x => x !== d) : (o.rec.days || []).concat(d); draw(m); });
      $('#or-add', sh).onclick = () => { sync(); pickActTo(id => { if (!o.acts.some(a => a.id === id)) o.acts.push({ id, qty: 1 }); draw(m); }); };
      $('#or-cancel', sh).onclick = () => m.remove();
      $('#or-ok', sh).onclick = async () => {
        sync();
        if (!o.acts.length) return toast('Ajoute au moins un soin');
        let photoId = (p.ordo && p.ordo.photoId) || null;
        if (blob) { if (photoId) await delPhotos([photoId]); photoId = uid(); await IDB.put({ id: photoId, patientId: pid, date: today(), kind: 'ordo', blob }); }
        p.ordo = { date: today(), photoId, acts: o.acts, rec: o.rec, start: o.start, end: o.end, dimanche: o.dimanche, passages: o.passages, source: o.source };
        save(); m.remove(); toast('Ordonnance enregistrée'); done && done();
      };
    };
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"></div>'; document.body.appendChild(m);
    draw(m);
  }
  function pickActTo(cb) {
    const groups = {};
    Object.entries(E.ACTS).forEach(([k, v]) => { if (k !== 'manuel') (groups[v.g] = groups[v.g] || []).push([k, v]); });
    let h = '<h2>Ajouter un soin</h2>';
    Object.entries(groups).forEach(([g, items]) => { h += '<div class="section">' + esc(g) + '</div><div class="list">' + items.map(([k, v]) => '<button class="item" data-pk="' + k + '"><span class="t" style="font-weight:600">' + esc(v.l) + '</span></button>').join('') + '</div>'; });
    h += '<button class="btn" data-close>Fermer</button>';
    sheet(h, (m, close) => $$('[data-pk]', m).forEach(b => b.onclick = () => { close(); cb(b.dataset.pk); }));
  }

  // ---------- sauvegarde chiffrée ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function keyFrom(pass, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function askPass(title, confirm2, cb, withPhotos) {
    sheet('<h2>' + esc(title) + '</h2><p class="note">Ce mot de passe protège les noms des patients. Sans lui, la sauvegarde est illisible : note-le bien.</p>' +
      '<label class="f" for="pp1">Mot de passe</label><input class="in" type="password" id="pp1" autocomplete="new-password">' +
      (confirm2 ? '<label class="f" for="pp2">Confirmer</label><input class="in" type="password" id="pp2" autocomplete="new-password">' : '') +
      (withPhotos ? '<label class="chk"><span>Inclure les photos (fichier plus lourd)</span><input type="checkbox" id="pp-ph" checked></label>' : '') +
      '<div class="btns"><button class="btn ghost" data-close>Annuler</button><button class="btn accent" id="pp-ok">Continuer</button></div>',
      (m, close) => $('#pp-ok', m).onclick = () => {
        const a = $('#pp1', m).value; if (a.length < 6) return toast('6 caractères minimum');
        if (confirm2 && a !== $('#pp2', m).value) return toast('Les deux mots de passe sont différents');
        const ph = $('#pp-ph', m); close(); cb(a, ph ? ph.checked : false);
      });
  }
  function exportBackup() {
    askPass('Sauvegarde chiffrée', true, async (pass, withPh) => {
      try {
        const data = Object.assign({}, S); delete data.apiKey;
        if (withPh) { const all = await IDB.all(); data._photos = []; for (const x of all) data._photos.push({ id: x.id, patientId: x.patientId, date: x.date, kind: x.kind, b64: await blobToB64(x.blob) }); }
        const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await keyFrom(pass, salt);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
        const out = JSON.stringify({ app: 'soeuringue', v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct) });
        const name = 'soeuringue-sauvegarde-' + today() + '.json';
        const file = new File([out], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); }
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
        toast('Sauvegarde créée');
      } catch (e) { if (e.name !== 'AbortError') toast('Sauvegarde impossible : ' + e.message); }
    }, true);
  }
  function importBackup(f) {
    askPass('Restaurer une sauvegarde', false, async pass => {
      try {
        const j = JSON.parse(await f.text());
        if (j.app !== 'soeuringue') throw new Error('fichier non reconnu');
        const key = await keyFrom(pass, unb64(j.salt));
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(j.iv) }, key, unb64(j.data));
        const data = JSON.parse(dec.decode(pt));
        confirmBox('Remplacer les données actuelles par cette sauvegarde ?', 'Remplacer', () => {
          const phs = data._photos; delete data._photos;
          const k = S.apiKey; S = Object.assign(blank(), data); S.apiKey = k; save();
          if (phs) (async () => { await IDB.clear(); for (const x of phs) { const bin = unb64(x.b64); await IDB.put({ id: x.id, patientId: x.patientId, date: x.date, kind: x.kind, blob: new Blob([bin], { type: 'image/jpeg' }) }); } toast(phs.length + ' photo(s) restaurée(s)'); })();
          toast('Sauvegarde restaurée'); location.hash = '#mois'; route();
        });
      } catch (e) { toast(e.name === 'OperationError' ? 'Mot de passe incorrect' : 'Restauration impossible : ' + e.message); }
    });
  }

  // ---------- démarrage ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
})();
