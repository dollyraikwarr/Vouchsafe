/**
 * marketing.js
 * Handles the new marketing site only: FAQ accordion, scroll-reveal,
 * and the illustrative hero terminal demo. Deliberately kept separate
 * from app.js — it never touches wallet/contract state or dashboard IDs.
 */

(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- FAQ accordion ---------------- */
  document.querySelectorAll(".mkt-faq-item").forEach(function (item) {
    var btn = item.querySelector(".mkt-faq-q");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var isOpen = item.classList.contains("is-open");
      document.querySelectorAll(".mkt-faq-item.is-open").forEach(function (openItem) {
        if (openItem !== item) {
          openItem.classList.remove("is-open");
          var openBtn = openItem.querySelector(".mkt-faq-q");
          if (openBtn) openBtn.setAttribute("aria-expanded", "false");
        }
      });
      item.classList.toggle("is-open", !isOpen);
      btn.setAttribute("aria-expanded", String(!isOpen));
    });
  });

  /* ---------------- Scroll reveal ---------------- */
  var revealTargets = document.querySelectorAll(".mkt-reveal");
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealTargets.forEach(function (el) { el.classList.add("in-view"); });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    revealTargets.forEach(function (el) { observer.observe(el); });
  }

  /* ---------------- Hero terminal demo ---------------- */
  var stepsEl = document.getElementById("mktTermSteps");
  var logEl = document.getElementById("mktTermLog");
  if (!stepsEl || !logEl) return;

  var steps = [
    { key: "created", evt: "created", detail: "engagement #482 · client → developer" },
    { key: "funded", evt: "funded", detail: "500.0000000 locked in escrow" },
    { key: "submitted", evt: "submitted", detail: "deliverable proof recorded on-chain" },
    { key: "approved", evt: "approved", detail: "client approved deliverable" },
    { key: "released", evt: "released", detail: "500.0000000 → developer" },
    { key: "completed", evt: "completed", detail: "engagement #482 closed" }
  ];

  var stepNodes = steps.map(function (s) {
    return stepsEl.querySelector('[data-step="' + s.key + '"]');
  });

  function randomHash() {
    var chars = "0123456789abcdef";
    var out = "";
    for (var i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out + "…";
  }

  function timestamp(offsetSeconds) {
    var d = new Date(Date.now() - offsetSeconds * 1000);
    return d.toLocaleTimeString("en-US", { hour12: false });
  }

  function renderStaticFinalState() {
    stepNodes.forEach(function (node) {
      if (node) node.classList.add("is-done");
    });
    logEl.innerHTML = steps
      .map(function (s, i) {
        return (
          '<div class="mkt-term-line"><span class="t">' +
          timestamp((steps.length - i) * 4) +
          '</span><span class="evt">' +
          s.evt +
          "</span>" +
          s.detail +
          ' <span class="hash">· ' +
          randomHash() +
          "</span></div>"
        );
      })
      .join("");
  }

  if (prefersReducedMotion) {
    renderStaticFinalState();
    return;
  }

  var current = 0;
  var lineTimer = null;
  var cycleTimer = null;

  function resetCycle() {
    stepNodes.forEach(function (node) {
      if (node) node.classList.remove("is-active", "is-done");
    });
    logEl.innerHTML = "";
    current = 0;
  }

  function advance() {
    if (current > 0 && stepNodes[current - 1]) {
      stepNodes[current - 1].classList.remove("is-active");
      stepNodes[current - 1].classList.add("is-done");
    }
    if (current >= steps.length) {
      cycleTimer = setTimeout(function () {
        resetCycle();
        lineTimer = setTimeout(advance, 700);
      }, 2600);
      return;
    }

    var step = steps[current];
    if (stepNodes[current]) stepNodes[current].classList.add("is-active");

    var line = document.createElement("div");
    line.className = "mkt-term-line";
    line.innerHTML =
      '<span class="t">' +
      timestamp(0) +
      '</span><span class="evt">' +
      step.evt +
      "</span>" +
      step.detail +
      ' <span class="hash">· ' +
      randomHash() +
      "</span>";
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;

    current += 1;
    lineTimer = setTimeout(advance, 1150);
  }

  advance();

  // Pause the loop when the hero scrolls out of view to save cycles.
  if ("IntersectionObserver" in window) {
    var heroObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) {
          clearTimeout(lineTimer);
          clearTimeout(cycleTimer);
        } else if (!lineTimer && !cycleTimer) {
          lineTimer = setTimeout(advance, 400);
        }
      });
    }, { threshold: 0.1 });
    heroObserver.observe(logEl.closest(".mkt-hero"));
  }
})();
