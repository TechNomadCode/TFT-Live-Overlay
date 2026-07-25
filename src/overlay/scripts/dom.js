// Tiny DOM helpers shared by the render modules.
//
// The page repaints every 2.5s whether anything changed or not, so every write
// here is diffed first. Skipping an unchanged write costs one comparison and
// saves the compositor a layout pass -- worth it on a source that's on screen
// for an entire stream.

(function (ns) {
  'use strict';

  function el(id) {
    return document.getElementById(id);
  }

  function setSafeText(id, text) {
    const node = el(id);
    if (node && node.textContent !== text) {
      node.textContent = text;
    }
  }

  function setHtmlIfChanged(node, html) {
    if (node && node.innerHTML !== html) {
      node.innerHTML = html;
    }
  }

  ns.el = el;
  ns.setSafeText = setSafeText;
  ns.setHtmlIfChanged = setHtmlIfChanged;
}(window.TFTOverlay = window.TFTOverlay || {}));
