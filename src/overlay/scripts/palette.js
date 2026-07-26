// Derives the whole accent ramp from one base colour and writes it onto the
// card as custom properties, plus the tier class that materials.css keys off.
// Everything tier-reactive in the CSS reads one or the other, so a rank change
// repaints the frame, the goal bar, the crest bloom, the particles and the
// takeover banner together without any of them needing to know about tiers.

(function (ns, Tiers) {
  'use strict';

  // Written alongside the custom properties because a single colour can't
  // express how polished the metal is or what the particles do -- see the
  // header comment in materials.css.
  const TIER_CLASSES = Tiers.TIER_SLUGS.map(function (s) { return 't-' + s; });

  let lastPaletteTier = null;

  function applyTierPalette(tier) {
    const c = Tiers.TIER_COLORS[tier];
    const card = ns.el('card');
    if (!card) return;

    // Unranked / not yet tracking: strip the tier styling entirely rather than
    // leaving the previous tier's metal on a card that no longer claims it.
    if (!c) {
      card.classList.remove.apply(card.classList, TIER_CLASSES);
      lastPaletteTier = null;
      return;
    }
    if (tier === lastPaletteTier) return;
    lastPaletteTier = tier;

    const [r, g, b] = c;
    const scale = (f) => `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
    card.style.setProperty('--tier-bright', `rgb(${r}, ${g}, ${b})`);
    card.style.setProperty('--tier-dim', scale(0.55));
    card.style.setProperty('--tier-mid', scale(0.30));
    card.style.setProperty('--tier-deep', scale(0.17));
    card.style.setProperty('--tier-ring', `rgba(${r}, ${g}, ${b}, 0.55)`);
    card.style.setProperty('--tier-glow', `rgba(${r}, ${g}, ${b}, 0.30)`);

    card.classList.remove.apply(card.classList, TIER_CLASSES);
    card.classList.add('t-' + Tiers.slugFor(tier));
  }

  ns.applyTierPalette = applyTierPalette;
}(window.TFTOverlay = window.TFTOverlay || {}, window.TFT.Tiers));
