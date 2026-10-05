/* RoyaltyOS landing interactions — vanilla, CSP-safe (no inline handlers, no CDN). */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(pointer: fine)").matches;

  /* sticky nav state */
  var nav = document.getElementById("topnav");
  var onScrollNav = function () {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();

  /* mobile menu */
  var burger = document.getElementById("burger");
  var mnav = document.getElementById("mnav");
  if (burger && mnav) {
    burger.addEventListener("click", function () {
      var open = mnav.hidden;
      mnav.hidden = !open;
      burger.setAttribute("aria-expanded", String(open));
      burger.textContent = open ? "✕" : "☰";
    });
    mnav.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        mnav.hidden = true;
        burger.setAttribute("aria-expanded", "false");
        burger.textContent = "☰";
      }
    });
  }

  /* scroll reveals */
  var els = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var revealInView = function () {
    var vh = window.innerHeight || 0;
    els.forEach(function (el) {
      if (el.classList.contains("in")) return;
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > 0) el.classList.add("in");
    });
  };
  if (reduced || !("IntersectionObserver" in window)) {
    els.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (el) { io.observe(el); });
    /* Safety: headless/slow IO still shows above-fold content. */
    window.addEventListener("load", function () {
      setTimeout(revealInView, 400);
      setTimeout(revealInView, 1500);
    });
    revealInView();
  }

  /* animated money counter */
  var counters = document.querySelectorAll("[data-count]");
  var fmt = function (cents) {
    return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
  };
  var runCounter = function (el) {
    var target = parseInt(el.getAttribute("data-count"), 10) * 100;
    if (reduced) { el.textContent = fmt(target); return; }
    var t0 = null, dur = 1400;
    var step = function (t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(target * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ("IntersectionObserver" in window && !reduced) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { runCounter(en.target); cio.unobserve(en.target); }
      });
    }, { threshold: 0.4 });
    counters.forEach(function (c) { cio.observe(c); });
  } else {
    counters.forEach(runCounter);
  }

  /* steps progress rail */
  var progress = document.getElementById("progress");
  var cards = document.querySelector(".l-cards");
  var updateProgress = function () {
    if (!progress || !cards || reduced) return;
    var r = cards.getBoundingClientRect();
    var vh = window.innerHeight;
    var total = r.height - vh * 0.5;
    var done = Math.min(Math.max(-(r.top - vh * 0.35), 0), Math.max(total, 1));
    progress.style.height = (total > 0 ? (done / total) * 100 : 0).toFixed(1) + "%";
  };
  window.addEventListener("scroll", function () {
    if (!reduced) requestAnimationFrame(updateProgress);
  }, { passive: true });
  updateProgress();

  /* ledger canvas — lightweight scroll-tied line */
  var canvas = document.getElementById("ledger");
  if (canvas && !reduced) {
    var ctx = canvas.getContext("2d");
    var draw = function () {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var sy = window.scrollY;
      var shift = (sy * 0.12) % 60;
      ctx.strokeStyle = "rgba(173,103,27,.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var x = -60; x < w + 60; x += 60) {
        var x0 = x - shift;
        ctx.moveTo(x0, h * 0.9);
        ctx.bezierCurveTo(x0 + 20, h * 0.55, x0 + 40, h * 0.55, x0 + 60, h * 0.75);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(22,38,58,.5)";
      for (var i = 0; i < 5; i++) {
        var px = ((i * 197 + sy * 0.3) % (w + 40)) - 20;
        var py = h * (0.3 + 0.12 * Math.sin(i * 1.7 + sy * 0.004));
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { draw(); ticking = false; });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", draw);
    /* pause when offscreen */
    if ("IntersectionObserver" in window) {
      var visible = true;
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        if (visible) draw();
      }).observe(canvas);
      var origDraw = draw;
      draw = function () { if (visible) origDraw(); };
    }
    draw();
  }

  /* pointer tilt on proof cards (desktop only) */
  var tilt = document.getElementById("tilt");
  if (tilt && finePointer && !reduced) {
    var cards3 = tilt.querySelectorAll(".proof");
    tilt.addEventListener("pointermove", function (e) {
      var r = tilt.getBoundingClientRect();
      var dx = (e.clientX - r.left) / r.width - 0.5;
      var dy = (e.clientY - r.top) / r.height - 0.5;
      cards3.forEach(function (c, i) {
        var depth = (i + 1) * 4;
        c.style.transform = "rotate(" + (i === 1 ? -2 : 2) + "deg) translate3d(" + (dx * depth).toFixed(1) + "px," + (dy * depth).toFixed(1) + "px,0)";
      });
    });
    tilt.addEventListener("pointerleave", function () {
      cards3.forEach(function (c) { c.style.transform = ""; });
    });
  }

  /* amendment demo toggle */
  var tab1 = document.getElementById("tab1");
  var tab2 = document.getElementById("tab2");
  var dNew = document.getElementById("dNew");
  var dFlag = document.getElementById("dFlag");
  var setTab = function (v2) {
    if (!tab1 || !tab2) return;
    tab1.classList.toggle("on", !v2);
    tab2.classList.toggle("on", v2);
    tab1.setAttribute("aria-selected", String(!v2));
    tab2.setAttribute("aria-selected", String(v2));
    if (dNew) dNew.textContent = v2 ? "15%" : "20%";
    if (dFlag) {
      dFlag.innerHTML = v2
        ? '<span class="badge amber">REVIEW_REQUIRED</span> conflicts with v1 clause 4.2 — human must approve'
        : '<span class="badge green">CONSISTENT</span> no conflict with prior versions';
    }
  };
  if (tab1 && tab2) {
    tab1.addEventListener("click", function () { setTab(false); });
    tab2.addEventListener("click", function () { setTab(true); });
  }
})();
