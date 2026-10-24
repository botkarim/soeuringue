/* Soeuringue — moteur de cotation NGAP (estimation)
   Sources : NGAP, avenant 11, brochure Idelstory Module 3 (2025-2026), guide CBA 2026.
   Toutes les valeurs sont modifiables dans Réglages. */
(function (root) {
  'use strict';

  // ---------- Tarifs par défaut ----------
  const DEFAULT_TARIFS = {
    // lettre-clé AMI / AMX (même valeur), par période
    ami: [
      { from: '2000-01-01', value: 3.15 },
      { from: '2026-11-06', value: 3.35 },
      { from: '2027-11-01', value: 3.45 }
    ],
    di: 10,          // DI 2,5 = 25 € ; DI 1,2 = 12 €
    ifd: 2.75,
    ifi: 2.75,
    ik: 0.35,        // plaine
    dimanche: 8.50,
    nuit1: 9.15,     // 20h-23h et 5h-8h
    nuit2: 18.30,    // 23h-5h
    mau: 1.35,
    mci: 5.00,
    mie: 3.15,
    bsa: 13.00,
    bsb: 18.20,
    bsc: 28.70
  };

  const DEFAULT_REGLES = {
    mauJourBsi: false,            // MAU possible sur un passage BSI ?
    diabBsiPleinDepuis: '2028-01-01' // dextro + insuline à 100 % avec BSI à partir de cette date
  };

  // ---------- Catalogue d'actes ----------
  // c : coefficient ; cc : coefficient patient cancéreux/immunodéprimé
  // lourd : déclenche la MCI ; derogBsi : facturable en AMX un jour de BSI
  // diab : fait partie de la « parenthèse du diabétique »
  const ACTS = {
    dependance:      { l: 'Soins de dépendance (BSI)', c: 0, dependance: true, g: 'BSI' },
    bsi_initial:     { l: 'Bilan BSI initial (DI 2,5)', c: 2.5, di: true, g: 'BSI' },
    bsi_renouv:      { l: 'Bilan BSI renouvellement (DI 1,2)', c: 1.2, di: true, g: 'BSI' },

    pans_simple:     { l: 'Pansement simple', c: 2.02, g: 'Pansements' },
    pans_lourd:      { l: 'Pansement lourd et complexe', c: 4, lourd: true, derogBsi: true, g: 'Pansements' },
    bilan_plaie:     { l: 'Bilan de plaie (1er pansement lourd)', c: 11, noMci: true, derogBsi: true, g: 'Pansements' },
    pans_compression:{ l: 'Pansement avec compression', c: 5.1, lourd: true, derogBsi: true, g: 'Pansements' },
    tpn:             { l: 'Pansement TPN (VAC)', c: 4.6, lourd: true, derogBsi: true, g: 'Pansements' },
    tpn_add:         { l: 'Pansement TPN additionnel', c: 2.1, derogBsi: true, g: 'Pansements' },
    stomie:          { l: 'Pansement de stomie / trachéotomie', c: 2.02, g: 'Pansements' },
    analgesie:       { l: 'Analgésie topique', c: 1.1, fullWithPans: true, g: 'Pansements' },
    ablation_fils:   { l: 'Ablation fils/agrafes (10 ou moins)', c: 2, g: 'Pansements' },
    ablation_fils_plus:{ l: 'Ablation fils/agrafes (plus de 10)', c: 4, g: 'Pansements' },

    inj_sc:          { l: 'Injection SC / IM', c: 1, cc: 1.5, g: 'Injections' },
    inj_id:          { l: 'Injection intradermique', c: 1, derogBsi: true, g: 'Injections' },
    inj_iv:          { l: 'Injection IV isolée', c: 2, cc: 2.5, g: 'Injections' },
    inj_iv_serie:    { l: 'Injection IV en série', c: 1.5, cc: 2.5, g: 'Injections' },
    inj_iv_pac:      { l: 'Injection IV sur chambre implantable', c: 4, g: 'Injections' },
    inj_iv_vvc:      { l: 'Injection IV sur VVC', c: 3, g: 'Injections' },
    chimio:          { l: 'Injection IV de chimiothérapie', c: 7, g: 'Injections' },
    implant:         { l: "Injection d'implant", c: 2.5, g: 'Injections' },
    vaccin:          { l: 'Vaccination (avec prescription)', c: 2.4, alwaysFull: true, derogBsi: true, g: 'Injections' },
    vaccin_sp:       { l: 'Vaccination (sans prescription)', c: 3.05, alwaysFull: true, derogBsi: true, g: 'Injections' },

    dextro:          { l: 'Glycémie (dextro)', c: 1, diab: true, g: 'Diabète' },
    insuline:        { l: "Injection d'insuline", c: 1, diab: true, g: 'Diabète' },
    surv_diab:       { l: 'Surveillance instauration traitement', c: 1, diab: true, g: 'Diabète' },
    surv_diab75:     { l: 'Surveillance hebdo diabétique + 75 ans', c: 4, diab: true, g: 'Diabète' },

    prise_sang:      { l: 'Prise de sang', c: 1.5, fullAsSecond: true, derogBsi: true, g: 'Prélèvements' },
    prelev:          { l: 'Prélèvement (ECBU, cutané…)', c: 1, g: 'Prélèvements' },

    perf_courte:     { l: 'Perfusion courte (1 h ou moins)', c: 9, cc: 10, perf: 'courte', derogBsi: true, g: 'Perfusions' },
    perf_heure:      { l: 'Heure de perfusion en plus', c: 6, perf: 'heure', derogBsi: true, g: 'Perfusions' },
    perf_longue:     { l: 'Perfusion longue (plus d’1 h)', c: 14, cc: 15, perf: 'longue', derogBsi: true, g: 'Perfusions' },
    perf_chg:        { l: 'Changement de flacon / débranchement temporaire', c: 4.1, perf: 'chg', derogBsi: true, g: 'Perfusions' },
    perf_retrait:    { l: 'Retrait définitif de perfusion', c: 5, perf: 'retrait', derogBsi: true, g: 'Perfusions' },
    perf_astreinte:  { l: 'Surveillance perfusion > 24 h (sans passage)', c: 4, perf: 'astreinte', standalone: true, derogBsi: true, g: 'Perfusions' },

    aerosol:         { l: 'Aérosol', c: 1.5, g: 'Autres soins' },
    lavage_vesical:  { l: 'Lavage vésical', c: 1.25, g: 'Autres soins' },
    sonde_f:         { l: 'Sonde urinaire (femme)', c: 3, g: 'Autres soins' },
    sonde_h:         { l: 'Sonde urinaire (homme)', c: 4, g: 'Autres soins' },
    retrait_sonde:   { l: 'Retrait de sonde à demeure', c: 2, raacPair: true, g: 'Autres soins' },
    alim_enterale:   { l: 'Alimentation entérale', c: 3, g: 'Autres soins' },
    lavement:        { l: 'Lavement / fécalome', c: 3, g: 'Autres soins' },
    admin_medic:     { l: 'Administration des médicaments', c: 1.2, g: 'Autres soins' },
    prado:           { l: 'Séance PRADO', c: 5.8, derogBsi: true, g: 'Autres soins' },
    raac_kt:         { l: 'Surveillance cathéter péri-nerveux (RAAC)', c: 4.2, raac: true, g: 'Autres soins' },
    raac_surv:       { l: 'Surveillance post-opératoire (RAAC)', c: 3.9, raac: true, g: 'Autres soins' },
    drains:          { l: 'Drains / redons', c: 2.8, raacPair: true, g: 'Autres soins' },

    manuel:          { l: 'Acte manuel', c: 1, manuel: true, g: 'Autres soins' }
  };

  // ---------- Dates ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function addDays(s, n) { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((parseIso(b) - parseIso(a)) / 86400000); }

  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(new Date(y, month - 1, day, 12));
  }
  const ferieCache = {};
  function feries(y) {
    if (ferieCache[y]) return ferieCache[y];
    const e = easter(y);
    const list = [y + '-01-01', addDays(e, 1), y + '-05-01', y + '-05-08', addDays(e, 39), addDays(e, 50),
      y + '-07-14', y + '-08-15', y + '-11-01', y + '-11-11', y + '-12-25'];
    return (ferieCache[y] = new Set(list));
  }
  function isDimancheOuFerie(s) { return parseIso(s).getDay() === 0 || feries(+s.slice(0, 4)).has(s); }

  // ---------- Valeurs ----------
  function round2(x) { return Math.round(x * 100 + 1e-9) / 100; }
  function amiValue(date, tarifs) {
    let v = tarifs.ami[0].value;
    for (const p of tarifs.ami) if (date >= p.from) v = p.value;
    return v;
  }
  function fmtCoef(c) { return String(Math.round(c * 100) / 100).replace('.', ','); }

  function actCoef(a, patient) {
    const def = ACTS[a.id] || ACTS.manuel;
    if (def.manuel) return Number(a.coef) || 0;
    if (patient && patient.cancer && def.cc) return def.cc;
    return def.c;
  }
  function actLabel(a) {
    const def = ACTS[a.id] || ACTS.manuel;
    return def.manuel ? (a.label || 'Acte manuel') : def.l;
  }

  // ---------- Article 11B ----------
  // units : [{c, acts, full(bool), ps(bool)}] → renvoie [{unit, taux}] taux ∈ {1, 0.5, 0}
  function apply11B(units) {
    const fixed = units.filter(u => u.full);
    const ranked = units.filter(u => !u.full).sort((a, b) => b.c - a.c);
    const res = fixed.map(u => ({ unit: u, taux: 1 }));
    function score(order) {
      return order.map((u, i) => {
        let t = i === 0 ? 1 : i === 1 ? 0.5 : 0;
        if (i >= 1 && u.ps) t = 1;          // prise de sang en 2e soin : taux plein
        if (i >= 2 && u.ps) t = 0;          // en 3e position : non facturée
        if (i >= 1 && u.fullSecond) t = 1;  // dérogations de paire
        return { unit: u, taux: t };
      });
    }
    let best = score(ranked);
    const psIdx = ranked.findIndex(u => u.ps);
    if (psIdx >= 0 && psIdx !== 1 && ranked.length >= 2) { // essayer la prise de sang en 2e position
      const alt = ranked.slice(); const [ps] = alt.splice(psIdx, 1); alt.splice(1, 0, ps);
      const sAlt = score(alt);
      const tot = r => r.reduce((s, x) => s + x.unit.c * x.taux, 0);
      if (tot(sAlt) > tot(best)) best = sAlt;
    }
    return res.concat(best);
  }

  // ---------- Cotation d'un passage ----------
  /* ctx = {
       date, heure, patient:{diab,cancer,palliatif,enfant7,km,bsi},
       acts:[{id,qty,coef?,label?}],
       dimanche:bool (majoration autorisée par la prescription), nuit:bool,
       bsiDay:bool (forfait BSI facturé ce jour), forfaitShare:number (0..1),
       tarifs, regles }
     → { lines:[{code, label, taux, montant, detail}], total } */
  function cotePassage(ctx) {
    const T = ctx.tarifs || DEFAULT_TARIFS;
    const R = Object.assign({}, DEFAULT_REGLES, ctx.regles || {});
    const p = ctx.patient || {};
    const date = ctx.date;
    const v = amiValue(date, T);
    const bsiDay = !!(ctx.bsiDay && p.bsi);
    const letter = bsiDay ? 'AMX' : 'AMI';
    const lines = [];
    const push = (code, label, taux, montant, detail) => lines.push({ code, label, taux, montant: round2(montant), detail: detail || '' });

    // éclater les quantités
    let acts = [];
    (ctx.acts || []).forEach(a => { const q = Math.max(1, Math.round(a.qty || 1)); for (let i = 0; i < q; i++) acts.push(Object.assign({}, a, { qty: 1 })); });

    const hasDependance = acts.some(a => a.id === 'dependance');
    acts = acts.filter(a => a.id !== 'dependance');

    // bilans BSI (DI) : à part, pas d'article 11B
    acts.filter(a => ACTS[a.id] && ACTS[a.id].di).forEach(a => {
      const c = ACTS[a.id].c; push('DI', '1 DI ' + fmtCoef(c), 'Entier', c * T.di, ACTS[a.id].l);
    });
    acts = acts.filter(a => !(ACTS[a.id] && ACTS[a.id].di));

    // forfait BSI (part de ce passage)
    if (bsiDay && hasDependance && ctx.forfaitShare > 0) {
      const f = T[String(p.bsi).toLowerCase()] || 0;
      const share = ctx.forfaitShare;
      push(p.bsi, '1 ' + p.bsi + (share < 1 ? ' (' + Math.round(share * 100) + ' % du forfait)' : ''), 'Entier', f * share, 'Forfait journalier' + (share < 1 ? ' réparti sur les passages' : ''));
    }

    // passage « astreinte » seul : pas de déplacement ni majoration
    const standaloneOnly = acts.length > 0 && acts.every(a => ACTS[a.id] && ACTS[a.id].standalone);

    // ----- perfusions : règles propres -----
    const perf = k => acts.filter(a => ACTS[a.id] && ACTS[a.id].perf === k);
    const courtes = perf('courte'), longues = perf('longue');
    const dropped = [];
    if (courtes.length > 1) { courtes.slice(1).forEach(a => dropped.push(a)); }
    if (courtes.length && perf('retrait').length) perf('retrait').forEach(a => dropped.push(a)); // débranchement inclus dans l'AMI 9
    if (longues.length > 1) longues.slice(1).forEach(a => dropped.push(a));
    acts = acts.filter(a => !dropped.includes(a));

    // ----- unités pour l'article 11B -----
    const hasPans = acts.some(a => ACTS[a.id] && ACTS[a.id].g === 'Pansements' && !ACTS[a.id].fullWithPans);
    const hasRaac = acts.some(a => ACTS[a.id] && ACTS[a.id].raac);
    const hasCourte = acts.some(a => ACTS[a.id] && ACTS[a.id].perf === 'courte');
    const hasLongue = acts.some(a => ACTS[a.id] && ACTS[a.id].perf === 'longue');
    const diabPlein = date >= R.diabBsiPleinDepuis;

    let units = [], inclus = [];
    const diabActs = acts.filter(a => ACTS[a.id] && ACTS[a.id].diab);
    let diabGroup = null;
    if (diabActs.length) {
      const grp = diabActs.slice();
      if (p.diab && !bsiDay) acts.filter(a => a.id === 'pans_lourd').forEach(a => grp.push(a)); // mal perforant plantaire
      diabGroup = { c: grp.reduce((s, a) => s + actCoef(a, p), 0), acts: grp, diab: true };
    }
    const inGroup = new Set(diabGroup ? diabGroup.acts : []);

    acts.forEach(a => {
      if (inGroup.has(a)) return;
      const def = ACTS[a.id] || ACTS.manuel;
      const u = { c: actCoef(a, p), acts: [a] };
      if (def.alwaysFull) u.full = true;
      if (def.fullAsSecond) u.ps = true;
      if (def.fullWithPans && hasPans) u.full = true;
      if (def.perf === 'heure') u.full = true;
      if (def.raacPair && hasRaac) u.full = true;
      if (def.raac && acts.some(x => ACTS[x.id] && ACTS[x.id].raacPair)) u.full = true;
      if (def.perf === 'courte' && hasLongue) u.full = true; // courte + longue : taux plein
      if (a.taux === 1 || a.taux === 0.5) u.forced = a.taux;
      if (bsiDay && !def.derogBsi && !def.manuel) { inclus.push(a); return; }
      units.push(u);
    });

    let diabTaux = null;
    if (diabGroup) {
      if (bsiDay) {
        if (hasDependance && !diabPlein) diabTaux = 0.5; else diabTaux = 1;
      }
    }

    let results;
    if (bsiDay) {
      // Jour de BSI : seuls les actes dérogatoires sont facturés ; l'article 11B s'applique entre eux.
      results = apply11B(units);
      if (diabGroup) results.push({ unit: diabGroup, taux: diabTaux });
    } else {
      if (diabGroup) units.push(diabGroup);
      results = apply11B(units);
    }
    results.forEach(r => { if (r.unit.forced) r.taux = r.unit.forced; });

    // lignes d'actes
    const tauxTxt = t => t === 1 ? 'Entier' : t === 0.5 ? 'Demi' : 'Gratuit';
    let billedUnits = 0, billedCoefSingle = 0;
    results.sort((a, b) => b.taux - a.taux || b.unit.c - a.unit.c).forEach(r => {
      r.unit.acts.forEach(a => {
        const c = actCoef(a, p);
        push(letter, '1 ' + letter + ' ' + fmtCoef(c) + ' ' + tauxTxt(r.taux), tauxTxt(r.taux), c * v * r.taux, actLabel(a));
      });
      if (r.taux > 0) { billedUnits++; billedCoefSingle = r.unit.c; }
    });
    inclus.forEach(a => push(letter, '1 ' + letter + ' ' + fmtCoef(actCoef(a, p)) + ' Inclus', 'Inclus', 0, actLabel(a) + ' — inclus dans le forfait'));
    dropped.forEach(a => push(letter, '1 ' + letter + ' ' + fmtCoef(actCoef(a, p)) + ' Gratuit', 'Gratuit', 0, actLabel(a) + ' — non cumulable'));

    if (standaloneOnly) {
      return { lines, total: round2(lines.reduce((s, l) => s + l.montant, 0)) };
    }

    // déplacement
    if (bsiDay) push('IFI', '1 IFI 1 Entier', 'Entier', T.ifi, 'Déplacement (BSI)');
    else if (acts.length || lines.length) push('IFD', '1 IFD 1 Entier', 'Entier', T.ifd, 'Déplacement');
    if (p.km > 0) {
      const km = Math.max(0, 2 * p.km - 4);
      if (km > 0) push('IK', km + ' IK', 'Entier', km * T.ik, 'Indemnités kilométriques (plaine)');
    }

    // majorations
    const hasLourd = results.some(r => r.taux > 0 && r.unit.acts.some(a => ACTS[a.id] && ACTS[a.id].lourd));
    const hasBilan = acts.some(a => a.id === 'bilan_plaie');
    const mci = (hasLourd && !hasBilan) || !!p.palliatif;
    if (mci) push('MCI', '1 MCI', 'Entier', T.mci, 'Majoration de coordination infirmière');
    const mauOk = !mci && billedUnits === 1 && billedCoefSingle <= 1.5 && billedCoefSingle > 0 && (!bsiDay || R.mauJourBsi);
    if (mauOk) push('MAU', '1 MAU', 'Entier', T.mau, 'Majoration acte unique');
    let nuitTier = 0;
    if (ctx.nuit) {
      const h = parseInt(String(ctx.heure || '08:00').slice(0, 2), 10);
      nuitTier = (h >= 23 || h < 5) ? 2 : ((h >= 20) || (h >= 5 && h < 8)) ? 1 : 0;
      if (nuitTier === 2) push('NUIT', '1 Majoration nuit (23h-5h)', 'Entier', T.nuit2, 'Majoration de nuit');
      if (nuitTier === 1) push('NUIT', '1 Majoration nuit', 'Entier', T.nuit1, 'Majoration de nuit');
    }
    if (!nuitTier && ctx.dimanche && isDimancheOuFerie(date)) push('DIM', '1 Majoration dimanche/férié', 'Entier', T.dimanche, 'Dimanche ou jour férié');
    if (p.enfant7) push('MIE', '1 MIE', 'Entier', T.mie, 'Enfant de moins de 7 ans');

    return { lines, total: round2(lines.reduce((s, l) => s + l.montant, 0)) };
  }

  // ---------- Occurrences des soins prévus ----------
  /* soin = { id, patientId, heure, acts, rec:{type:'once'|'daily'|'every2'|'weekdays', days:[0..6]},
              start, end, dimanche, nuit } */
  function occursOn(soin, date) {
    if (!soin.start || date < soin.start) return false;
    if (soin.end && date > soin.end) return false;
    const r = soin.rec || { type: 'once' };
    switch (r.type) {
      case 'once': return date === soin.start;
      case 'daily': return true;
      case 'every2': return daysBetween(soin.start, date) % 2 === 0;
      case 'weekdays': return (r.days || []).includes(parseIso(date).getDay());
      default: return false;
    }
  }
  function dimancheAutorise(soin) {
    if (!soin.dimanche) return false;
    const r = soin.rec || {};
    if (r.type === 'weekdays') return (r.days || []).length >= 4 && (r.days || []).includes(0);
    return true;
  }

  // Cotation de toute la journée d'un patient
  function coteJour(patient, soins, date, opts) {
    opts = opts || {};
    const todays = soins.filter(s => s.patientId === patient.id && occursOn(s, date));
    if (!todays.length) return [];
    // regrouper par heure → passages
    const byH = {};
    todays.forEach(s => {
      const k = s.heure || '08:00';
      (byH[k] = byH[k] || { heure: k, acts: [], dimanche: false, nuit: false, soins: [] });
      byH[k].acts = byH[k].acts.concat(s.acts || []);
      byH[k].dimanche = byH[k].dimanche || dimancheAutorise(s);
      byH[k].nuit = byH[k].nuit || !!s.nuit;
      byH[k].soins.push(s.id);
    });
    const passages = Object.values(byH).sort((a, b) => a.heure.localeCompare(b.heure));
    const depPassages = passages.filter(ps => ps.acts.some(a => a.id === 'dependance'));
    const bsiDay = !!patient.bsi && depPassages.length > 0;
    return passages.map(ps => {
      const isDep = ps.acts.some(a => a.id === 'dependance');
      const r = cotePassage({
        date, heure: ps.heure, patient, acts: ps.acts, dimanche: ps.dimanche, nuit: ps.nuit,
        bsiDay, forfaitShare: isDep ? 1 / depPassages.length : 0,
        tarifs: opts.tarifs, regles: opts.regles
      });
      return { date, heure: ps.heure, patientId: patient.id, soins: ps.soins, lines: r.lines, total: r.total };
    });
  }

  function monthDays(ym) {
    const [y, m] = ym.split('-').map(Number);
    const n = new Date(y, m, 0).getDate();
    const out = []; for (let d = 1; d <= n; d++) out.push(y + '-' + pad(m) + '-' + pad(d));
    return out;
  }

  function coteMois(state, ym, filter) {
    const res = [];
    const days = monthDays(ym);
    (state.patients || []).forEach(p => {
      if (filter && filter.cabinetId && p.cabinetId !== filter.cabinetId) return;
      if (filter && filter.patientId && p.id !== filter.patientId) return;
      days.forEach(d => coteJour(p, state.soins || [], d, { tarifs: state.tarifs, regles: state.regles }).forEach(x => res.push(x)));
    });
    return res;
  }

  const api = { ACTS, DEFAULT_TARIFS, DEFAULT_REGLES, cotePassage, coteJour, coteMois, occursOn, amiValue,
    isDimancheOuFerie, feries, monthDays, iso, parseIso, addDays, round2, fmtCoef, actCoef, actLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
