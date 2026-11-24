// theme.js - light / dark mode.
// This file is loaded in the <head> (before the page is drawn), so the saved theme is applied first
// and there is no white flash. The choice is remembered in this browser.
(function () {
  var KEY = 'cspc-theme';
  var root = document.documentElement;

  function saved() {
    try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; }
    catch (e) { return null; }
  }
  function preferred() {          // first visit: follow the computer's own light/dark setting
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function paint() {              // keep every toggle button's label in sync for screen readers
    var dark = root.getAttribute('data-theme') === 'dark';
    var next = dark ? 'light' : 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(dark));
      b.setAttribute('aria-label', 'Switch to ' + next + ' mode');
      b.setAttribute('title', 'Switch to ' + next + ' mode');
    });
  }
  function apply(theme) { root.setAttribute('data-theme', theme); paint(); }

  apply(saved() || preferred());

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: still works for this page */ }
        apply(next);
      });
    });
    paint();
  });

  // Another tab of the same browser changed the theme: follow it
  window.addEventListener('storage', function (e) {
    if (e.key === KEY && (e.newValue === 'dark' || e.newValue === 'light')) apply(e.newValue);
  });
})();