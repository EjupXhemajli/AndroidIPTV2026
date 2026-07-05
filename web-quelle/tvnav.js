/* ============================================================
   EX-IPTV – Fernbedienungs-Steuerung (TV-Modus)
   Wird nur aktiv, wenn die Oberfläche mit ?tv=1 geladen wird
   (die Android-App setzt das auf Fernsehern/Fire-Sticks/Boxen).
   Bietet räumliche Navigation mit dem Steuerkreuz, eine sichtbare
   Fokus-Hervorhebung und OK-/Zurück-Behandlung – ohne den
   bestehenden Maus-/Touch-Code zu verändern.
   ============================================================ */
(function () {
  "use strict";

  // Nur im TV-Modus aktivieren
  var params = new URLSearchParams(location.search);
  var TV = params.get("tv") === "1";
  if (!TV) return;

  document.documentElement.classList.add("tv-mode");
  document.body && document.body.classList.add("tv-mode");
  // Falls body noch nicht da:
  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("tv-mode");
  });

  // Welche Elemente sind anklickbar/fokussierbar?
  var FOCUSABLE = [
    ".rail-btn",
    ".tile",
    ".tab", ".pl-tab",
    "button:not([disabled])",
    "input:not([type=hidden]):not([disabled])",
    "select", "textarea",
    "a[href]",
    ".row", ".channel-row", ".ch-row",
    ".vod-card", ".card", ".poster", ".vod-item",
    ".group", ".cat", ".category",
    "[data-nav]",
    "[onclick]",
    ".clickable"
  ].join(",");

  var current = null;

  function isVisible(el) {
    if (!el) return false;
    // Leichtgewichtig: nur Größe/Position prüfen, KEIN getComputedStyle pro
    // Element (das bremst auf schwachen TV-Boxen bei langen Senderlisten stark).
    // Ein per display:none versteckter Vorfahr liefert ohnehin Größe 0.
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    return true;
  }

  // Liefert den aktuell offenen Dialog (modal-bg ohne hidden) oder null.
  // Wichtig: modal-bg ist position:fixed -> offsetParent ist immer null,
  // daher hier NICHT über offsetParent prüfen, sondern über Klasse + Größe.
  function openDialog() {
    var bgs = document.querySelectorAll(".modal-bg, .modal-wrap, .overlay");
    for (var i = 0; i < bgs.length; i++) {
      var bg = bgs[i];
      if (bg.classList.contains("hidden")) continue;
      var cs = getComputedStyle(bg);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var r = bg.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) return bg;
    }
    return null;
  }

  function candidates() {
    // Ist ein Dialog offen? Dann NUR darin navigieren.
    var scope = openDialog() || document;
    var all = scope.querySelectorAll(FOCUSABLE);
    var out = [];
    // Jedes Element GENAU EINMAL messen (vorher: einmal in isVisible, einmal in
    // findNext -> doppelt). querySelectorAll liefert jeden Knoten ohnehin nur
    // einmal, daher entfällt auch die teure indexOf-Prüfung (war O(N²) und auf
    // langen Listen der Hauptbremser).
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // Innerhalb einer Poster-Kachel ist NUR die Kachel selbst ein Fokusziel
      // (Stern-Button fängt sonst die Links/Rechts-Navigation ab). Ausnahme:
      // "Weiter schauen"-Karten – dort soll das ✕ (Entfernen) per Fernbedienung
      // erreichbar bleiben.
      if (!el.classList.contains("poster") && el.closest && el.closest(".poster")
          && !el.closest(".continue-card")) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      out.push({ el: el, r: r });
    }
    return out;
  }

  function center(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r };
  }

  // Abstand zwischen zwei Bereichen auf einer Achse: 0 wenn sie sich
  // überlappen, sonst der Abstand der nächsten Kanten.
  function axisGap(aMin, aMax, bMin, bMax) {
    if (aMax < bMin) return bMin - aMax;
    if (bMax < aMin) return aMin - bMax;
    return 0;
  }

  // Nächstes Element in Richtung dir finden ("up","down","left","right").
  // Bewertung über Kanten + Überlappung: Eine breite Zeile (z. B. ein Dropdown),
  // die direkt unter dem Fokus liegt und dessen Spalte überlappt, gewinnt gegen
  // eine schmale Checkbox weiter weg. So wird nichts mehr übersprungen.
  function findNext(dir) {
    if (!current || !document.contains(current) || !isVisible(current)) {
      return firstFocusable();
    }
    var cr = current.getBoundingClientRect();
    var list = candidates();
    var best = null, bestScore = Infinity;

    for (var i = 0; i < list.length; i++) {
      var el = list[i].el;
      if (el === current) continue;
      var r = list[i].r;
      var primary, secondary, ok;
      if (dir === "down") {
        ok = r.top > cr.top + 4;
        primary = r.top - cr.top;
        secondary = axisGap(cr.left, cr.right, r.left, r.right);
      } else if (dir === "up") {
        ok = r.bottom < cr.bottom - 4;
        primary = cr.bottom - r.bottom;
        secondary = axisGap(cr.left, cr.right, r.left, r.right);
      } else if (dir === "right") {
        ok = r.left > cr.left + 4;
        primary = r.left - cr.left;
        secondary = axisGap(cr.top, cr.bottom, r.top, r.bottom);
      } else { // left
        ok = r.right < cr.right - 4;
        primary = cr.right - r.right;
        secondary = axisGap(cr.top, cr.bottom, r.top, r.bottom);
      }
      if (!ok) continue;
      // Gestuft: Ein in der Querachse ÜBERLAPPENDER Nachbar (secondary == 0) wird
      // immer einem nicht überlappenden vorgezogen – egal wie weit er entfernt ist.
      // Sonst springt der Fokus aus einem Kachelraster in eine dicht stehende
      // Nachbarspalte (z. B. Kategorienliste) statt zur Kachel darunter.
      // Bei MEHREREN überlappenden Zielen (z. B. ein hohes Element neben vielen
      // kurzen Zeilen) entscheidet zusätzlich der Mittelpunkt-Abstand auf der
      // Querachse – so landet der Fokus auf der Zeile AUF GLEICHER HÖHE und bleibt
      // nicht an der obersten überlappenden „hängen".
      var crossDelta = (dir === "left" || dir === "right")
        ? Math.abs((r.top + r.bottom) / 2 - (cr.top + cr.bottom) / 2)
        : Math.abs((r.left + r.right) / 2 - (cr.left + cr.right) / 2);
      var score;
      if (secondary === 0) score = primary * 1000 + crossDelta;
      else score = 1e9 + secondary * 4000 + primary;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function firstFocusable() {
    var list = candidates();
    if (!list.length) return null;
    // Bevorzugt ein Element im sichtbaren Bereich, möglichst oben/links
    list.sort(function (a, b) {
      return (a.r.top - b.r.top) || (a.r.left - b.r.left);
    });
    for (var i = 0; i < list.length; i++) {
      if (list[i].r.top >= -10 && list[i].r.top < window.innerHeight) return list[i].el;
    }
    return list[0].el;
  }

  // Nächsten scrollbaren Vorfahren finden (für die Rand-Nachführung).
  function scrollableAncestor(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 4) return n;
    }
    return document.scrollingElement || document.documentElement;
  }
  // Am Rand der geladenen Liste ein Stück in Richtung scrollen, damit
  // nachgeladene Poster/Kanäle erreichbar werden. Gibt true zurück, wenn
  // tatsächlich gescrollt wurde.
  function nudgeScroll(dir) {
    if (!current) return false;
    var sc = scrollableAncestor(current);
    if (!sc) return false;
    var step = Math.max(140, Math.round(sc.clientHeight * 0.6));
    var before = sc.scrollTop;
    if (dir === "down") {
      if (before + sc.clientHeight >= sc.scrollHeight - 2) return false;
      sc.scrollTop = before + step;
    } else {
      if (before <= 0) return false;
      sc.scrollTop = before - step;
    }
    return sc.scrollTop !== before;
  }

  function setFocus(el) {
    if (!el) return;
    if (current && current !== el) current.classList.remove("tv-focus");
    current = el;
    el.classList.add("tv-focus");
    try {
      // Sofort scrollen (KEIN "smooth") – ruckelt sonst auf schwachen Boxen.
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch (e) {
      el.scrollIntoView(false);
    }
    // Nur echte Texteingaben hart fokussieren (für die Bildschirmtastatur).
    // Auswahlfelder NICHT fokussieren – das öffnet auf der Box ein hakeliges
    // System-Dropdown. Sie werden per Links/Rechts/OK gesteuert.
    var tag = el.tagName.toLowerCase();
    var type = (el.type || "").toLowerCase();
    if ((tag === "input" && type !== "range" && type !== "checkbox" && type !== "radio") || tag === "textarea") {
      try { el.focus(); } catch (e) {}
    }
  }

  // Wert eines Auswahlfeldes/Schiebereglers per Fernbedienung ändern.
  function fireChange(el) {
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
  }
  function cycleSelect(sel, d) {
    var n = sel.options ? sel.options.length : 0;
    if (!n) return;
    var i = sel.selectedIndex < 0 ? 0 : sel.selectedIndex;
    i = (i + d + n) % n;
    sel.selectedIndex = i;
    fireChange(sel);
  }
  function stepRange(r, d) {
    var step = parseFloat(r.step) || 1;
    var min = r.min !== "" ? parseFloat(r.min) : 0;
    var max = r.max !== "" ? parseFloat(r.max) : 100;
    var v = parseFloat(r.value);
    if (isNaN(v)) v = min;
    v = Math.min(max, Math.max(min, v + d * step));
    r.value = v;
    fireChange(r);
  }

  function activate(el) {
    if (!el) return;
    var tag = el.tagName.toLowerCase();
    var type = (el.type || "").toLowerCase();
    // Schalter umlegen
    if (tag === "input" && (type === "checkbox" || type === "radio")) {
      el.click(); // klick toggelt UND feuert das change-Ereignis
      return;
    }
    // Auswahlfeld: OK schaltet eine Option weiter (System-Dropdown ist hakelig)
    if (tag === "select") { cycleSelect(el, 1); return; }
    // Texteingabe: fokussieren -> Tastatur
    if (tag === "input" || tag === "textarea") {
      try { el.focus(); } catch (e) {}
      return;
    }
    // Klick auslösen
    el.click();
    // Nach kurzem Moment Fokus neu setzen (Ansicht hat evtl. gewechselt)
    setTimeout(function () {
      if (!current || !document.contains(current) || !isVisible(current)) {
        setFocus(firstFocusable());
      }
    }, 350);
  }

  function handleBack() {
    // 1) Läuft ein Sender? -> Player schließen (Escape, wie die Oberfläche es erwartet)
    var player = document.getElementById("player");
    if (player && !player.classList.contains("hidden")) {
      var plBack = document.getElementById("pl-back");
      if (plBack) { plBack.click(); }
      else {
        var ev = new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true });
        document.dispatchEvent(ev);
      }
      setTimeout(function () { setFocus(firstFocusable()); }, 250);
      return true;
    }
    // 2) Offener Dialog? -> schließen
    var dlg = openDialog();
    if (dlg) {
      // Schließen-Knopf im Dialog suchen
      var close = dlg.querySelector(".ghost-btn, [id$=-close], .btn-close, .close, [data-close]");
      if (close) { close.click(); }
      else { dlg.classList.add("hidden"); }
      setTimeout(function () { setFocus(firstFocusable()); }, 250);
      return true;
    }
    // 2b) Offene VOD-Posterseite? -> zurück zu den Kategorien
    if (window.EXVOD && EXVOD.isGridOpen && EXVOD.isGridOpen()) {
      EXVOD.closeGrid();
      return true;
    }
    // 3) Nicht auf der Startseite? -> zur Startseite
    if (typeof showView === "function" && typeof currentView !== "undefined" && currentView !== "home") {
      showView("home");
      setTimeout(function () { setFocus(firstFocusable()); }, 250);
      return true;
    }
    // 4) Auf der Startseite: nichts zu tun (App-Hülle entscheidet -> evtl. App verlassen)
    return false;
  }

  // Diese Funktion ruft die Android-Hülle bei Tastendruck auf.
  window.EXTV = {
    key: function (dir) {
      try {
        if (dir === "ok") { activate(current || firstFocusable()); return true; }
        if (dir === "back") { return handleBack(); }
        // Auf einem Auswahlfeld/Schieberegler ändern Links/Rechts den WERT,
        // statt den Fokus zu verschieben (sonst sind die Einstellungen mit der
        // Fernbedienung nicht bedienbar).
        if (current && (dir === "left" || dir === "right")) {
          var tag = current.tagName.toLowerCase();
          var type = (current.type || "").toLowerCase();
          if (tag === "select") { cycleSelect(current, dir === "right" ? 1 : -1); return true; }
          if (tag === "input" && type === "range") { stepRange(current, dir === "right" ? 1 : -1); return true; }
        }
        var next = findNext(dir);
        if (next) { setFocus(next); return true; }
        // Kein Ziel gefunden: am unteren/oberen Rand der bereits geladenen Liste
        // ein Stück nachscrollen (lädt weitere Poster/Kanäle) und erneut suchen.
        if (dir === "down" || dir === "up") {
          if (nudgeScroll(dir)) {
            setTimeout(function () {
              var n2 = findNext(dir);
              if (n2) setFocus(n2);
            }, 90);
            return true;
          }
        }
        // Sonst Fokus behalten
        if (!current) { setFocus(firstFocusable()); }
        return false;
      } catch (e) {
        return false;
      }
    },
    refocus: function () { setFocus(firstFocusable()); }
  };

  // Bei Ansichts-/Dialogwechsel den Fokus sinnvoll neu setzen.
  // Schlank gehalten (nur childList + Dialog-Sichtbarkeit), damit es auf
  // schwächeren TV-Boxen nicht bremst.
  var lastDialog = null;
  var refocusTimer = null;
  function scheduleRefocus() {
    clearTimeout(refocusTimer);
    refocusTimer = setTimeout(function () {
      var dlg = openDialog();
      // Hat sich ein Dialog geöffnet/geschlossen? -> Fokus immer neu setzen.
      if (dlg !== lastDialog) {
        lastDialog = dlg;
        setFocus(firstFocusable());
        return;
      }
      // Sonst nur neu fokussieren, wenn der aktuelle Fokus verloren ging.
      if (!current || !document.contains(current) || !isVisible(current)) {
        setFocus(firstFocusable());
      }
    }, 200);
  }
  var mo = new MutationObserver(scheduleRefocus);
  function startObserving() {
    try {
      // Nur Struktur-Änderungen beobachten (Ansichtswechsel), nicht jede Klasse –
      // das ist deutlich leichtgewichtiger.
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    setTimeout(function () { setFocus(firstFocusable()); }, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserving);
  } else {
    startObserving();
  }
})();
