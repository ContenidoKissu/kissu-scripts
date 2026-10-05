// ==UserScript==
// @name         💳 Crédito Directo Digital – Kamina Pay
// @namespace    luzverde-credito-directo
// @version      3.15.0
// @description  Panel flotante CDD para Kamina Pay. Modelo Compra de Cartera: crédito inverso por categoría (103%), tope de efectivo con transporte, alcance cuando el producto supera el cupo, Plan SIN INTERÉS ×1.15 con copiar cuotas. Buscador de ciudades que aplican a crédito.
// @author       luzverde
// @match        *://ecuador.luzverdetech.com/ventas/resumen-estado-cliente/CEDULA/*
// @updateURL    https://raw.githubusercontent.com/ContenidoKissu/kissu-scripts/main/kamina-cdd.user.js
// @downloadURL  https://raw.githubusercontent.com/ContenidoKissu/kissu-scripts/main/kamina-cdd.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     CONFIGURACIÓN — editar estas tasas según se validen
     Tasa Asistencia Kamina varía por Categoría de cliente.
     Agregar más categorías conforme se descubran.
  ═══════════════════════════════════════════════════════════════ */
  // ── NUEVO MODELO: COMPRA DE CARTERA ──────────────────────────────
  // Kamina descuenta del valor de crédito el % de Compra de Cartera
  // (según categoría del cliente) + Honorario Plataforma (3% + IVA).
  // El comercio recibe el NETO. Se busca recibir MARGIN_TARGET del total base.
  const IVA            = 0.15;                 // IVA Ecuador 15%
  const HONORARIO_BASE = 0.03;                 // 3% honorario plataforma
  const HONORARIO      = HONORARIO_BASE * (1 + IVA); // 3% + IVA = 3.45%
  const MARGIN_TARGET  = 1.03;                 // recibir el 103% del valor base

  // %Compra de Cartera por CATEGORÍA EN SISTEMA (lo que aparece en el DOM)
  const CARTERA_BY_CAT = {
    'PLUS': 0.10,   // AAA
    '1'   : 0.15,   // AA
    '2'   : 0.20,   // A
    '3'   : 0.25,   // B
    '4'   : 0.30,   // C
    'NEW' : 0.35,   // INCLUSION
  };
  const CARTERA_DEFAULT = 0.35; // fallback (peor caso: NEW / inclusión)

  const CREDITO_MIN    = 300;  // monto mínimo de crédito (planes con interés)
  const CREDITO_MIN_SI = 30;   // monto mínimo de crédito (Plan SIN INTERÉS)
  const PLAN_SI_RATE = 0.15;   // Plan SIN INTERÉS: markup 15% → crédito = C1 × 1.15
  const ANNUAL_RATE  = 0.1559; // tasa anual nominal Kamina (referencia)
  const ALL_MONTHS   = [6, 9, 12, 15, 18, 24];

  // ── CIUDADES QUE APLICAN A CRÉDITO (por provincia) ───────────────
  // Solo lo que está aquí aplica. Para agregar/quitar, editar esta lista.
  const CIUDADES_CREDITO = {
    'Azuay'      : ['Cuenca', 'Gualaceo', 'Paute', 'Sígsig', 'Girón', 'Santa Isabel'],
    'Bolívar'    : ['Guaranda', 'San Miguel', 'Chimbo', 'Chillanes', 'Caluma'],
    'Cañar'      : ['Azogues', 'La Troncal', 'Cañar', 'Biblián', 'Déleg'],
    'Carchi'     : ['Tulcán', 'San Gabriel', 'El Ángel', 'Julio Andrade'],
    'Chimborazo' : ['Riobamba', 'Guano', 'Alausí', 'Chambo', 'Colta'],
    'Cotopaxi'   : ['Latacunga', 'La Maná', 'Salcedo', 'Pujilí', 'Saquisilí'],
    'El Oro'     : ['Machala', 'Pasaje', 'Santa Rosa', 'Huaquillas', 'El Guabo', 'Zaruma', 'Piñas'],
    'Esmeraldas' : ['Esmeraldas', 'Atacames', 'Quinindé', 'Muisne', 'San Lorenzo'],
    'Guayas'     : ['Guayaquil', 'Durán', 'Samborondón', 'Daule', 'Milagro', 'Playas', 'Naranjal', 'El Triunfo', 'Yaguachi', 'Balzar'],
    'Imbabura'   : ['Ibarra', 'Otavalo', 'Cotacachi', 'Atuntaqui', 'Pimampiro'],
    'Loja'       : ['Loja', 'Catamayo', 'Macará', 'Cariamanga', 'Catacocha', 'Saraguro'],
    'Los Ríos'   : ['Babahoyo', 'Quevedo', 'Ventanas', 'Vinces', 'Buena Fe', 'Valencia', 'Mocache'],
    'Manabí'     : ['Manta', 'Portoviejo', 'Chone', 'Montecristi', 'Jipijapa', 'Pedernales', 'Bahía de Caráquez', 'El Carmen'],
    'Pichincha'  : ['Quito', 'Cayambe', 'Machachi', 'Sangolquí', 'Tabacundo', 'Pedro Vicente Maldonado'],
    'Santa Elena': ['Santa Elena', 'Salinas', 'La Libertad'],
    'Santo Domingo de los Tsáchilas': ['Santo Domingo', 'La Concordia'],
    'Tungurahua' : ['Ambato', 'Baños', 'Pelileo', 'Píllaro', 'Quero', 'Cevallos'],
  };

  /* ══════════════════════════════════════════════════════════════
     MATEMÁTICAS
  ═══════════════════════════════════════════════════════════════ */
  const round2 = v => Math.round(v * 100) / 100;
  const fmt    = (n, d = 2) =>
    Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  function pmt(principal, months) {
    if (principal <= 0 || months <= 0) return 0;
    const i   = ANNUAL_RATE / 12;
    const pow = Math.pow(1 + i, months);
    return principal * (i * pow) / (pow - 1);
  }

  // ── NUEVO MODELO: COMPRA DE CARTERA (cálculo inverso) ────────────
  //   Base       = Efectivo + Transporte + Sugerido
  //   Meta       = Base × 1.03            (lo que se quiere RECIBIR)
  //   NetoReal   = 1 − (%Cartera + 3.45%) (lo que Kamina entrega por $1 de crédito)
  //   Crédito    = Meta ÷ NetoReal        (valor a poner en la plataforma)
  function calcCartera(efectivo, transporte, sugerido, carteraRate) {
    const base     = efectivo + transporte + sugerido;
    const meta      = base * MARGIN_TARGET;
    const netoReal  = 1 - (carteraRate + HONORARIO);
    const creditoEx = netoReal > 0 ? meta / netoReal : 0;
    const credito   = Math.ceil(creditoEx - 1e-9); // ← entero superior cerrado ($329.81 → $330)
    return {
      base    : round2(base),
      meta    : round2(meta),
      netoReal,
      credito,          // entero
      creditoEx : round2(creditoEx), // exacto (por si se necesita)
    };
  }

  // Efectivo máximo ofrecible por línea (inverso del cupo), YA DESCONTADO el transporte:
  //   Cupo = crédito máx → base máx = cupo × neto ÷ 1.03 → efectivo = base − transporte
  //   El transporte depende del rango del efectivo (0/8/12/15/25), por eso se busca
  //   el ENTERO más alto cuyo crédito (efectivo + transporte, sin sugerido) entre en el cupo.
  //   Ej.: cupo $2,500 · Cat. 4 (30%) → base $1,615 → efectivo $1,590 (+ $25 transporte).
  function efectivoMaxPorCupo(cupo, carteraRate, sugerido = 0) {
    const netoReal = 1 - (carteraRate + HONORARIO);
    if (netoReal <= 0 || cupo <= 0) return 0;
    let ef = Math.floor((cupo * netoReal) / MARGIN_TARGET - sugerido);
    // El crédito crece con el efectivo → bajar hasta que entre (máx. ~26 pasos)
    while (ef > 0 && calcCartera(ef, transporteAuto(ef), sugerido, carteraRate).credito > cupo) ef--;
    return Math.max(0, ef);
  }

  // Tope de efectivo para Plan SIN INTERÉS: cupo ÷ 1.15 (entero inferior)
  function topeSinInteres(cupo) {
    if (cupo <= 0) return 0;
    let ef = Math.floor(cupo / (1 + PLAN_SI_RATE));
    while (ef > 0 && calcSinInteres(ef).valorCredito > cupo) ef--;
    return ef;
  }

  // Fórmula Plan SIN INTERÉS: crédito = C1 × 1.15  (efectivo $100 → crédito $115)
  function calcSinInteres(c1) {
    return { valorCredito: Math.ceil(c1 * (1 + PLAN_SI_RATE) - 1e-9) }; // ← entero superior
  }

  // Transporte automático por rango de efectivo (solo planes CON interés).
  //   300–500 → 8 | 501–800 → 12 | 801–1200 → 15 | 1201+ → 25 | <300 → 0
  function transporteAuto(efectivo) {
    if (efectivo <  300) return 0;
    if (efectivo <= 500) return 8;
    if (efectivo <= 800) return 12;
    if (efectivo <= 1200) return 15;
    return 25;
  }

  /* ══════════════════════════════════════════════════════════════
     LECTURA DEL DOM
  ═══════════════════════════════════════════════════════════════ */
  // Lee la categoría del sistema: puede ser número (1,2,3,4) o texto (PLUS, NEW).
  // Robusto ante saltos de línea y nodos separados (el valor suele ir en un span aparte).
  function readCategoria() {
    // 1) Barrido de elementos pequeños que contengan "Categoría"
    for (const el of document.querySelectorAll('*')) {
      const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 60) continue;
      if (!/categor[íi]a/i.test(txt)) continue;
      const m = txt.match(/categor[íi]a\s*[:\-]?\s*(plus|new|\d+)/i);
      if (m) return m[1].toUpperCase();
    }
    // 2) Fallback: buscar en todo el body por si está muy fragmentado
    const body = (document.body.innerText || '').replace(/\s+/g, ' ');
    const bm = body.match(/categor[íi]a\s*[:\-]?\s*(plus|new|\d+)/i);
    if (bm) return bm[1].toUpperCase();
    return null;
  }

  // Devuelve el %Compra de Cartera según la categoría detectada
  function getCarteraRate() {
    const cat = readCategoria();
    return (cat && CARTERA_BY_CAT[cat] !== undefined) ? CARTERA_BY_CAT[cat] : CARTERA_DEFAULT;
  }

  function maxMonthsByName(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('sin inter'))                                           return 6;
    if (n.includes('televis'))                                             return 12;
    if (n.includes('blanca') || n.includes('blanco'))                     return 12;
    if (n.includes('laptop') || n.includes('pc') || n.includes('comp'))   return 12;
    return 24; // Genérica u otras
  }

  function isSI(name) { return (name || '').toLowerCase().includes('sin inter'); }

  function readLines() {
    const result = [], seen = new Set();
    document.querySelectorAll('div,span,li,article,section').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (rect.width > 500 || rect.height > 250) return;
      const txt = (el.innerText || '').trim();
      if (txt.length < 12 || txt.length > 220) return;
      if (!txt.includes('Entrada') || !txt.includes('%')) return;
      if (!/\$[\d]/.test(txt)) return;
      const cupoM = txt.match(/\$([\d,]+(?:\.\d+)?)/);
      const entM  = txt.match(/Entrada\s+(\d+)\s*%/i);
      if (!cupoM || !entM) return;
      const rows    = txt.split('\n').map(s => s.trim()).filter(s => s);
      const name    = rows.find(s => !s.startsWith('$') && !/Entrada|Descuento/i.test(s)) || 'Línea';
      const cupo    = parseFloat(cupoM[1].replace(/,/g, ''));
      const entPct  = parseInt(entM[1]);
      const descM   = txt.match(/Descuento\s+(\d+)\s*%/i);
      const descPct = descM ? parseInt(descM[1]) : 0;
      const key     = name.trim() + '_' + cupo;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ el, name: name.trim(), cupo, entPct, descPct, maxMonths: maxMonthsByName(name) });
    });
    return result;
  }

  /* ══════════════════════════════════════════════════════════════
     CSS
  ═══════════════════════════════════════════════════════════════ */
  const CSS = `
  #cdd {
    position:fixed;right:12px;top:60px;width:326px;z-index:2147483647;
    font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#132033;
    border-radius:14px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.32);
  }
  #cdd-head {
    background:linear-gradient(135deg,#0d1e38,#0a3069);color:#fff;
    padding:8px 11px;display:flex;align-items:center;gap:6px;
    cursor:move;user-select:none;transition:background .25s;
  }
  #cdd-head.flash{background:#1f5fd1!important;}
  #cdd-head-title{flex:1;font-weight:700;font-size:12px;line-height:1.15;}
  .cdd-ver{font-size:9px;background:rgba(255,255,255,.14);border-radius:999px;padding:2px 6px;color:#9ac4ff;}
  .cdd-hbtn{background:rgba(255,255,255,.12);border:none;color:#fff;width:22px;height:22px;
    border-radius:50%;cursor:pointer;font-size:11px;display:flex;align-items:center;
    justify-content:center;padding:0;font-family:inherit;}
  .cdd-hbtn:hover{background:rgba(255,255,255,.28);}
  .cdd-hbtn-limpiar{background:rgba(255,120,80,.22);border:none;color:#ffcbbf;height:22px;
    border-radius:999px;cursor:pointer;font-size:9px;font-weight:700;padding:0 8px;
    display:flex;align-items:center;white-space:nowrap;font-family:inherit;letter-spacing:.2px;
    transition:background .15s;}
  .cdd-hbtn-limpiar:hover{background:rgba(255,90,50,.45);color:#fff;}

  /* Nota de rangos DENTRO del header (compacta) */
  #cdd-head-rangos{background:linear-gradient(135deg,#0a3069,#0d1e38);
    padding:0 11px 8px;display:flex;flex-wrap:wrap;gap:5px;}
  #cdd-head-rangos .hr{flex:1 1 auto;font-size:9px;color:#cfe0fb;background:rgba(255,255,255,.09);
    border-radius:6px;padding:3px 7px;white-space:nowrap;text-align:center;}
  #cdd-head-rangos .hr b{color:#fff;}
  #cdd-head-rangos .hr.si{color:#bff0d1;}
  #cdd-head-rangos .hr.si b{color:#daffe9;}

  /* Buscador de ciudades que aplican a crédito (compacto) */
  #cdd-city{margin-bottom:8px;}
  #cdd-city-in{width:100%;box-sizing:border-box;border:1.5px solid #ccdaf0;background:#fff;
    border-radius:8px;padding:5px 9px;font-size:11px;font-family:inherit;color:#132033;outline:none;}
  #cdd-city-in:focus{border-color:#1f5fd1;}
  #cdd-city-res{display:flex;flex-wrap:wrap;gap:4px;}
  #cdd-city-res:not(:empty){margin-top:5px;}
  .cdd-city-ok{background:#e8f6ee;border:1px solid #8ecbab;color:#0b6033;border-radius:6px;
    padding:2px 7px;font-size:10.5px;font-weight:700;white-space:nowrap;}
  .cdd-city-ok span{font-weight:400;color:#2e7a52;}
  .cdd-city-more{font-size:10px;color:#6b7a8f;padding:2px 4px;}
  #cdd-body{background:#f2f6fd;padding:10px 11px 12px;max-height:80vh;overflow-y:auto;}

  #cdd-lines{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;align-items:flex-start;position:relative;padding-right:24px;}
  .cdd-lbtn{border:2px solid #ccdaf0;background:#fff;border-radius:9px;
    padding:4px 8px;cursor:pointer;font-size:10.5px;font-weight:700;
    color:#1748a8;line-height:1.2;text-align:left;transition:all .13s;font-family:inherit;}
  .cdd-lbtn:hover{border-color:#1f5fd1;background:#e8f0fc;}
  .cdd-lbtn.active{background:#1f5fd1;color:#fff;border-color:#1f5fd1;}
  .cdd-lbtn small{display:block;font-weight:400;opacity:.75;font-size:9.5px;}
  .cdd-lbtn .cdd-lmax{display:block;font-size:10px;font-weight:800;color:#0b6033;margin-top:1px;}
  .cdd-lbtn .cdd-lmax.nocat{color:#b71c1c;}
  .cdd-lbtn.active .cdd-lmax{color:#c8ffd9;}
  .cdd-lbtn.active .cdd-lmax.nocat{color:#ffd0c9;}
  .cdd-lbtn.active small{opacity:.9;}
  .cdd-lbtn.si{border-color:#8ecbab;color:#0b6033;}
  .cdd-lbtn.si.active{background:#0b6033;border-color:#0b6033;color:#fff;}
  #cdd-refresh{position:absolute;top:0;right:0;border:1.5px dashed #ccdaf0;background:#fff;
    border-radius:8px;width:22px;height:22px;padding:0;cursor:pointer;font-size:11px;
    color:#6b7a90;font-family:inherit;transition:all .13s;display:flex;align-items:center;
    justify-content:center;line-height:1;}
  #cdd-refresh:hover{border-color:#1f5fd1;color:#1f5fd1;border-style:solid;}

  /* Nota de rangos de crédito */
  #cdd-rangos{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 10px;}
  .cdd-rango{flex:1 1 auto;font-size:10px;color:#3a4a60;background:#eef3fb;
    border:1px solid #d5e0f2;border-radius:8px;padding:5px 8px;white-space:nowrap;}
  .cdd-rango strong{color:#132033;}
  .cdd-rango.si{background:#e8f6ee;border-color:#b5ddc6;color:#0b6033;}
  .cdd-rango.si strong{color:#0b6033;}

  /* Fila de 3 inputs */
  .cdd-r3-in{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:4px;}

  /* Caja de valor de crédito (resultado principal) */
  .cdd-cred-box{background:linear-gradient(135deg,#0d1e38,#0a3069);border-radius:10px;
    padding:8px 12px;margin:7px 0 6px;text-align:center;position:relative;}
  .cdd-cred-k{font-size:9px;color:#9ac4ff;font-weight:700;text-transform:uppercase;
    letter-spacing:.4px;margin-bottom:2px;}
  .cdd-cred-row{display:flex;align-items:center;justify-content:center;gap:10px;}
  .cdd-cred-v{font-size:25px;font-weight:800;color:#fff;line-height:1;}
  .cdd-cred-cp{background:rgba(255,255,255,.14);border:none;color:#fff;
    border-radius:7px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;
    font-family:inherit;transition:background .15s;white-space:nowrap;}
  .cdd-cred-cp:hover{background:rgba(255,255,255,.3);}
  .cdd-cred-cp.copied{background:#0b6033!important;}
  /* Caja de crédito verde para Plan SIN INTERÉS */
  .cdd-cred-box.si-green{background:linear-gradient(135deg,#0b6033,#0a7a3a);}
  .cdd-cred-box.si-green .cdd-cred-k{color:#c8ffd9;}
  /* Estado bloqueado (sin categoría) */
  .cdd-cred-box.blocked{background:linear-gradient(135deg,#7a1c1c,#4a0f0f);}
  .cdd-cred-box.blocked .cdd-cred-v{font-size:16px;letter-spacing:.5px;}
  .cdd-cred-box.blocked .cdd-cred-k{color:#ffc9c2;}
  .cdd-cred-cp:disabled{opacity:.4;cursor:not-allowed;}

  /* Badge de categoría del cliente (arriba) */
  #cdd-cat-row{display:flex;align-items:center;gap:5px;margin:0 0 6px;}
  #cdd-cat-badge{display:none;flex:1;align-items:center;gap:4px;min-width:0;
    background:linear-gradient(135deg,#1748a8,#0a3069);color:#fff;border-radius:6px;
    padding:2px 7px;font-size:8.5px;font-weight:700;letter-spacing:.2px;white-space:nowrap;overflow:hidden;}
  #cdd-cat-badge.on{display:flex;}
  #cdd-cat-badge.nodetect{background:#fdecea;color:#b71c1c;border:1px solid #f5a5a0;}
  #cdd-cat-badge .cb-tag{background:rgba(255,255,255,.18);border-radius:999px;
    padding:0 6px;font-size:8.5px;}
  #cdd-btn-resumen{flex:0 0 auto;width:26px;height:22px;border-radius:6px;border:1.5px solid #c8d8ee;
    background:#fff;cursor:pointer;font-size:12px;line-height:1;padding:0;}
  #cdd-btn-resumen:hover{border-color:#1f5fd1;background:#eef4ff;}
  #cdd-btn-resumen.ok{background:#0b6033;border-color:#0b6033;color:#fff;}
  #cdd-btn-resumen.err{background:#fdecea;border-color:#f5a5a0;}
  #cdd-cat-badge.nodetect .cb-tag{background:rgba(183,28,28,.12);}

  #cdd-info{background:#e5f3ec;border:1px solid #8ecbab;border-radius:9px;
    padding:7px 10px;font-size:11px;color:#0b6033;font-weight:700;margin-bottom:9px;display:none;}
  #cdd-warn{background:#fdecea;border:1px solid #f5a5a0;border-radius:9px;
    padding:7px 10px;font-size:11px;color:#b71c1c;font-weight:700;margin-bottom:9px;display:none;}
  #cdd-warn.on{display:block;}

  /* Banner Plan SIN INTERÉS */
  #cdd-si-banner{background:linear-gradient(135deg,#e8f6ee,#d5ede0);border:1px solid #8ecbab;
    border-radius:10px;padding:10px 13px;margin-bottom:10px;display:none;}
  #cdd-si-banner.on{display:block;}
  .cdd-si-title{font-weight:800;font-size:12px;color:#0b6033;margin-bottom:4px;}
  .cdd-si-val{font-size:22px;font-weight:800;color:#0b6033;line-height:1.1;}
  .cdd-si-sub{font-size:10.5px;color:#4a7a62;margin-top:2px;}

  .cdd-r2{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px;}
  .cdd-f label{display:block;font-size:10.5px;font-weight:700;color:#5a6b80;
    text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px;}
  .cdd-f input,.cdd-f select{width:100%;border:1.5px solid #cfdcf1;border-radius:8px;
    padding:7px 9px;font-size:15px;font-family:inherit;background:#fff;color:#132033;
    outline:none;box-sizing:border-box;transition:border-color .14s;}
  .cdd-f input:focus,.cdd-f select:focus{border-color:#1f5fd1;}
  .cdd-f input[readonly]{background:#edf1f9;color:#5a6b80;cursor:not-allowed;font-weight:700;}
  .cdd-f input.over{border-color:#d93025!important;background:#fff3f2;}
  /* SELECT bloqueado */
  .cdd-f select:disabled{background:#edf1f9;color:#6b7a90;border-color:#c8d8ee;
    cursor:not-allowed;pointer-events:none;}
  /* Ícono de candado en la etiqueta */
  .cdd-lbl-lock::after{content:' 🔒';font-size:9px;opacity:.65;}
  .cdd-hint{font-size:10px;color:#1748a8;margin-top:2px;min-height:14px;}

  /* Cajas resultado */
  .cdd-res3{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin:3px 0 4px;}
  .cdd-rbox{background:#f3f6fa;border:1px solid #e6ecf3;border-radius:5px;padding:1px 4px;text-align:center;}
  .cdd-rbox.ent{background:#f7f2e6;border-color:#e6dcc0;}
  .cdd-rk{font-size:6.5px;color:#a3afbd;font-weight:700;text-transform:uppercase;letter-spacing:.2px;margin-bottom:0;}
  .cdd-rv{font-size:9px;font-weight:700;color:#98a4b3;line-height:1.1;}
  .cdd-rbox.ent .cdd-rv{color:#b08a4a;}
  .cdd-asist-row{font-size:11px;color:#6b7a90;text-align:center;margin-bottom:9px;}
  .cdd-asist-row strong{color:#132033;}

  /* Tabla — oculta permanentemente, no se usa */
  #cdd-tbl{display:none;width:100%;border-collapse:separate;border-spacing:0;border-radius:11px;overflow:hidden;}
  .cdd-note{display:none;font-size:9.5px;color:#9aabb8;text-align:center;margin-top:8px;line-height:1.5;}

  /* Botón Copiar Cuotas */
  #cdd-wrap-copiar{margin-top:10px;display:none;}
  /* Tarjeta de entrada inline (sobre Copiar Cuotas) */
  #cdd-entrada-inline{display:none;border-radius:10px;padding:9px 12px;margin:2px 0 8px;
    text-align:center;}
  #cdd-entrada-inline.on{display:block;}
  #cdd-entrada-inline.ent{background:linear-gradient(135deg,#c0201c,#8a0f0c);color:#fff;
    animation:cddPulse 1.6s ease-in-out infinite;}
  #cdd-entrada-inline.noent{background:#e8f6ee;border:1px solid #8ecbab;color:#0b6033;}
  #cdd-entrada-inline .ei-k{font-size:10px;font-weight:800;letter-spacing:.3px;}
  #cdd-entrada-inline.ent .ei-k{color:#ffd9d5;}
  #cdd-entrada-inline .ei-v{font-size:22px;font-weight:900;line-height:1.1;margin:1px 0;}
  #cdd-entrada-inline .ei-sub{font-size:9.5px;opacity:.9;}
  .cdd-copiar-btn{width:100%;padding:10px 12px;border:none;border-radius:9px;
    background:linear-gradient(135deg,#1748a8,#0a3069);color:#fff;font-size:13px;font-weight:700;
    cursor:pointer;font-family:inherit;letter-spacing:.4px;transition:background .18s,transform .1s;}
  .cdd-copiar-btn:hover{background:linear-gradient(135deg,#1f5fd1,#1748a8);}
  .cdd-copiar-btn:active{transform:scale(.98);}
  .cdd-copiar-btn.copied{background:linear-gradient(135deg,#0b6033,#0a7a3a)!important;}

  /* Caja Factura + Cuotas (Plan SIN INTERÉS, producto de mayor valor) — sutil */
  #cdd-abono-box{display:none;margin:4px 0 8px;}
  #cdd-abono-box.on{display:block;}
  .cdd-sub-row{display:grid;grid-template-columns:1fr 1fr;gap:5px;}
  .cdd-sub-box{border-radius:7px;padding:5px 7px;text-align:center;}
  .cdd-sub-box.entrada{background:#fdf1f0;border:1px solid #f0c4be;}
  .cdd-sub-box.factura{background:#eef5ef;border:1px solid #bcd9c6;}
  .cdd-sub-k{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.2px;margin-bottom:1px;}
  .cdd-sub-box.entrada .cdd-sub-k{color:#b06a63;}
  .cdd-sub-box.factura .cdd-sub-k{color:#5a8a6c;}
  .cdd-sub-v{font-size:14px;font-weight:800;line-height:1.05;}
  .cdd-sub-box.entrada .cdd-sub-v{color:#c0201c;}
  .cdd-sub-box.factura .cdd-sub-v{color:#0b6033;}
  .cdd-ab-det{font-size:9.5px;color:#b06a63;text-align:center;margin-top:3px;}
  .cdd-ab-det:empty{display:none;}
  .cdd-sub-cuota{margin-top:5px;font-size:11px;color:#1748a8;font-weight:700;
    text-align:center;background:#eef3fb;border:1px solid #d5e0f2;border-radius:7px;padding:4px 7px;}
  .cdd-sub-cuota span{font-weight:800;}

  /* Caja Alcance + Factura (planes con interés, producto supera el cupo) */
  #cdd-alc-box{display:none;margin:4px 0 8px;}
  #cdd-alc-box.on{display:block;}
  .cdd-fact-box{background:#e8f6ed;border:1.5px solid #2e9d5b;border-radius:8px;padding:5px 10px;
    display:flex;align-items:center;justify-content:space-between;gap:8px;}
  .cdd-fact-k{font-size:9.5px;font-weight:800;color:#0b6033;text-transform:uppercase;letter-spacing:.3px;}
  .cdd-fact-v{font-size:15px;font-weight:900;color:#0b6033;line-height:1;white-space:nowrap;}
  #cdd-entrada-inline .ei-det{margin:6px 0 0;padding-top:5px;border-top:1px solid rgba(255,255,255,.35);
    text-align:left;font-size:10px;opacity:.88;}
  #cdd-entrada-inline .ei-det-row{display:flex;justify-content:space-between;gap:8px;padding:1px 2px;}
  #cdd-entrada-inline .ei-det-row b{font-weight:700;white-space:nowrap;}
  .cdd-f input.na{background:#edf1f9;color:#9aabb8;text-decoration:line-through;}

  #cdd-open{position:fixed;right:14px;top:68px;z-index:2147483646;
    background:linear-gradient(135deg,#0d1e38,#0a3069);color:#fff;border:none;
    border-radius:999px;padding:8px 15px;font-size:12px;font-weight:700;cursor:pointer;
    box-shadow:0 4px 18px rgba(0,0,0,.35);display:none;font-family:inherit;}
  #cdd-open:hover{background:#1f5fd1;}
  @keyframes cddPulse{0%,100%{box-shadow:0 4px 14px rgba(180,0,0,.35);}
    50%{box-shadow:0 4px 22px rgba(255,40,30,.6);}}
  `;

  /* ══════════════════════════════════════════════════════════════
     HTML DEL PANEL
  ═══════════════════════════════════════════════════════════════ */
  const PANEL_HTML = `
    <div id="cdd-head">
      <span id="cdd-head-title">💳 Crédito Directo Digital</span>
      <span class="cdd-ver">v3.15.0</span>
      <button class="cdd-hbtn-limpiar" id="cdd-btn-limpiar">🗑️</button>
      <button class="cdd-hbtn" id="cdd-btn-min">—</button>
      <button class="cdd-hbtn" id="cdd-btn-close">✕</button>
    </div>
    <div id="cdd-head-rangos">
      <span class="hr si">🟢 SIN INTERÉS <b>$30–$400</b></span>
      <span class="hr">🔵 Otras <b>$300–$2,500</b></span>
    </div>
    <div id="cdd-body">

      <!-- Buscador: ciudades que aplican a crédito -->
      <div id="cdd-city">
        <input id="cdd-city-in" type="text" autocomplete="off" spellcheck="false"
               placeholder="🔍 Ciudad del cliente… (¿aplica a crédito?)">
        <div id="cdd-city-res"></div>
      </div>

      <!-- Botones de línea -->
      <div id="cdd-lines">
        <span style="font-size:11px;color:#8a97a8">Detectando líneas…</span>
      </div>

      <!-- Badge de categoría del cliente (visible arriba) -->
      <div id="cdd-cat-row">
        <div id="cdd-cat-badge"></div>
        <button id="cdd-btn-resumen" title="Copiar resumen para facturar (cliente, factura, entrada)">📝</button>
      </div>

      <div id="cdd-info"></div>
      <div id="cdd-warn">⚠️ El valor supera el cupo aprobado para esta línea.</div>

      <!-- Banner Plan SIN INTERÉS (oculto por defecto) -->
      <div id="cdd-si-banner">
        <div class="cdd-si-title">🟢 Plan SIN INTERÉS · 0% interés · 0% entrada</div>
        <div class="cdd-si-val">$<span id="cdd-si-vc">0.00</span></div>
        <div class="cdd-si-sub">Valor crédito = (Efectivo + Sugerido) × 1.15</div>
      </div>

      <!-- Inputs -->
      <div class="cdd-r3-in">
        <div class="cdd-f" id="cdd-efec-cell">
          <label>Efectivo</label>
          <input id="cdd-c1" type="number" min="0" step="1" placeholder="0">
        </div>
        <div class="cdd-f">
          <label>Transporte</label>
          <input id="cdd-transp" type="number" min="0" step="1" placeholder="0" readonly>
        </div>
        <div class="cdd-f">
          <label>Sugerido</label>
          <input id="cdd-c2" type="number" min="0" step="1" placeholder="0">
        </div>
      </div>
      <div class="cdd-hint" id="cdd-sug-hint"></div>
      <div class="cdd-hint" id="cdd-hint"></div>

      <!-- Cajas resultado modo CARTERA (ocultas en modo SI) -->
      <div id="cdd-wrap-results">
        <div class="cdd-cred-box">
          <div class="cdd-cred-k">💳 VALOR CRÉDITO A CALCULAR</div>
          <div class="cdd-cred-row">
            <div class="cdd-cred-v">$<span id="cdd-rcred">—</span></div>
            <button id="cdd-btn-cred" class="cdd-cred-cp">📋 Copiar</button>
          </div>
        </div>
        <div class="cdd-res3">
          <div class="cdd-rbox">
            <div class="cdd-rk">Base</div>
            <div class="cdd-rv">$<span id="cdd-rbase">—</span></div>
          </div>
          <div class="cdd-rbox ent">
            <div class="cdd-rk">A Recibir (103%)</div>
            <div class="cdd-rv">$<span id="cdd-rmeta">—</span></div>
          </div>
          <div class="cdd-rbox">
            <div class="cdd-rk">Neto Kamina</div>
            <div class="cdd-rv"><span id="cdd-rneto">—</span>%</div>
          </div>
        </div>
        <span id="cdd-cat-lbl" style="display:none;"></span>
      </div>

      <!-- Caja Alcance + Factura (planes con interés, producto supera el cupo) -->
      <div id="cdd-alc-box">
        <div class="cdd-fact-box">
          <div class="cdd-fact-k">🧾 Valor a facturar</div>
          <div class="cdd-fact-v">$<span id="cdd-alc-fact">—</span></div>
        </div>
      </div>

      <!-- Caja Factura + Cuotas (Plan SIN INTERÉS, producto de mayor valor) -->
      <div id="cdd-abono-box">
        <div class="cdd-sub-row">
          <div class="cdd-sub-box entrada">
            <div class="cdd-sub-k">🔴 Entrada Kissu</div>
            <div class="cdd-sub-v">$<span id="cdd-ab-abono">—</span></div>
          </div>
          <div class="cdd-sub-box factura">
            <div class="cdd-sub-k">🧾 Valor factura</div>
            <div class="cdd-sub-v">$<span id="cdd-ab-fact">—</span></div>
          </div>
        </div>
        <div class="cdd-ab-det" id="cdd-ab-det"></div>
        <div class="cdd-sub-cuota">📅 <span id="cdd-ab-cuota">—</span></div>
      </div>

      <!-- Aviso de monto de entrada (calculado) -->
      <div id="cdd-entrada-inline"></div>

      <!-- Botón Copiar Cuotas -->
      <div id="cdd-wrap-copiar">
        <button id="cdd-btn-copiar" class="cdd-copiar-btn">📋 Copiar Cuotas</button>
      </div>

      <!-- Tabla cuotas -->
      <table id="cdd-tbl">
        <thead>
          <tr>
            <th>Plazo</th><th class="r">Cuota</th>
            <th class="r">Total crédito</th><th></th>
          </tr>
        </thead>
        <tbody id="cdd-tbody"></tbody>
      </table>
      <div class="cdd-note" id="cdd-foot">
        Cuota = PMT(financiado, n, 15.59%) + Asistencia/n
      </div>

    </div>
  `;

  /* ══════════════════════════════════════════════════════════════
     ESTADO
  ═══════════════════════════════════════════════════════════════ */
  let currentLine = null;
  let panel       = null;
  let reopener    = null;
  let minimized   = false;
  let siMode      = false;
  let alcanceState = null; // {entradaFinal} cuando el producto supera el cupo (planes con interés)
  let siCuotaState = null; // cuota quincenal del Plan SIN INTERÉS (para copiar)
  let resumenState = null; // datos para el botón 📝 (copiar resumen para facturar)

  /* ══════════════════════════════════════════════════════════════
     INYECCIÓN
  ═══════════════════════════════════════════════════════════════ */
  function inject() {
    if (document.getElementById('cdd')) return;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    reopener = document.createElement('button');
    reopener.id = 'cdd-open';
    reopener.textContent = '💳 CDD';
    document.body.appendChild(reopener);
    reopener.addEventListener('click', () => { panel.style.display = ''; reopener.style.display = 'none'; });

    panel = document.createElement('div');
    panel.id = 'cdd';
    panel.innerHTML = PANEL_HTML;
    document.body.appendChild(panel);

    setupDrag();
    setupControls();
    startCuotasWatcher();
    setTimeout(refreshLines, 700);
  }

  /* ══════════════════════════════════════════════════════════════
     DRAG
  ═══════════════════════════════════════════════════════════════ */
  function setupDrag() {
    const head = document.getElementById('cdd-head');
    let dragging = false, ox = 0, oy = 0;
    head.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      panel.style.right = 'auto';
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      panel.style.left = Math.max(0, Math.min(e.clientX - ox, window.innerWidth  - panel.offsetWidth))  + 'px';
      panel.style.top  = Math.max(0, Math.min(e.clientY - oy, window.innerHeight - panel.offsetHeight)) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  /* ══════════════════════════════════════════════════════════════
     LIMPIAR PANEL — resetea todos los campos y resultados
  ═══════════════════════════════════════════════════════════════ */
  function limpiarPanel() {
    // Resetear estado global
    currentLine = null;
    siMode      = false;

    // Desmarcar botones de línea
    document.querySelectorAll('.cdd-lbtn').forEach(b => b.classList.remove('active'));

    // Limpiar inputs
    document.getElementById('cdd-c1').value     = '';
    document.getElementById('cdd-transp').value = '';
    document.getElementById('cdd-c2').value     = '';
    document.getElementById('cdd-c1').classList.remove('over');
    document.getElementById('cdd-c2').classList.remove('na');
    const abonoBox = document.getElementById('cdd-abono-box');
    if (abonoBox) abonoBox.classList.remove('on');
    const alcBox = document.getElementById('cdd-alc-box');
    if (alcBox) alcBox.classList.remove('on');
    alcanceState = null;
    siCuotaState = null;
    resumenState = null;
    document.getElementById('cdd-wrap-copiar').style.display = 'none';

    // Ocultar banners e info
    document.getElementById('cdd-info').style.display = 'none';
    document.getElementById('cdd-warn').classList.remove('on');
    hideEntradaAlert();
    document.getElementById('cdd-hint').textContent = '';
    const sugH = document.getElementById('cdd-sug-hint');
    if (sugH) sugH.textContent = '';

    // Resetear modo SIN INTERÉS
    setSIMode(false);
    document.getElementById('cdd-si-vc').textContent = '0.00';

    // Resetear cajas resultado
    ['cdd-rcred','cdd-rbase','cdd-rmeta','cdd-rneto'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    document.getElementById('cdd-cat-lbl').textContent = '';
    const catBadge = document.getElementById('cdd-cat-badge');
    if (catBadge) { catBadge.className = ''; catBadge.innerHTML = ''; }

    // Vaciar tabla
    document.getElementById('cdd-tbody').innerHTML = '';

    // Resetear botón copiar
    const btnCopiar = document.getElementById('cdd-btn-copiar');
    if (btnCopiar) { btnCopiar.textContent = '📋 Copiar Cuotas'; btnCopiar.classList.remove('copied'); }

    // Limpiar buscador de ciudades
    limpiarCiudad();
  }

  /* ══════════════════════════════════════════════════════════════
     BUSCADOR DE CIUDADES QUE APLICAN A CRÉDITO
     Ignora tildes/mayúsculas. Solo muestra lo que aplica;
     si no hay coincidencia no aparece nada.
  ═══════════════════════════════════════════════════════════════ */
  const normCity = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const CITY_ABREV = { 'sto': 'santo', 'sta': 'santa', 'gye': 'guayaquil', 'uio': 'quito' };

  // Índice plano: [{ciudad, provincia, nCiudad, hay}]
  const CITY_INDEX = [];
  Object.entries(CIUDADES_CREDITO).forEach(([prov, ciudades]) => {
    ciudades.forEach(c => CITY_INDEX.push({
      ciudad: c, provincia: prov, nCiudad: normCity(c), hay: normCity(c + ' ' + prov),
    }));
  });

  function buscarCiudades(q) {
    const tokens = normCity(q).split(' ').filter(Boolean).map(t => CITY_ABREV[t] || t);
    const full   = tokens.join(' ');
    if (full.length < 2) return [];
    const res = [];
    CITY_INDEX.forEach(e => {
      if (!tokens.every(t => e.hay.includes(t))) return;
      // Orden: ciudad empieza igual → palabra de la ciudad empieza igual → contiene → solo por provincia
      let score = 3;
      if (e.nCiudad.startsWith(full))                                   score = 0;
      else if (e.nCiudad.split(' ').some(w => w.startsWith(tokens[0]))) score = 1;
      else if (e.nCiudad.includes(tokens[0]))                           score = 2;
      res.push({ ...e, score });
    });
    return res.sort((a, b) => a.score - b.score);
  }

  function renderCiudades() {
    const inp = document.getElementById('cdd-city-in');
    const box = document.getElementById('cdd-city-res');
    if (!inp || !box) return;
    const MAX = 8;
    const res = buscarCiudades(inp.value);
    box.innerHTML = '';
    res.slice(0, MAX).forEach(e => {
      const chip = document.createElement('div');
      chip.className = 'cdd-city-ok';
      chip.innerHTML = `✅ ${e.ciudad} <span>· ${e.provincia}</span>`;
      box.appendChild(chip);
    });
    if (res.length > MAX) {
      const more = document.createElement('div');
      more.className = 'cdd-city-more';
      more.textContent = `+${res.length - MAX} más…`;
      box.appendChild(more);
    }
  }

  function limpiarCiudad() {
    const inp = document.getElementById('cdd-city-in');
    if (inp) inp.value = '';
    renderCiudades();
  }

  /* ══════════════════════════════════════════════════════════════
     CONTROLES
  ═══════════════════════════════════════════════════════════════ */
  function setupControls() {
    document.getElementById('cdd-btn-min').addEventListener('click', () => {
      minimized = !minimized;
      document.getElementById('cdd-body').style.display = minimized ? 'none' : '';
      document.getElementById('cdd-btn-min').textContent = minimized ? '▢' : '—';
    });
    document.getElementById('cdd-btn-close').addEventListener('click', () => {
      panel.style.display = 'none';
      reopener.style.display = 'block';
    });
    document.getElementById('cdd-btn-limpiar').addEventListener('click', limpiarPanel);
    document.getElementById('cdd-btn-copiar').addEventListener('click', copiarCuotas);
    document.getElementById('cdd-c1').addEventListener('input', update);
    document.getElementById('cdd-c2').addEventListener('input', update);
    // Al enfocar un campo numérico editable, seleccionar todo para escribir encima sin borrar
    ['cdd-c1', 'cdd-c2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('focus', () => { try { el.select(); } catch (_) {} });
    });
    document.getElementById('cdd-btn-cred').addEventListener('click', copiarCredito);
    document.getElementById('cdd-btn-resumen').addEventListener('click', copiarResumen);
    // Buscador de ciudades
    const cityIn = document.getElementById('cdd-city-in');
    cityIn.addEventListener('input', renderCiudades);
    cityIn.addEventListener('keydown', e => {
      e.stopPropagation(); // que los atajos de la página no interfieran al escribir
      if (e.key === 'Escape') limpiarCiudad();
    });
    update();
  }

  // Pinta el badge de categoría arriba, independiente del modo (cartera / SI)
  function paintCatBadge() {
    const catBadge = document.getElementById('cdd-cat-badge');
    if (!catBadge) return;
    const CAT_NOMBRE = { 'PLUS':'AAA', '1':'AA', '2':'A', '3':'B', '4':'C', 'NEW':'INCLUSIÓN' };
    const cat  = readCategoria();
    const rate = getCarteraRate();
    if (cat) {
      const nombre = CAT_NOMBRE[cat] ? ' ('+CAT_NOMBRE[cat]+')' : '';
      catBadge.className = 'on';
      catBadge.innerHTML = `👤 Categoría <span class="cb-tag">${cat}${nombre}</span> <span class="cb-tag">Cartera ${(rate * 100).toFixed(0)}%</span>`;
    } else {
      catBadge.className = 'on nodetect';
      catBadge.innerHTML = `⚠️ Categoría no detectada <span class="cb-tag">usando ${(rate * 100).toFixed(0)}%</span>`;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     REFRESH DE LÍNEAS
  ═══════════════════════════════════════════════════════════════ */
  function refreshLines() {
    paintCatBadge();
    const lines     = readLines();
    const container = document.getElementById('cdd-lines');
    if (!container) return;
    container.innerHTML = '';

    if (!lines.length) {
      container.innerHTML = '<span style="font-size:11px;color:#8a97a8">No se detectaron líneas.</span>';
    } else {
      const catRate = getCarteraRate();
      const catOk   = readCategoria() !== null;
      lines.forEach(line => {
        const btn = document.createElement('button');
        const si  = isSI(line.name);
        btn.className = 'cdd-lbtn' + (si ? ' si' : '');

        // Efectivo máximo ofrecible según el cupo de la línea
        let efMax;
        if (si) {
          // Plan SIN INTERÉS: crédito = efectivo × 1.15 → efectivo = cupo ÷ 1.15
          efMax = topeSinInteres(line.cupo);
        } else if (catOk) {
          efMax = efectivoMaxPorCupo(line.cupo, catRate);
        } else {
          efMax = null; // sin categoría no se puede calcular el máximo
        }

        const maxTxt = (efMax !== null)
          ? `<b class="cdd-lmax">💵 hasta $${fmt(efMax, 0)}</b>`
          : `<b class="cdd-lmax nocat">💵 s/categoría</b>`;

        btn.innerHTML = `${line.name}<small>Cupo $${fmt(line.cupo, 0)}</small>${maxTxt}`;
        btn.addEventListener('click', () => { selectLine(line); abrirSimuladorKamina(line); });
        container.appendChild(btn);
        attachKaminaCard(line);
      });
    }

    const rbtn = document.createElement('button');
    rbtn.id = 'cdd-refresh';
    rbtn.textContent = '🔄';
    rbtn.title = 'Redetectar líneas';
    rbtn.addEventListener('click', refreshLines);
    container.appendChild(rbtn);
  }

  /* ══════════════════════════════════════════════════════════════
     TARJETAS KAMINA  (hover azul + clic selecciona)
  ═══════════════════════════════════════════════════════════════ */
  function attachKaminaCard(line) {
    const el = line.el;
    if (!el || el._cddBound) return;
    el._cddBound = true;
    el.style.cursor = 'pointer';
    el.style.transition = 'outline .12s';
    el.addEventListener('mouseenter', () => { el.style.outline = '2.5px solid #1f5fd1'; el.style.outlineOffset = '2px'; });
    el.addEventListener('mouseleave', () => { el.style.outline = ''; });
    el.addEventListener('click', () => {
      selectLine(line);
      const h = document.getElementById('cdd-head');
      if (h) { h.classList.add('flash'); setTimeout(() => h.classList.remove('flash'), 350); }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     ABRIR SIMULADOR DE KAMINA CON LA LÍNEA ELEGIDA
     Clic en un botón de línea del panel →
       1) si el "Simulador de cuotas" no está abierto, pulsa el ícono $ de esa tarjeta
       2) en "Línea de producto" elige la misma línea (si no viene ya elegida)
  ═══════════════════════════════════════════════════════════════ */
  const normTxt = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                                 .replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep   = ms => new Promise(r => setTimeout(r, ms));
  const isVis   = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inPanel = el => !!(panel && panel.contains(el));
  let simRun = 0;

  async function waitFor(fn, timeout = 3000, step = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = fn();
      if (r) return r;
      await sleep(step);
    }
    return null;
  }

  // Clic "completo" (sirve para Angular Material y MUI, que abren con mousedown o click)
  function fireClick(el) {
    ['mousedown', 'mouseup', 'click'].forEach(type =>
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 })));
  }

  // Devuelve el contenedor del modal "Simulador de cuotas" si está visible
  function findSimulador() {
    for (const el of document.querySelectorAll('body *')) {
      if (el.childElementCount > 2 || inPanel(el) || !isVis(el)) continue;
      if (normTxt(el.textContent) !== 'simulador de cuotas') continue;
      const dlg = el.closest('[role="dialog"], mat-dialog-container, .MuiDialog-paper, .modal-content, .cdk-overlay-pane');
      if (dlg) return dlg;
      let box = el;
      for (let i = 0; i < 8 && box; i++) {
        if (normTxt(box.innerText).includes('linea de producto')) return box;
        box = box.parentElement;
      }
    }
    return null;
  }

  // Selector "Línea de producto" dentro del modal (primer desplegable)
  function findLineaSelect(modal) {
    const cands = [...modal.querySelectorAll(
      'mat-select, select, [role="combobox"], [aria-haspopup="listbox"], [role="button"][aria-haspopup]'
    )].filter(isVis);
    return cands[0] || null;
  }

  function selText(sel) {
    if (sel.tagName === 'SELECT') return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    return sel.textContent;
  }

  // Ícono $ (o botón) de la tarjeta de la línea en la página
  function findCardTrigger(line) {
    let box = line.el;
    for (let i = 0; i < 4 && box; i++) {
      if (!inPanel(box)) {
        const c = [...box.querySelectorAll('button, [role="button"], a, mat-icon, .mat-icon, svg, i')]
          .filter(e => !inPanel(e) && isVis(e));
        if (c.length) return c[0].closest('button, [role="button"], a') || c[0];
      }
      const p = box.parentElement;
      if (!p) break;
      if (((p.innerText || '').match(/Entrada/gi) || []).length > 1) break; // ya abarca otra tarjeta
      box = p;
    }
    return null;
  }

  function simMsg(txt) {
    const info = document.getElementById('cdd-info');
    if (!info) return;
    info.textContent = txt;
    info.style.cssText = 'display:block;background:#fff6e0;border-color:#f0c36d;color:#8a5a00;';
    clearTimeout(simMsg._t);
    simMsg._t = setTimeout(() => { info.style.display = 'none'; }, 4500);
  }

  async function abrirSimuladorKamina(line) {
    const run    = ++simRun;
    const target = normTxt(line.name);
    const match  = txt => {
      const n = normTxt(txt);
      return !!n && (n === target || n.includes(target) || (n.length > 3 && target.includes(n)));
    };

    try {
      // 1) Abrir el simulador si no está abierto
      let modal = findSimulador();
      if (!modal) {
        const trig = findCardTrigger(line);
        if (!trig) { simMsg(`⚠️ No encontré el botón $ de ${line.name} en Kamina.`); return; }
        fireClick(trig);
        modal = await waitFor(findSimulador, 3500);
        if (run !== simRun) return;
        if (!modal) { simMsg('⚠️ El simulador de Kamina no se abrió.'); return; }
      }

      // 2) Elegir la línea en "Línea de producto"
      const sel = await waitFor(() => findLineaSelect(modal), 2000);
      if (run !== simRun || !sel) return;
      if (match(selText(sel))) return; // ya está elegida

      if (sel.tagName === 'SELECT') {
        const opt = [...sel.options].find(o => match(o.text));
        if (opt) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('input',  { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        } else simMsg(`⚠️ "${line.name}" no está en Línea de producto.`);
        return;
      }

      fireClick(sel);
      const opt = await waitFor(() =>
        [...document.querySelectorAll('[role="option"], mat-option')]
          .filter(o => isVis(o) && !inPanel(o)).find(o => match(o.textContent)), 2000);
      if (run !== simRun) return;
      if (opt) {
        fireClick(opt);
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        simMsg(`⚠️ "${line.name}" no está en Línea de producto.`);
      }
    } catch (e) {
      console.warn('[CDD] abrirSimuladorKamina', e);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     SELECCIONAR LÍNEA
     — Auto-rellena descuento y entrada desde los datos de la tarjeta
     — Bloquea los selectores (no editables)
     — Activa modo SIN INTERÉS si corresponde
  ═══════════════════════════════════════════════════════════════ */
  function selectLine(line) {
    currentLine = line;
    siMode      = isSI(line.name);

    // Marcar botón activo
    document.querySelectorAll('.cdd-lbtn').forEach(b =>
      b.classList.toggle('active', b.textContent.trimStart().startsWith(line.name)));

    // Cambiar modo de visualización
    setSIMode(siMode);

    // (Línea de info removida: el cupo ya se muestra en el botón de línea arriba)

    if (minimized) {
      minimized = false;
      document.getElementById('cdd-body').style.display = '';
      document.getElementById('cdd-btn-min').textContent = '—';
    }

    update();
  }

  /* ══════════════════════════════════════════════════════════════
     BLOQUEAR / DESBLOQUEAR CAMPOS DE DESCUENTO Y ENTRADA
  ═══════════════════════════════════════════════════════════════ */
  function lockFields(/* locked */) {
    // Sin efecto: los campos Descuento/Entrada fueron removidos en el modelo de cartera.
  }

  /* ══════════════════════════════════════════════════════════════
     LEER CUOTAS DEL TEXTO VISIBLE DE LA PÁGINA
     Lee document.body.innerText (texto ya renderizado/visible)
     y extrae los patrones "$XX.XX en N pagos" y "Monto Entrada".
     Así funciona aunque Kamina use cualquier estructura de nodos.
  ═══════════════════════════════════════════════════════════════ */
  function readKaminaCuotas() {
    const seen   = new Set();
    const cuotas = [];
    let   entrada = null;

    // innerText respeta CSS: solo texto VISIBLE en pantalla
    const txt = document.body.innerText || '';

    // Extrae todos los "$XX.XX en N pagos" presentes en la página
    const re = /\$([\d,]+\.\d{2})\s+en\s+(\d+)\s+pagos?/gi;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const key = `${m[1]}_${m[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        cuotas.push(`$${m[1]} en ${m[2]} pagos`);
      }
    }

    // Extrae "Monto Entrada : $XX.XX" si está visible
    const em = txt.match(/Monto\s+Entrada\s*[:\s]+\$([\d,]+\.\d{2})/i);
    if (em && parseFloat(em[1].replace(',', '')) > 0) {
      entrada = `$${em[1]}`;
    }

    return { cuotas, entrada };
  }

  /* ══════════════════════════════════════════════════════════════
     COPIAR CUOTAS — lee el DOM del simulador Kamina, no recalcula
  ═══════════════════════════════════════════════════════════════ */
  function copiarCuotas() {
    const lines = [];
    if (siMode) {
      // Plan SIN INTERÉS: solo los pagos quincenales (sin línea de entrada)
      if (!siCuotaState) return;
      lines.push(`6 pagos quincenales de $${fmt(siCuotaState)}`);
    } else {
      const { cuotas, entrada } = readKaminaCuotas();
      if (!cuotas.length) return;
      // Si el producto supera el cupo, la entrada a cobrar es la final (Kamina + alcance)
      const entTxt = alcanceState ? `$${fmt(alcanceState.entradaFinal)}` : entrada;
      if (entTxt) lines.push(`*Entrada: ${entTxt}*`);
      cuotas.forEach(c => lines.push(c));
    }

    const text = lines.join('\n');
    const btn  = document.getElementById('cdd-btn-copiar');

    const done = () => {
      btn.textContent = '✓ ¡Copiado!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '📋 Copiar Cuotas';
        btn.classList.remove('copied');
      }, 2200);
    };

    navigator.clipboard.writeText(text).then(done).catch(() => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch(_) { btn.textContent = '⚠️ Error al copiar'; }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     COPIAR VALOR DE CRÉDITO
  ═══════════════════════════════════════════════════════════════ */
  function copiarCredito() {
    const val = document.getElementById('cdd-rcred').textContent;
    if (!val || val === '—' || !/\d/.test(val)) return; // no copiar si no hay número válido
    const btn = document.getElementById('cdd-btn-cred');
    const num = val.replace(/,/g, '');
    navigator.clipboard.writeText(num).then(() => {
      btn.textContent = '✓ ¡Copiado!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '📋 Copiar'; btn.classList.remove('copied'); }, 1800);
    }).catch(() => { btn.textContent = '⚠️ Error'; });
  }

  /* ══════════════════════════════════════════════════════════════
     COPIAR RESUMEN PARA FACTURAR (botón 📝)
     CI + nombre del cliente, línea, valor a facturar, entrada y detalle
  ═══════════════════════════════════════════════════════════════ */
  function readCliente() {
    for (const el of document.querySelectorAll('body *')) {
      if (el.childElementCount > 3 || inPanel(el)) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 160) continue;
      const m = t.match(/^([^,]{3,120}?)\s*,\s*CI\s*:\s*(\d{10,13})\b/i);
      if (m) return { nombre: m[1].replace(/^\s*cliente\s*:?\s*/i, '').trim(), ci: m[2] };
    }
    const u = location.pathname.match(/CEDULA\/(\d+)/i);
    return { nombre: '', ci: u ? u[1] : '' };
  }

  function copiarResumen() {
    const btn = document.getElementById('cdd-btn-resumen');
    const flash = (cls, txt) => {
      btn.classList.add(cls); btn.textContent = txt;
      setTimeout(() => { btn.classList.remove(cls); btn.textContent = '📝'; }, 1600);
    };
    const r = resumenState;
    if (!r) { flash('err', '⚠️'); return; }

    const cli = readCliente();
    const out = [];
    out.push(`CI: ${cli.ci || '—'}   ${cli.nombre ? 'Cliente ' + cli.nombre : ''}`.trim());
    out.push('');
    if (r.linea) out.push(`Línea: ${r.linea}`);
    out.push(`Valor a facturar: $${fmt(r.factura)}`);

    if (r.cuotaSI != null) {
      // ── Plan SIN INTERÉS ──
      out.push(`Plan: 6 pagos quincenales de $${fmt(r.cuotaSI)}`);
      if (r.total > 0) {
        // Supera el tope: el cliente hace 2 pagos distintos
        out.push('');
        out.push('El cliente realiza 2 pagos:');
        out.push(`1) Primera cuota: $${fmt(r.cuotaSI)}`);
        out.push(`2) Entrada Kissu: $${fmt(r.total)}`);
        // Desglose solo si hay sugerido (si es solo alcance, ya está en la línea de arriba)
        if (r.siAlcSug > 0) {
          if (r.siAlcProd > 0) out.push(`   - Alcance: $${fmt(r.siAlcProd)}`);
          out.push(`   - Sugerido: $${fmt(r.siAlcSug)}`);
        }
      } else if (r.sugIncl > 0) {
        out.push('');
        out.push(`Sugerido ya incluido: $${fmt(r.sugIncl)}`);
      }
    } else {
      // ── Planes con interés ──
      out.push(`Total a cobrar entrada: $${fmt(r.total)}`);
      const det = [];
      if (r.sugIncl > 0) {
        // Dentro del cupo: el sugerido va incluido en el crédito
        if (r.entPct > 0) det.push(`Entrada Kamina (${r.entPct}%): $${fmt(r.total)}`);
        det.push(`Sugerido: $${fmt(r.sugIncl)}`);
      }
      if (r.alcance != null) {
        det.push(`Entrada Kamina (${r.entPct}%): $${fmt(r.entKamina)}`);
        if (r.alcProd > 0) det.push(`Alcance: $${fmt(r.alcProd)}`);
        if (r.alcSug  > 0) det.push(`Sugerido: $${fmt(r.alcSug)}`);
      }
      if (det.length) { out.push(''); out.push(...det); }
    }

    navigator.clipboard.writeText(out.join('\n'))
      .then(() => flash('ok', '✓'))
      .catch(() => flash('err', '⚠️'));
  }

  /* ══════════════════════════════════════════════════════════════
     AVISO DE ENTRADA (inline, dentro del panel sobre Copiar Cuotas)
     Con entrada (>0): tarjeta ROJA pulsante con el monto.
     Sin entrada (0%): tarjeta VERDE "Sin entrada".
     Se guarda el estado y se refleja cada vez que el wrap se muestra.
  ═══════════════════════════════════════════════════════════════ */
  let entradaState = null; // {monto, entPct} | {monto:null} | null

  function renderEntradaInline() {
    const el = document.getElementById('cdd-entrada-inline');
    if (!el) return;
    if (!entradaState) { el.className = ''; el.innerHTML = ''; return; }
    if (entradaState.desglose) {
      const d = entradaState.desglose;
      el.className = 'on ent';
      el.innerHTML = `
        <div class="ei-k">⚠️ TOTAL A COBRAR DE ENTRADA</div>
        <div class="ei-v">$${fmt(d.total)}</div>
        <div class="ei-det">
          <div class="ei-det-row"><span>Entrada Kamina (${d.entPct}%)</span><b>$${fmt(d.entKamina)}</b></div>
          ${d.alcProd > 0 ? `<div class="ei-det-row"><span>+ Alcance</span><b>$${fmt(d.alcProd)}</b></div>` : ''}
          ${d.alcSug  > 0 ? `<div class="ei-det-row"><span>+ Sugerido</span><b>$${fmt(d.alcSug)}</b></div>` : ''}
        </div>`;
      return;
    }
    if (entradaState.monto) {
      el.className = 'on ent';
      el.innerHTML = `
        <div class="ei-k">${entradaState.titulo || `⚠️ MONTO DE ENTRADA (${entradaState.entPct}%)`}</div>
        <div class="ei-v">${entradaState.monto}</div>
        <div class="ei-sub">${entradaState.sub || 'El cliente debe pagar esta entrada'}</div>`;
    } else {
      el.className = 'on noent';
      el.innerHTML = `
        <div class="ei-k">✅ SIN ENTRADA</div>
        <div class="ei-v">$0.00</div>
        <div class="ei-sub">Esta línea no requiere entrada</div>`;
    }
  }

  function showEntradaAlert(monto, entPct, extra) {
    entradaState = Object.assign({ monto, entPct }, extra || {});
    renderEntradaInline();
  }

  function hideEntradaAlert() {
    entradaState = null;
    renderEntradaInline();
  }


  function startCuotasWatcher() {
    let debounceTimer;

    function checkCuotas() {
      const wrap = document.getElementById('cdd-wrap-copiar');
      if (!wrap || siMode) return;
      const { cuotas } = readKaminaCuotas();
      wrap.style.display = cuotas.length > 0 ? 'block' : 'none';
    }

    // Debounce: espera 250 ms tras el último cambio de DOM antes de escanear
    function onDOMChange() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkCuotas, 250);
    }

    // MutationObserver: detecta cuando Kamina inserta/quita los resultados
    new MutationObserver(onDOMChange).observe(document.body, {
      childList : true,
      subtree   : true,
      characterData: true
    });

    // Intervalo de respaldo cada 1 s
    setInterval(checkCuotas, 1000);
  }

  /* ══════════════════════════════════════════════════════════════
     ACTIVAR/DESACTIVAR MODO PLAN SIN INTERÉS
  ═══════════════════════════════════════════════════════════════ */
  function setSIMode(on) {
    document.getElementById('cdd-si-banner').classList.remove('on'); // banner viejo ya no se usa
    // En modo SIN INTERÉS se oculta Transporte; Sugerido sí aplica: crédito = (efectivo + sugerido) × 1.15
    const r3 = document.querySelector('.cdd-r3-in');
    if (r3) {
      r3.querySelector('#cdd-transp').closest('.cdd-f').style.display = on ? 'none' : '';
      r3.style.gridTemplateColumns = on ? '1fr 1fr' : '';
    }
    // Input "Valor producto" solo visible en SIN INTERÉS
    // (eliminado: el abono se calcula solo por efectivo vs tope)
    // Al salir de SIN INTERÉS, ocultar la caja de factura/cuotas/entrada
    if (!on) {
      const abonoBox = document.getElementById('cdd-abono-box');
      if (abonoBox) abonoBox.classList.remove('on');
    }
    // La caja de crédito (con botón Copiar) se muestra SIEMPRE
    document.getElementById('cdd-wrap-results').style.display = '';
    // Las cajas Base/A Recibir/Neto y el badge de cartera NO aplican en SIN INTERÉS
    const res3 = document.querySelector('#cdd-wrap-results .cdd-res3');
    if (res3) res3.style.display = on ? 'none' : '';
    // Pintar la caja de crédito en verde para SIN INTERÉS, azul para cartera
    const credBox = document.querySelector('.cdd-cred-box');
    if (credBox) credBox.classList.toggle('si-green', on);
    const credK = document.querySelector('.cdd-cred-k');
    if (credK) credK.textContent = on ? '🟢 CRÉDITO PLAN SIN INTERÉS' : '💳 VALOR CRÉDITO A CALCULAR';

    // Copiar Cuotas: en SIN INTERÉS lo muestra updateSinInteres(); en cartera, el watcher
    document.getElementById('cdd-wrap-copiar').style.display    = 'none';
    if (on) {
      const alcBox = document.getElementById('cdd-alc-box');
      if (alcBox) alcBox.classList.remove('on');
      alcanceState = null;
      document.getElementById('cdd-c2').classList.remove('na');
    } else {
      siCuotaState = null;
    }
    // Tabla de cuotas oculta siempre (en ambos modos)
    document.getElementById('cdd-tbl').style.display  = 'none';
    document.getElementById('cdd-foot').style.display = 'none';
    document.getElementById('cdd-warn').classList.remove('on');
  }

  /* ══════════════════════════════════════════════════════════════
     RECALCULAR
  ═══════════════════════════════════════════════════════════════ */
  function update() {
    if (siMode && currentLine) updateSinInteres();
    else                       updateCartera();
  }

  // ── Modo COMPRA DE CARTERA ────────────────────────────────────
  function updateCartera() {
    const efectivo   = parseFloat(document.getElementById('cdd-c1').value) || 0;
    const sugInput   = parseFloat(document.getElementById('cdd-c2').value) || 0;

    const transpEl   = document.getElementById('cdd-transp');
    const c1el       = document.getElementById('cdd-c1');
    const c2el       = document.getElementById('cdd-c2');
    const warn       = document.getElementById('cdd-warn');
    const alcBox     = document.getElementById('cdd-alc-box');
    const sugRef     = document.getElementById('cdd-sug-hint');

    // Reset del estado de alcance / resumen en cada cálculo
    alcanceState = null;
    resumenState = null;
    if (alcBox) alcBox.classList.remove('on');
    c2el.classList.remove('na');

    // %Cartera según categoría del cliente detectada
    const carteraRate = getCarteraRate();
    const cat         = readCategoria();
    const CAT_NOMBRE  = { 'PLUS':'AAA', '1':'AA', '2':'A', '3':'B', '4':'C', 'NEW':'INCLUSIÓN' };
    const catLbl      = document.getElementById('cdd-cat-lbl');
    const catBadge    = document.getElementById('cdd-cat-badge');

    // ── BLOQUEO: sin categoría detectada no se permite calcular ──
    const credEl  = document.getElementById('cdd-rcred');
    const credBox = document.querySelector('.cdd-cred-box');
    const btnCred = document.getElementById('cdd-btn-cred');
    if (!cat) {
      if (transpEl) transpEl.value = efectivo > 0 ? transporteAuto(efectivo) : '';
      catLbl.textContent = '⛔ Categoría no detectada — no se puede calcular';
      catLbl.style.color = '#b71c1c';
      catBadge.className  = 'on nodetect';
      catBadge.innerHTML  = `⛔ Categoría no detectada · recarga el cliente o usa 🔄`;

      credEl.textContent = 'SIN CATEGORÍA';
      if (credBox) credBox.classList.add('blocked');
      if (btnCred) btnCred.disabled = true;

      document.getElementById('cdd-rbase').textContent = '—';
      document.getElementById('cdd-rmeta').textContent = '—';
      document.getElementById('cdd-rneto').textContent = '—';
      document.getElementById('cdd-hint').textContent  = '';
      if (sugRef) sugRef.textContent = '';
      warn.classList.remove('on'); c1el.classList.remove('over');
      hideEntradaAlert();
      return; // ← corta aquí, no calcula crédito
    }

    // categoría OK → asegurar caja desbloqueada
    if (credBox) credBox.classList.remove('blocked');
    if (btnCred) btnCred.disabled = false;

    const nombre = CAT_NOMBRE[cat] ? ' ('+CAT_NOMBRE[cat]+')' : '';
    catLbl.textContent = `Cat. ${cat}${nombre} · Cartera ${(carteraRate * 100).toFixed(0)}%`;
    catLbl.style.color = '#1748a8';
    catBadge.className = 'on';
    catBadge.innerHTML = `👤 Categoría <span class="cb-tag">${cat}${nombre}</span> <span class="cb-tag">Cartera ${(carteraRate * 100).toFixed(0)}%</span>`;

    document.getElementById('cdd-hint').textContent = '';

    // ── ¿El producto supera lo que entra en el cupo? → modo ALCANCE ──
    // ¿Supera el cupo? Se mide con el crédito real (efectivo + su transporte + sugerido)
    // Si supera: el transporte se fija en el del efectivo máximo SIN sugerido ("hasta"),
    // así el sugerido se suma completo al alcance (no lo "absorbe" un cambio de rango de transporte).
    let efMax = 0, efMax0 = 0, transpFijo = 0;
    if (currentLine && efectivo > 0) {
      const credReal = calcCartera(efectivo, transporteAuto(efectivo), sugInput, carteraRate).credito;
      if (credReal > currentLine.cupo) {
        efMax0     = efectivoMaxPorCupo(currentLine.cupo, carteraRate, 0);
        transpFijo = transporteAuto(efMax0);
        const netoR = 1 - (carteraRate + HONORARIO);
        efMax = Math.floor((currentLine.cupo * netoR) / MARGIN_TARGET - transpFijo - sugInput);
        while (efMax > 0 && calcCartera(efMax, transpFijo, sugInput, carteraRate).credito > currentLine.cupo) efMax--;
      }
    }
    const excede = currentLine && efMax > 0 && efectivo > efMax;

    if (excede) {
      // Se usa el cupo completo; el excedente lo paga el cliente como alcance.
      // El Sugerido se suma al alcance (reduce el efectivo que entra en el cupo).
      const cupo         = currentLine.cupo;
      const entPct       = currentLine.entPct || 0;
      const transporte   = transpFijo;
      const { base, meta, netoReal } = calcCartera(efMax, transporte, sugInput, carteraRate);

      const alcance      = round2(efectivo - efMax);
      // Desglose: lo que excede el producto + lo que aporta el sugerido
      let   alcProd      = round2(Math.max(0, efectivo - efMax0));
      let   alcSug       = round2(Math.max(0, alcance - alcProd));
      alcProd            = round2(alcance - alcSug);
      const entKamina    = round2(cupo * entPct / 100);
      const entradaFinal = round2(entKamina + alcance);
      const factura      = round2(cupo + alcance);
      alcanceState = { entradaFinal };
      resumenState = { linea: currentLine.name, factura, total: entradaFinal, entPct, entKamina, alcance, alcProd, alcSug };

      if (transpEl) transpEl.value = transporte;
      if (sugRef) sugRef.textContent = '';

      warn.textContent = '⚠️ Supera el cupo, requiere entrada';
      warn.classList.add('on'); c1el.classList.add('over');

      document.getElementById('cdd-rcred').textContent = fmt(cupo, 0);
      document.getElementById('cdd-rbase').textContent = fmt(base);
      document.getElementById('cdd-rmeta').textContent = fmt(meta);
      document.getElementById('cdd-rneto').textContent = (netoReal * 100).toFixed(2);

      document.getElementById('cdd-alc-fact').textContent = fmt(factura);
      if (alcBox) alcBox.classList.add('on');

      showEntradaAlert(`$${fmt(entradaFinal)}`, entPct, {
        desglose: { entPct, entKamina, alcProd, alcSug, total: entradaFinal },
      });
      return;
    }

    // ── Modo normal: el producto entra en el cupo ──
    const sugerido   = sugInput;
    const transporte = transporteAuto(efectivo);
    if (transpEl) transpEl.value = efectivo > 0 ? transporte : '';

    const { base, meta, netoReal, credito } = calcCartera(efectivo, transporte, sugerido, carteraRate);

    // Sugerencia de cuánto poner en "Sugerido" (referencia modelo anterior: 15% del efectivo)
    if (sugRef) {
      sugRef.textContent = efectivo > 0 ? `Sugerido ref. ~15% = $${fmt(efectivo * 0.15)}` : '';
    }

    // Alerta cupo excedido (p. ej. por el Sugerido, el crédito supera el cupo)
    if (currentLine && credito > currentLine.cupo) {
      warn.textContent = `⚠️ El crédito calculado ($${fmt(credito)}) supera el cupo de ${currentLine.name} ($${fmt(currentLine.cupo, 0)}).`;
      warn.classList.add('on'); c1el.classList.add('over');
    } else if (efectivo > 0 && credito < CREDITO_MIN) {
      warn.textContent = `⚠️ Crédito menor al mínimo de $${fmt(CREDITO_MIN, 0)}`;
      warn.classList.add('on'); c1el.classList.add('over');
    } else {
      warn.classList.remove('on'); c1el.classList.remove('over');
    }

    document.getElementById('cdd-rcred').textContent = fmt(credito);
    document.getElementById('cdd-rbase').textContent = fmt(base);
    document.getElementById('cdd-rmeta').textContent = fmt(meta);
    document.getElementById('cdd-rneto').textContent = (netoReal * 100).toFixed(2);

    // ── Aviso de entrada: Valor Crédito × % entrada de la línea ──
    if (currentLine && credito > 0) {
      const entPct = currentLine.entPct || 0;
      if (entPct > 0) {
        const montoEntrada = Math.round(credito * entPct / 100 * 100) / 100;
        resumenState = { linea: currentLine.name, factura: credito, total: montoEntrada, entPct, sugIncl: sugerido };
        showEntradaAlert(`$${fmt(montoEntrada)}`, entPct);
      } else {
        resumenState = { linea: currentLine.name, factura: credito, total: 0, entPct: 0, sugIncl: sugerido };
        showEntradaAlert(null, 0); // línea sin entrada → mensaje "Sin entrada"
      }
    } else {
      hideEntradaAlert();
    }
  }

  // ── Modo Plan SIN INTERÉS ─────────────────────────────────────
  function updateSinInteres() {
    const c1  = parseFloat(document.getElementById('cdd-c1').value) || 0;
    const sug = Math.max(0, parseFloat(document.getElementById('cdd-c2').value) || 0);
    const tot = round2(c1 + sug); // efectivo + sugerido

    // Tope de efectivo aprobado = cupo de la línea ÷ 1.15 (entero inferior)
    const topeEfectivo = currentLine ? topeSinInteres(currentLine.cupo) : 0;

    // ¿Efectivo + sugerido supera el tope? → el excedente lo da el cliente como entrada
    const excede = currentLine && c1 > 0 && tot > topeEfectivo && topeEfectivo > 0;

    // Crédito = (efectivo + sugerido) × 1.15, o el tope si excede
    const efectivoCredito = excede ? topeEfectivo : tot;
    const { valorCredito } = calcSinInteres(efectivoCredito);
    const cuota = round2(valorCredito / 6); // cuota SOLO sobre el crédito (6 quincenales)

    // Plan SIN INTERÉS: ocultar la tarjeta "SIN ENTRADA / $0.00" (no aplica aquí)
    hideEntradaAlert();

    // Escribir en la MISMA caja de crédito (con botón Copiar) que el modo normal
    document.getElementById('cdd-rcred').textContent = c1 > 0 ? fmt(valorCredito) : '—';
    document.getElementById('cdd-c2').classList.remove('na');
    document.getElementById('cdd-si-vc').textContent = fmt(valorCredito); // compat banner viejo

    const sugRef = document.getElementById('cdd-sug-hint');
    if (sugRef) sugRef.textContent = '';

    // Cuota visible + botón Copiar Cuotas (solo pagos quincenales)
    const wrap = document.getElementById('cdd-wrap-copiar');
    resumenState = null;
    if (c1 > 0) {
      siCuotaState = cuota;
      document.getElementById('cdd-hint').textContent = excede ? '' : `📅 6 pagos quincenales de $${fmt(cuota)}`;
      wrap.style.display = 'block';
    } else {
      siCuotaState = null;
      document.getElementById('cdd-hint').textContent = '';
      wrap.style.display = 'none';
    }

    // Asegurar caja desbloqueada y botón copiar activo
    const credBox = document.querySelector('.cdd-cred-box');
    const btnCred = document.getElementById('cdd-btn-cred');
    if (credBox) credBox.classList.remove('blocked');
    if (btnCred) btnCred.disabled = false;

    // ── Alerta cupo: SI el efectivo supera el tope → ROJO + entrada/abono ──
    const warn      = document.getElementById('cdd-warn');
    const c1el      = document.getElementById('cdd-c1');
    const abonoBox  = document.getElementById('cdd-abono-box');
    if (excede) {
      // Producto por encima del tope: NO se bloquea, se cubre con entrada
      const abono   = round2(tot - topeEfectivo);          // (efectivo + sugerido) − tope
      const factura = round2(valorCredito + abono);         // crédito + abono
      const abProd  = round2(Math.max(0, c1 - topeEfectivo)); // lo que excede el producto
      const abSug   = round2(abono - abProd);                 // parte del sugerido

      warn.textContent = `⚠️ Producto de mayor valor: el cliente da una entrada de $${fmt(abono)}.`;
      warn.classList.add('on');
      c1el.classList.add('over');

      // Recuadros: entrada, factura y cuotas
      document.getElementById('cdd-ab-abono').textContent = fmt(abono);
      document.getElementById('cdd-ab-fact').textContent  = fmt(factura);
      document.getElementById('cdd-ab-cuota').textContent = `6 pagos quincenales de $${fmt(cuota)}`;
      document.getElementById('cdd-ab-det').textContent   = abSug > 0
        ? (abProd > 0 ? `Alcance $${fmt(abProd)} + Sugerido $${fmt(abSug)}` : `Sugerido $${fmt(abSug)}`)
        : '';
      if (abonoBox) abonoBox.classList.add('on');
      resumenState = { linea: currentLine.name, factura, total: abono, cuotaSI: cuota,
                       siAlcProd: abProd, siAlcSug: abSug };
    } else {
      if (c1 > 0 && valorCredito < CREDITO_MIN_SI) {
        warn.textContent = `⚠️ Crédito menor al mínimo de $${fmt(CREDITO_MIN_SI, 0)}`;
        warn.classList.add('on');
        c1el.classList.add('over');
      } else {
        warn.classList.remove('on');
        c1el.classList.remove('over');
      }
      if (abonoBox) abonoBox.classList.remove('on');
      if (c1 > 0) resumenState = { linea: currentLine ? currentLine.name : null, factura: valorCredito, total: 0, cuotaSI: cuota, sugIncl: sug, entPct: 0 };
    }
  }

  // ── Renderizar tabla de cuotas ────────────────────────────────
  function renderTable(months, rowFn) {
    const tbody = document.getElementById('cdd-tbody');
    tbody.innerHTML = '';
    months.forEach(n => {
      const { cuota, total, entrada, isSI } = rowFn(n);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${n} cuotas</strong></td>
        <td class="r"><strong>$${fmt(cuota)}</strong></td>
        <td class="r">$${fmt(total)}</td>
        <td class="r"></td>
      `;
      const btn = document.createElement('button');
      btn.className = 'cdd-cpbtn';
      btn.textContent = 'Copiar';
      btn.addEventListener('click', () => {
        let txt = '';
        if (!isSI && entrada > 0) txt += `*Entrada: $${fmt(entrada)}*\n`;
        txt += `${n} cuotas de: $${fmt(cuota)}`;
        navigator.clipboard.writeText(txt).then(() => {
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = 'Copiar'; }, 1400);
        });
      });
      tr.querySelector('td:last-child').appendChild(btn);
      tbody.appendChild(tr);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     DETECCIÓN DE URL VÁLIDA
     Solo activo en: /ventas/resumen-estado-cliente/CEDULA/<número>
  ═══════════════════════════════════════════════════════════════ */
  function isCedulaURL() {
    return /\/ventas\/resumen-estado-cliente\/CEDULA\/\d+/i.test(location.pathname);
  }

  /* ══════════════════════════════════════════════════════════════
     NAVEGACIÓN SPA  (3 estrategias combinadas)
  ═══════════════════════════════════════════════════════════════ */
  function onClientChange() {
    if (!panel) return;

    // ── Fuera del URL de CEDULA → ocultar completamente el panel
    if (!isCedulaURL()) {
      panel.style.display    = 'none';
      reopener.style.display = 'none';
      return;
    }

    // ── Dentro del URL de CEDULA → mostrar panel y resetear todo
    panel.style.display    = '';
    reopener.style.display = 'none'; // el panel está visible, no necesita el botón

    // Resetear todos los campos e inputs (usa la misma función del botón Limpiar)
    limpiarPanel();

    // Marcar "detectando" en el selector de líneas
    const container = document.getElementById('cdd-lines');
    if (container) container.innerHTML = '<span style="font-size:11px;color:#8a97a8">Detectando líneas…</span>';

    // Reintentar detección de líneas del nuevo cliente
    setTimeout(refreshLines,  900);
    setTimeout(refreshLines, 2200);
    setTimeout(refreshLines, 4000);
  }

  function setupNavWatcher() {
    // 1. Override pushState/replaceState
    try {
      const oP = history.pushState.bind(history);
      const oR = history.replaceState.bind(history);
      history.pushState    = (...a) => { oP(...a);    setTimeout(onClientChange, 200); };
      history.replaceState = (...a) => { oR(...a);    setTimeout(onClientChange, 200); };
    } catch(_) {}
    // 2. Popstate (botón atrás/adelante)
    window.addEventListener('popstate', () => setTimeout(onClientChange, 200));
    // 3. Polling 600 ms (fallback universal)
    let last = location.href;
    setInterval(() => { if (location.href !== last) { last = location.href; onClientChange(); } }, 600);
  }

  /* ══════════════════════════════════════════════════════════════
     ARRANQUE  (espera que el DOM de Kamina haya cargado el bloque Cupo)
  ═══════════════════════════════════════════════════════════════ */
  let injected = false;
  function tryInject() {
    if (injected) return;
    // Solo inyectar si estamos en la URL correcta
    if (!isCedulaURL()) return;
    const ok = Array.from(document.querySelectorAll('*')).some(el => {
      const t = (el.innerText || '').trim();
      return t === 'Cupo' || (t.startsWith('Cupo') && t.length < 12);
    });
    if (ok) { injected = true; inject(); setupNavWatcher(); }
  }

  new MutationObserver(tryInject).observe(document.body, { childList: true, subtree: true });
  if (document.readyState !== 'loading') {
    setTimeout(tryInject,  500);
    setTimeout(tryInject, 1500);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(tryInject,  500);
      setTimeout(tryInject, 1500);
    });
  }

})();
