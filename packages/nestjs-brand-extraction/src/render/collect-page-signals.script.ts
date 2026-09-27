/**
 * Runs inside the rendered page. Kept as a plain JS string on purpose: bundlers
 * (esbuild/tsx/SWC) inject helpers like `__name` into functions, which then
 * crash when Playwright serialises them into the browser.
 *
 * Returns `PageSignals` (see brand-extraction.types.ts). All colours are
 * resolved by the browser itself into computed `rgb(...)` / `oklch(...)` strings,
 * so CSS variables, `hsl()`, Tailwind/shadcn bare channel triplets etc. are all
 * normalised before they reach Node.
 */
export const COLLECT_PAGE_SIGNALS = String.raw`
(args) => {
  const MAX_LOGO_Y = args.maxLogoY;
  const MAX_CANDIDATES = args.maxCandidates;
  const vw = window.innerWidth;

  // ---------- colour resolution via a probe element ----------
  const probe = document.createElement('div');
  probe.style.display = 'none';
  document.documentElement.appendChild(probe);
  const resolveColor = (value) => {
    if (!value) return null;
    probe.style.color = '';
    probe.style.color = value;
    if (!probe.style.color) return null;
    return getComputedStyle(probe).color;
  };
  const resolveVar = (raw) => {
    const v = (raw || '').trim();
    if (!v) return null;
    const direct = resolveColor(v);
    if (direct) return direct;
    // Bare channel triplets: shadcn "222 47% 11%" (hsl) / Tailwind "59 130 246" (rgb)
    if (/^[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%$/.test(v)) return resolveColor('hsl(' + v + ')');
    if (/^[\d.]+\s+[\d.]+\s+[\d.]+$/.test(v)) return resolveColor('rgb(' + v + ')');
    if (/^[\d.]+%?\s+[\d.]+\s+[\d.]+$/.test(v)) return resolveColor('oklch(' + v + ')');
    return null;
  };
  const isOpaque = (c) => c && !/rgba\(.*,\s*0(\.0+)?\)$/.test(c) && c !== 'transparent' && !/\/\s*0\)$/.test(c);

  const out = {
    title: document.title || null,
    lang: document.documentElement.lang || null,
    siteName: null,
    jsonLd: { name: null, logo: null },
    themeColor: null,
    tileColor: null,
    maskIcon: null,
    headIcons: [],
    manifestUrl: null,
    ogImage: null,
    cssVars: [],
    elements: [],
    logoCandidates: [],
  };

  // ---------- meta ----------
  const metaContent = (sel) => { const el = document.querySelector(sel); return el ? el.getAttribute('content') : null; };
  out.siteName = metaContent('meta[property="og:site_name"]') || metaContent('meta[name="application-name"]') || metaContent('meta[name="apple-mobile-web-app-title"]');
  out.ogImage = metaContent('meta[property="og:image"]') || metaContent('meta[name="twitter:image"]');
  const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const theme = themeMetas.find((m) => !m.media || /light/.test(m.media)) || themeMetas[0];
  if (theme) out.themeColor = resolveColor(theme.getAttribute('content'));
  out.tileColor = resolveColor(metaContent('meta[name="msapplication-TileColor"]'));

  // ---------- JSON-LD Organization ----------
  const orgTypes = /^(Organization|Corporation|LocalBusiness|Store|OnlineStore|Brand|WebSite|ProfessionalService|HomeAndConstructionBusiness|GeneralContractor|RealEstateAgent)$/;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const types = [].concat(node['@type'] || []);
    if (types.some((t) => orgTypes.test(t))) {
      if (!out.jsonLd.name && typeof node.name === 'string' && !/WebSite/.test(types.join())) out.jsonLd.name = node.name;
      const logo = node.logo;
      const logoUrl = typeof logo === 'string' ? logo : logo && (logo.url || logo.contentUrl);
      if (!out.jsonLd.logo && typeof logoUrl === 'string') out.jsonLd.logo = new URL(logoUrl, location.href).href;
    }
    if (node['@graph']) visit(node['@graph']);
    if (node.publisher) visit(node.publisher);
    if (node.brand) visit(node.brand);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { visit(JSON.parse(s.textContent || '')); } catch (e) {} });

  // ---------- head icons ----------
  document.querySelectorAll('link[rel]').forEach((l) => {
    const rel = (l.getAttribute('rel') || '').toLowerCase();
    const href = l.getAttribute('href');
    if (!href) return;
    const abs = new URL(href, location.href).href;
    if (rel.includes('manifest')) out.manifestUrl = abs;
    else if (rel.includes('mask-icon')) { out.maskIcon = { href: abs, color: resolveColor(l.getAttribute('color')) }; }
    else if (rel.includes('apple-touch-icon') || rel.split(/\s+/).includes('icon')) {
      out.headIcons.push({ href: abs, rel, type: l.getAttribute('type'), sizes: l.getAttribute('sizes') });
    }
  });

  // ---------- CSS custom properties that look like brand tokens ----------
  const varNames = new Set();
  const scanRules = (rules, depth) => {
    if (!rules || depth > 4) return;
    for (const rule of rules) {
      if (varNames.size > 1500) return;
      if (rule.cssRules && !rule.selectorText) { scanRules(rule.cssRules, depth + 1); continue; }
      if (!rule.style || !rule.selectorText) continue;
      if (!/(:root|^html|^body|\[data-theme|\.theme|:host)/.test(rule.selectorText)) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const p = rule.style[i];
        if (p.startsWith('--')) varNames.add(p);
      }
    }
  };
  for (const sheet of document.styleSheets) { try { scanRules(sheet.cssRules, 0); } catch (e) { /* cross-origin */ } }
  const inc = /(brand|primary|accent|main|theme|secondary|highlight|cta|corporate|huisstijl|signature)/i;
  const exc = /(foreground|-fg|text|font|size|radius|space|spacing|shadow|border-width|width|height|gap|duration|ease|z-?index|opacity|weight|line|family|contrast|on-)/i;
  const rootStyle = getComputedStyle(document.documentElement);
  for (const name of varNames) {
    if (!inc.test(name) || exc.test(name)) continue;
    const resolved = resolveVar(rootStyle.getPropertyValue(name));
    if (resolved) out.cssVars.push({ name, color: resolved });
    if (out.cssVars.length > 60) break;
  }

  // ---------- visible UI elements ----------
  const visible = (el, r) => {
    if (r.width < 8 || r.height < 8) return false;
    if (r.bottom < 0 || r.top > window.innerHeight * 3) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.3;
  };

  const header = document.querySelector('header, [role="banner"], #header, .header, .site-header, #masthead');
  if (header) {
    const r = header.getBoundingClientRect();
    const bg = getComputedStyle(header).backgroundColor;
    if (visible(header, r) && isOpaque(bg)) out.elements.push({ role: 'header-bg', color: bg, area: r.width * r.height });
  }

  const buttonSel = 'button, [role="button"], input[type="submit"], a[class*="btn"], a[class*="button"], a[class*="cta"], .btn, .button, [class*="Button"]';
  let buttons = 0;
  for (const el of document.querySelectorAll(buttonSel)) {
    if (buttons > 120) break;
    const r = el.getBoundingClientRect();
    if (!visible(el, r) || r.width < 40 || r.height < 20 || r.width > vw * 0.9) continue;
    if (el.closest('#onetrust-banner-sdk, #CybotCookiebotDialog, [id*="cookie" i], [class*="cookie" i], [class*="consent" i]')) continue;
    const cs = getComputedStyle(el);
    const area = r.width * r.height;
    if (isOpaque(cs.backgroundColor)) out.elements.push({ role: 'button-bg', color: cs.backgroundColor, area });
    else if (parseFloat(cs.borderTopWidth) >= 1 && isOpaque(cs.borderTopColor)) out.elements.push({ role: 'button-outline', color: cs.borderTopColor, area });
    buttons++;
  }

  let links = 0;
  for (const a of document.querySelectorAll('main a[href], article a[href], section a[href], p a[href]')) {
    if (links > 80) break;
    const r = a.getBoundingClientRect();
    if (!visible(a, r)) continue;
    out.elements.push({ role: 'link', color: getComputedStyle(a).color, area: r.width * r.height });
    links++;
  }

  // ---------- logo candidates ----------
  const BAD = /(partner|client|klant|award|payment|betaal|visa|mastercard|maestro|bancontact|paypal|klarna|ideal|social|facebook|instagram|linkedin|youtube|twitter|tiktok|pinterest|whatsapp|app-?store|google-?play|flag|vlag|language|lang-|cart|winkelwagen|basket|search|zoek|menu|hamburger|burger|close|arrow|chevron|avatar|user|account|trustpilot|kiyoh|becommerce|safeshop|cookie|badge|rating|star|spinner|loader|placeholder|banner|hero|slide)/i;
  const GOOD = /(logo|brand|merk|site-?title|navbar-brand|custom-logo|wordmark|masthead)/i;
  const homePaths = new Set(['/', '', '/nl', '/nl/', '/fr', '/fr/', '/en', '/en/', '/nl-be', '/nl-be/', '/fr-be', '/fr-be/', '/home', '/index.html']);
  const attrText = (el) => {
    let s = '';
    let node = el;
    for (let i = 0; i < 4 && node && node !== document.body; i++, node = node.parentElement) {
      s += ' ' + (node.id || '') + ' ' + (typeof node.className === 'string' ? node.className : (node.className && node.className.baseVal) || '');
      if (i === 0) s += ' ' + (node.getAttribute('alt') || '') + ' ' + (node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('src') || '') + ' ' + (node.getAttribute('title') || '');
    }
    return s;
  };

  const seen = new Set();
  const raw = [];
  const consider = (el, kind) => {
    if (seen.has(el)) return;
    seen.add(el);
    if (kind === 'svg' && el.parentElement && el.parentElement.closest('svg')) return;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 10 || r.top > MAX_LOGO_Y + 400) return;
    if (!visible(el, r)) return;
    const text = attrText(el);
    let score = 0;
    const reasons = [];
    if (GOOD.test(text)) { score += 3; reasons.push('logo-attr'); }
    if (BAD.test(text) && !GOOD.test(text)) { score -= 4; reasons.push('bad-attr'); }
    if (el.closest('header, [role="banner"], nav, #header, .header, #masthead')) { score += 2; reasons.push('in-header'); }
    const link = el.closest('a[href]');
    if (link) {
      try {
        const u = new URL(link.getAttribute('href'), location.href);
        if (u.origin === location.origin && homePaths.has(u.pathname.toLowerCase())) { score += 2.5; reasons.push('links-home'); }
      } catch (e) {}
    }
    if (r.top < MAX_LOGO_Y) { score += 1; reasons.push('top'); }
    if (r.left < vw * 0.4) { score += 1; reasons.push('left'); }
    else if (Math.abs(r.left + r.width / 2 - vw / 2) < vw * 0.12) { score += 0.5; reasons.push('centered'); }
    const area = r.width * r.height;
    if (area < 600) { score -= 1.5; reasons.push('tiny'); }
    if (r.width > vw * 0.6 || r.height > 300) { score -= 3; reasons.push('huge'); }
    if (kind === 'svg' && el.querySelector('use') && el.children.length === 1 && area < 1200) { score -= 2; reasons.push('icon-sprite'); }

    let src = null;
    if (kind === 'img') src = el.currentSrc || el.src || null;
    if (kind === 'bg') {
      const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(el).backgroundImage || '');
      src = m ? new URL(m[1], location.href).href : null;
      if (!src) return;
    }
    raw.push({ el, kind, score, reasons, src, rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      naturalWidth: kind === 'img' ? el.naturalWidth : null, alt: el.getAttribute('alt') || el.getAttribute('aria-label') || null });
  };

  document.querySelectorAll('img').forEach((el) => consider(el, 'img'));
  document.querySelectorAll('svg').forEach((el) => consider(el, 'svg'));
  document.querySelectorAll('[class*="logo" i], [id*="logo" i], .navbar-brand, .custom-logo-link').forEach((el) => {
    if (el.tagName === 'IMG' || el.tagName.toLowerCase() === 'svg') return;
    if (el.querySelector('img, svg')) return; // children are considered separately
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(')) consider(el, 'bg');
  });

  raw.sort((a, b) => b.score - a.score);
  out.logoCandidates = raw.slice(0, MAX_CANDIDATES).filter((c) => c.score > 0).map((c, i) => {
    c.el.setAttribute('data-bx-cand', String(i));
    return { index: i, kind: c.kind, score: c.score, reasons: c.reasons, src: c.src, rect: c.rect, naturalWidth: c.naturalWidth, alt: c.alt };
  });

  probe.remove();
  return out;
}
`;

/**
 * Hides cookie/consent layers and chat widgets before we take screenshots —
 * otherwise a Cookiebot/OneTrust banner dominates the "homepage colours".
 */
export const HIDE_OVERLAYS_CSS = `
#onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay,
#usercentrics-root, #cmpbox, #cmpbox2, .cc-window, .cc-banner, #cookie-law-info-bar, .cky-consent-container,
#didomi-host, .qc-cmp2-container, #axeptio_overlay, #tarteaucitronRoot, .cookie-notice-container,
#hs-eu-cookie-confirmation, #intercom-container, .intercom-lightweight-app, #hubspot-messages-iframe-container,
#crisp-chatbox, .tawk-min-container, [id^="CookieConsent"], [class*="cookie-banner" i], [class*="cookiebar" i],
[aria-modal="true"][aria-label*="cookie" i] { display: none !important; }
html, body { overflow: auto !important; }
`;

/** Second pass for consent layers that don't match known selectors. */
export const HIDE_OVERLAYS_SCRIPT = String.raw`
() => {
  const words = /(cookie|consent|privacy|gdpr|toestemming|akkoord|accepteer|accept all|alle cookies)/i;
  let hidden = 0;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (el.matches('header, nav, [role="banner"]') || el.closest('header, nav, [role="banner"]')) continue;
    const z = parseInt(cs.zIndex || '0', 10);
    const r = el.getBoundingClientRect();
    const covers = r.width * r.height > window.innerWidth * window.innerHeight * 0.08;
    if ((z >= 100 || covers) && words.test((el.innerText || '').slice(0, 600)) && !el.querySelector('header, nav')) {
      el.style.setProperty('display', 'none', 'important');
      hidden++;
    }
  }
  return hidden;
}
`;
