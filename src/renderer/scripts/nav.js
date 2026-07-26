// The sidebar: page switching, and the Quit button.
//
// Quit is here rather than left to the window's X because the X hides to tray
// (the overlay server has to keep serving OBS), so without this the only real
// way out is the tray icon's context menu.

(function (ns) {
  'use strict';

  function show(page) {
    document.querySelectorAll('.nav-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.page === page);
    });
    document.querySelectorAll('.page').forEach((p) => {
      p.classList.toggle('active', p.id === `page-${page}`);
    });
  }

  function init() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => show(btn.dataset.page));
    });

    document.getElementById('quitBtn').addEventListener('click', () => {
      window.tftApp.quitApp();
    });
  }

  ns.showPage = show;
  ns.initNav = init;
}(window.TFTSettings = window.TFTSettings || {}));
