// Derives the whole accent ramp from one base colour and writes it onto the
// card as custom properties. Everything tier-reactive in the CSS reads these,
// so a rank change repaints the goal bar, the crest bloom and the takeover
// banner together without any of them needing to know about tiers.

(function (ns, Tiers) {
  'use strict';

  let lastPaletteTier = null;

  function applyTierPalette(tier) {
    const c = Tiers.TIER_COLORS[tier];
    if (!c || tier === lastPaletteTier) return;
    lastPaletteTier = tier;

    const [r, g, b] = c;
    const scale = (f) => `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
    const card = ns.el('card');
    card.style.setProperty('--tier-bright', `rgb(${r}, ${g}, ${b})`);
    card.style.setProperty('--tier-dim', scale(0.55));
    card.style.setProperty('--tier-mid', scale(0.30));
    card.style.setProperty('--tier-deep', scale(0.17));
    card.style.setProperty('--tier-ring', `rgba(${r}, ${g}, ${b}, 0.55)`);
    card.style.setProperty('--tier-glow', `rgba(${r}, ${g}, ${b}, 0.30)`);
  }

  ns.applyTierPalette = applyTierPalette;
}(window.TFTOverlay = window.TFTOverlay || {}, window.TFT.Tiers));
