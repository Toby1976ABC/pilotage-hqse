(() => {
  'use strict';
  const cfg = window.HQSE_CONFIG;
  const sb = window.HQSE_API_MOCK ? null : window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });

  const ROLES = { direction: 'Direction', qse: 'Technicien QSE', operationnel: 'Resp. opérationnel' };
  const REFS = { IFS: 'IFS', HYG: 'Hygiène', SECU: 'Sécurité', GGAP: 'GlobalG.A.P.', DOC: 'Documentaire', VEILLE: 'Veille' };
  const GRAV = { rouge: 'Rouge', orange: 'Orange', info: 'Info' };
  const TITRES = { accueil: 'Accueil', alertes: 'Alertes', controles: 'Contrôles', echeances: 'Échéances' };

  const st = { moi: null, tab: 'accueil', feux: [], alertes: [], controles: [], echeances: [], run: null,
    filtreRef: '', filtreGrav: '', filtreCtl: 'a_faire', loading: true, error: null };

  // ---------- accès aux données ----------
  const api = window.HQSE_API_MOCK || {
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    onAuth(fn) { sb.auth.onAuthStateChange((_e, s) => fn(s)); },
    async login(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
      if (error) throw error;
    },
    async verifier(email, token) {
      const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
    },
    async logout() { await sb.auth.signOut(); },
    async moi() { const { data, error } = await sb.rpc('moi'); if (error) throw error; return data; },
    async charger() {
      const q = await Promise.all([
        sb.from('v_tableau_bord').select('code,libelle,feu,rouges,oranges,infos'),
        sb.from('alertes').select('id,gravite,referentiel,bot,objet,detail,ref_document,echeance,statut,commentaire,pris_par,pris_le,created_at').eq('statut', 'ouverte'),
        sb.from('v_controles_a_faire').select('*'),
        sb.from('exigences').select('id,referentiel,intitule,document_code,derniere_realisation,prochaine_echeance').eq('actif', true).order('prochaine_echeance', { ascending: true, nullsFirst: true }),
        sb.from('bot_runs').select('fin').not('fin', 'is', null).order('fin', { ascending: false }).limit(1)
      ]);
      const e = q.find((r) => r.error); if (e) throw e.error;
      return { feux: q[0].data, alertes: q[1].data, controles: q[2].data, echeances: q[3].data, run: q[4].data[0] || null };
    },
    async realisation(id, date, com) { const { error } = await sb.rpc('enregistrer_realisation', { p_controle_id: id, p_date: date, p_commentaire: com || null }); if (error) throw error; },
    async alerte(id, action, com) { const { error } = await sb.rpc('prendre_alerte', { p_id: id, p_action: action, p_commentaire: com || null }); if (error) throw error; }
  };

  // ---------- utilitaires ----------
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const fmtDate = (s) => { if (!s) return '—'; const d = new Date(String(s).length <= 10 ? s + 'T12:00:00' : s); return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const fmtDH = (s) => s ? new Date(s).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const jours = (s) => s ? Math.round((new Date(s + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 86400000) : null;
  const plural = (n, w) => n + ' ' + w + (n > 1 ? 's' : '');
  const toast = (msg) => { const t = el('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); };
  const errMsg = (e) => {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/non autorisée|Database error saving new user|signups not allowed/i.test(m)) return "Cette adresse n'a pas accès à Pilotage HQSE. Demandez à la direction de l'ajouter.";
    if (/rate limit|security purposes/i.test(m)) return "Trop de demandes d'e-mail pour le moment. Réessayez dans une heure, ou utilisez le dernier code reçu.";
    if (/expired|invalid|otp/i.test(m)) return 'Code incorrect ou expiré. Vérifiez le dernier e-mail reçu ou demandez un nouveau code.';
    return m;
  };

  // ---------- chargement ----------
  async function rafraichir(silencieux) {
    if (!silencieux) { st.loading = true; render(); }
    try { Object.assign(st, await api.charger()); st.error = null; }
    catch (e) { st.error = errMsg(e); }
    st.loading = false; render();
  }

  // ---------- vues ----------
  function compteurs() {
    const r = st.feux.reduce((a, f) => ({ rouges: a.rouges + Number(f.rouges), oranges: a.oranges + Number(f.oranges) }), { rouges: 0, oranges: 0 });
    return r;
  }
  function aFaire() { return st.controles.filter((c) => !c.fait_periode && !c.sans_objet); }

  function vAccueil() {
    const c = compteurs(); const af = aFaire(); const urg = af.filter((x) => jours(x.echeance) <= 7);
    const ordre = ['IFS', 'HYG', 'SECU', 'GGAP', 'DOC', 'VEILLE'];
    const feux = [...st.feux].sort((a, b) => ordre.indexOf(a.code) - ordre.indexOf(b.code));
    return [
      el('div', { class: 'card' },
        el('p', { class: 'lead' }, el('b', {}, c.rouges), ' alertes rouges, ', el('b', {}, c.oranges), ' orange. ',
          el('b', {}, af.length), ' contrôle', af.length > 1 ? 's' : '', ' à faire sur la période', urg.length ? [', dont ', el('b', {}, urg.length), ' avant 7 jours.'] : '.'),
        el('p', { class: 'meta', style: 'margin:6px 0 0;color:var(--muted);font-size:12px' }, 'Dernier passage des bots : ' + fmtDH(st.run && st.run.fin))),
      el('h2', { class: 'h2' }, 'État par référentiel'),
      el('div', { class: 'feux' }, feux.map((f) => el('button', { class: 'feu ' + f.feu, onclick: () => { st.filtreRef = f.code; st.filtreGrav = ''; go('alertes'); } },
        el('span', { class: 'nom' }, REFS[f.code] || f.code),
        el('span', { class: 'nb' }, plural(Number(f.rouges), 'rouge'), ' · ', plural(Number(f.oranges), 'orange'))))),
      el('h2', { class: 'h2' }, 'Les plus urgents'),
      el('div', { class: 'list' }, st.alertes.filter((a) => a.gravite === 'rouge').slice(0, 4).map(carteAlerte),
        st.alertes.some((a) => a.gravite === 'rouge') ? null : el('div', { class: 'empty' }, 'Aucune alerte rouge.'))
    ];
  }

  function carteAlerte(a) {
    const encours = !!a.pris_le;
    return el('div', { class: 'item' },
      el('div', { class: 'row' }, el('span', { class: 'pill ' + a.gravite }, GRAV[a.gravite] || a.gravite), el('span', { class: 'pill info' }, REFS[a.referentiel] || a.referentiel),
        encours ? el('span', { class: 'pill encours' }, 'Pris en charge') : null),
      el('div', { class: 'title' }, a.objet),
      a.detail ? el('div', { class: 'detail' }, a.detail) : null,
      encours ? el('div', { class: 'meta' }, 'Par ', a.pris_par || '?', ' le ', fmtDH(a.pris_le), a.commentaire ? ' — « ' + a.commentaire + ' »' : '') : null,
      el('div', { class: 'actions' },
        encours
          ? el('button', { class: 'btn ghost', onclick: () => feuilleAlerte(a, 'rouvrir') }, 'Remettre en ouvert')
          : el('button', { class: 'btn', onclick: () => feuilleAlerte(a, 'prendre') }, 'Je m’en occupe'),
        st.moi && st.moi.role === 'direction' ? el('button', { class: 'btn ghost', onclick: () => feuilleAlerte(a, 'ignorer') }, 'Ignorer') : null));
  }

  function vAlertes() {
    const rang = { rouge: 1, orange: 2, info: 3 };
    const liste = st.alertes.filter((a) => (!st.filtreRef || a.referentiel === st.filtreRef) && (!st.filtreGrav || a.gravite === st.filtreGrav))
      .sort((x, y) => rang[x.gravite] - rang[y.gravite] || String(x.referentiel).localeCompare(y.referentiel) || String(x.objet).localeCompare(y.objet));
    const chip = (lab, on, fn) => el('button', { class: 'chip', 'aria-pressed': on ? 'true' : 'false', onclick: fn }, lab);
    return [
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Référentiel' },
        chip('Tous', !st.filtreRef, () => { st.filtreRef = ''; render(); }),
        Object.entries(REFS).map(([k, v]) => chip(v, st.filtreRef === k, () => { st.filtreRef = k; render(); }))),
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Gravité' },
        chip('Toutes gravités', !st.filtreGrav, () => { st.filtreGrav = ''; render(); }),
        Object.entries(GRAV).map(([k, v]) => chip(v, st.filtreGrav === k, () => { st.filtreGrav = k; render(); }))),
      el('p', { class: 'meta', style: 'margin:0;color:var(--muted);font-size:12px' }, plural(liste.length, 'alerte') + '. Une alerte se ferme toute seule quand le bot ne la détecte plus.'),
      el('div', { class: 'list' }, liste.map(carteAlerte), liste.length ? null : el('div', { class: 'empty' }, 'Aucune alerte pour ce filtre.'))
    ];
  }

  function vControles() {
    const chip = (lab, v) => el('button', { class: 'chip', 'aria-pressed': st.filtreCtl === v ? 'true' : 'false', onclick: () => { st.filtreCtl = v; render(); } }, lab);
    let liste = st.controles.filter((c) => !c.sans_objet);
    if (st.filtreCtl === 'a_faire') liste = liste.filter((c) => !c.fait_periode);
    if (st.filtreCtl === 'faits') liste = liste.filter((c) => c.fait_periode);
    liste.sort((a, b) => (a.fait_periode - b.fait_periode) || String(a.echeance).localeCompare(b.echeance) || a.intitule.localeCompare(b.intitule));
    return [
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Filtre' }, chip('À faire', 'a_faire'), chip('Faits', 'faits'), chip('Tous', 'tous')),
      el('div', { class: 'list' }, liste.map((c) => {
        const j = jours(c.echeance);
        const pill = c.fait_periode ? el('span', { class: 'pill ok' }, 'Fait sur la période')
          : el('span', { class: 'pill ' + (j <= 7 ? 'rouge' : j <= 30 ? 'orange' : 'info') }, j < 0 ? 'En retard' : 'Avant le ' + fmtDate(c.echeance));
        return el('div', { class: 'item' },
          el('div', { class: 'row' }, pill, el('span', { class: 'pill info' }, c.frequence_txt || '')),
          el('div', { class: 'title' }, c.intitule),
          el('div', { class: 'meta' }, (c.qui || '') + ' · dernier : ' + fmtDate(c.derniere)),
          el('div', { class: 'actions' }, el('button', { class: 'btn ' + (c.fait_periode ? '' : 'primary'), onclick: () => feuilleControle(c) }, c.fait_periode ? 'Ajouter une réalisation' : 'Marquer comme fait')));
      }), liste.length ? null : el('div', { class: 'empty' }, st.filtreCtl === 'a_faire' ? 'Tout est à jour sur la période.' : 'Aucun contrôle.'))
    ];
  }

  function vEcheances() {
    return [
      el('p', { class: 'meta', style: 'margin:0;color:var(--muted);font-size:12px' }, "Calculées d'après la dernière modification du document dans le Dossier qualité."),
      el('div', { class: 'list' }, st.echeances.map((e) => {
        const j = jours(e.prochaine_echeance);
        return el('div', { class: 'item' },
          el('div', { class: 'row' }, el('span', { class: 'pill ' + (j == null ? 'info' : j < 0 ? 'rouge' : j <= 30 ? 'orange' : 'ok') }, j == null ? 'Inconnue' : j < 0 ? 'Dépassée de ' + plural(-j, 'jour') : 'Dans ' + plural(j, 'jour')),
            el('span', { class: 'pill info' }, REFS[e.referentiel] || e.referentiel)),
          el('div', { class: 'title' }, e.intitule),
          el('div', { class: 'meta' }, e.document_code + ' · mis à jour le ' + fmtDate(e.derniere_realisation) + ' · échéance ' + fmtDate(e.prochaine_echeance)));
      }))
    ];
  }

  // ---------- feuilles d'action ----------
  function feuille(titre, corps, libOk, action) {
    const err = el('p', { class: 'err', hidden: true });
    const ok = el('button', { class: 'btn primary', type: 'submit' }, libOk);
    const fermer = () => bg.remove();
    const form = el('form', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre, novalidate: true },
      el('h3', {}, titre), corps, err,
      el('div', { class: 'actions', style: 'display:flex;gap:8px;justify-content:flex-end' }, el('button', { class: 'btn ghost', type: 'button', onclick: fermer }, 'Annuler'), ok));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); err.hidden = true;
      const pb = action.valider && action.valider(); if (pb) { err.textContent = pb; err.hidden = false; return; }
      ok.disabled = true; ok.textContent = 'Enregistrement…';
      try { await action.faire(); fermer(); toast(action.succes); rafraichir(true); }
      catch (e) { err.textContent = errMsg(e); err.hidden = false; ok.disabled = false; ok.textContent = libOk; }
    });
    const bg = el('div', { class: 'sheet-bg', onclick: (e) => { if (e.target === bg) fermer(); } }, form);
    document.body.append(bg);
    const f = form.querySelector('input,textarea'); if (f) f.focus();
  }

  function feuilleControle(c) {
    const d = el('input', { type: 'date', id: 'f-date', value: today(), max: today(), required: true });
    const com = el('textarea', { id: 'f-com', placeholder: 'Facultatif : résultat, écart constaté, n° de rapport…' });
    feuille(c.intitule, [el('label', { class: 'fld', for: 'f-date' }, 'Date de réalisation', d), el('label', { class: 'fld', for: 'f-com' }, 'Commentaire', com)], 'Enregistrer', {
      valider: () => !d.value ? 'Indiquez la date de réalisation.' : d.value > today() ? 'La date ne peut pas être dans le futur.' : null,
      faire: () => api.realisation(c.id, d.value, com.value.trim()),
      succes: 'Contrôle enregistré'
    });
  }

  function feuilleAlerte(a, action) {
    const com = el('textarea', { id: 'f-com-a', placeholder: action === 'ignorer' ? 'Pourquoi cette alerte ne s’applique pas' : 'Ce que vous allez faire, et quand' });
    const titres = { prendre: 'Prendre en charge', ignorer: 'Ignorer cette alerte', rouvrir: 'Remettre en ouvert' };
    const succes = { prendre: 'Alerte prise en charge', ignorer: 'Alerte ignorée', rouvrir: 'Alerte remise en ouvert' };
    feuille(titres[action], [el('p', { class: 'detail', style: 'margin:0' }, a.objet), action === 'rouvrir' ? null : el('label', { class: 'fld', for: 'f-com-a' }, 'Commentaire', com)], titres[action], {
      valider: () => action === 'ignorer' && !com.value.trim() ? 'Expliquez pourquoi vous ignorez cette alerte.' : null,
      faire: () => api.alerte(a.id, action, com.value.trim()),
      succes: succes[action]
    });
  }

  // ---------- rendu ----------
  function render() {
    $('#titre').textContent = TITRES[st.tab];
    document.querySelectorAll('nav.tabs button').forEach((b) => { if (b.dataset.tab === st.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const nr = st.alertes.filter((a) => a.gravite === 'rouge' && !a.pris_le).length;
    const bA = $('#badge-alertes'); bA.hidden = !nr; bA.textContent = nr;
    const nc = aFaire().filter((c) => jours(c.echeance) <= 7).length;
    const bC = $('#badge-controles'); bC.hidden = !nc; bC.textContent = nc;
    const v = $('#view');
    if (st.loading && !st.feux.length) { v.replaceChildren(el('div', { class: 'skel' }), el('div', { class: 'skel' }), el('div', { class: 'skel' })); return; }
    const contenu = st.error ? [el('div', { class: 'card' }, el('p', { class: 'err', style: 'margin:0' }, 'Chargement impossible : ' + st.error), el('button', { class: 'btn', style: 'margin-top:10px', onclick: () => rafraichir() }, 'Réessayer'))] : [];
    const vues = { accueil: vAccueil, alertes: vAlertes, controles: vControles, echeances: vEcheances };
    v.replaceChildren(...contenu, ...vues[st.tab]());
  }
  function go(tab) { st.tab = tab; try { history.replaceState(null, '', '#' + tab); } catch (_) {} render(); window.scrollTo(0, 0); }

  // ---------- démarrage ----------
  let dernierUser;
  async function entrer(session) {
    const uid = session ? session.user && session.user.id : null;
    if (uid === dernierUser) return; dernierUser = uid;
    if (!session) { $('#app').hidden = true; $('#login').hidden = false; return; }
    $('#login').hidden = true; $('#app').hidden = false;
    try { st.moi = await api.moi(); } catch (e) { st.moi = null; }
    if (!st.moi) {
      $('#view').replaceChildren(el('div', { class: 'card' }, el('p', { style: 'margin:0' }, "Votre compte est connecté mais n'a pas de rôle dans Pilotage HQSE. Demandez à la direction de vous ajouter."),
        el('button', { class: 'btn', style: 'margin-top:10px', onclick: () => api.logout() }, 'Se déconnecter')));
      return;
    }
    $('#who-nom').textContent = st.moi.nom; $('#who-role').textContent = ROLES[st.moi.role] || st.moi.role;
    rafraichir();
  }

  document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $('#btn-refresh').addEventListener('click', () => rafraichir());
  $('#who-nom').parentElement.addEventListener('click', () => feuille('Mon compte', [el('p', { style: 'margin:0' }, st.moi ? st.moi.nom + ' — ' + (ROLES[st.moi.role] || '') : ''), el('p', { class: 'meta', style: 'margin:0;color:var(--muted)' }, st.moi ? st.moi.email : '')], 'Se déconnecter', { faire: () => api.logout(), succes: 'Déconnecté' }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.moi) rafraichir(true); });

  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('#email').value.trim().toLowerCase(); const err = $('#login-err'); err.hidden = true;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Saisissez une adresse e-mail valide.'; err.hidden = false; return; }
    const b = $('#login-btn'); b.disabled = true; b.textContent = 'Envoi…';
    try { await api.login(email); montrerCode(); }
    catch (e) { err.textContent = errMsg(e); err.hidden = false; }
    b.disabled = false; b.textContent = 'Recevoir le code';
  });
  $('#email').addEventListener('input', () => { $('#login-err').hidden = true; });
  function montrerCode() {
    $('#login-form').hidden = true; $('#code-form').hidden = false; $('#code-err').hidden = true;
    $('#code').value = ''; $('#code').focus();
  }
  $('#code-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('#email').value.trim().toLowerCase();
    const code = $('#code').value.replace(/\D/g, ''); const err = $('#code-err'); err.hidden = true;
    if (code.length !== 6) { err.textContent = 'Le code contient 6 chiffres.'; err.hidden = false; return; }
    const b = $('#code-btn'); b.disabled = true; b.textContent = 'Vérification…';
    try { await api.verifier(email, code); }
    catch (e) { err.textContent = errMsg(e); err.hidden = false; }
    b.disabled = false; b.textContent = 'Se connecter';
  });
  $('#code').addEventListener('input', () => {
    const c = $('#code'); c.value = c.value.replace(/\D/g, '').slice(0, 6); $('#code-err').hidden = true;
    if (c.value.length === 6) $('#code-form').requestSubmit();
  });
  $('#code-retour').addEventListener('click', () => { $('#code-form').hidden = true; $('#login-form').hidden = false; $('#email').focus(); });

  const h = (location.hash || '').replace('#', ''); if (TITRES[h]) st.tab = h;
  api.onAuth((s) => entrer(s));
  api.session().then(entrer);

  if ('serviceWorker' in navigator && !window.HQSE_API_MOCK) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
