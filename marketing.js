// Vouchsafe marketing site behaviour.
// Scoped entirely to new marketing markup — never touches an id or class
// that app.js reads or writes. Safe to remove without affecting the app.

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Mobile nav toggle ---------------- */
  var navToggle = document.getElementById("navToggle");
  var navLinks = document.getElementById("marketingNavLinks");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      var isOpen = navLinks.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------------- Scroll reveal ---------------- */
  var revealEls = document.querySelectorAll(".reveal");

  if (revealEls.length && "IntersectionObserver" in window && !reduceMotion) {
    document.documentElement.classList.add("js-reveal-ready");

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    revealEls.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ---------------- FAQ accordion ---------------- */
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var question = item.querySelector(".faq-question");
    if (!question) return;

    question.addEventListener("click", function () {
      var wasOpen = item.classList.contains("open");

      document.querySelectorAll(".faq-item.open").forEach(function (openItem) {
        if (openItem !== item) {
          openItem.classList.remove("open");
          var q = openItem.querySelector(".faq-question");
          if (q) q.setAttribute("aria-expanded", "false");
        }
      });

      item.classList.toggle("open", !wasOpen);
      question.setAttribute("aria-expanded", String(!wasOpen));
    });
  });

  /* ---------------- Hero lifecycle simulator ---------------- */
  var simEls = {
    clientFill: document.getElementById("simClientFill"),
    escrowFill: document.getElementById("simEscrowFill"),
    devFill: document.getElementById("simDevFill"),
    clientAmount: document.getElementById("simClientAmount"),
    escrowAmount: document.getElementById("simEscrowAmount"),
    devAmount: document.getElementById("simDevAmount"),
    log: document.getElementById("simLog"),
    statusText: document.getElementById("simStatusText"),
  };

  if (simEls.log && simEls.clientFill) {
    var AMOUNT = 500;
    var engagementId = 482;

    function fmt(n) {
      return n.toFixed(0) + " XLM";
    }

    function setBalances(client, escrow, dev) {
      simEls.clientFill.style.width = (client / AMOUNT) * 100 + "%";
      simEls.escrowFill.style.width = (escrow / AMOUNT) * 100 + "%";
      simEls.devFill.style.width = (dev / AMOUNT) * 100 + "%";
      simEls.clientAmount.textContent = fmt(client);
      simEls.escrowAmount.textContent = fmt(escrow);
      simEls.devAmount.textContent = fmt(dev);
    }

    function fakeHash() {
      var chars = "abcdef0123456789";
      var out = "";
      for (var i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
      return out;
    }

    function log(text, cls) {
      var line = document.createElement("div");
      if (cls) line.className = cls;
      line.textContent = text;
      simEls.log.prepend(line);
      while (simEls.log.children.length > 5) {
        simEls.log.removeChild(simEls.log.lastChild);
      }
    }

    function clearLog() {
      simEls.log.innerHTML = "";
    }

    // Static end-state for reduced-motion users: no looping animation,
    // just show a completed engagement so the widget still communicates.
    if (reduceMotion) {
      setBalances(0, 0, AMOUNT);
      clearLog();
      log("$ approve_work(" + engagementId + ")", "sim-log-call");
      log("→ event: released · " + AMOUNT + " XLM → developer", "sim-log-event");
      log("→ event: completed · engagement #" + engagementId + " closed", "sim-log-event");
      if (simEls.statusText) simEls.statusText.textContent = "Engagement lifecycle (static preview)";
      return;
    }

    var STEP_DELAY = 1450;
    var LOOP_PAUSE = 3200;
    var timer = null;

    var steps = [
      {
        run: function () {
          engagementId += 1;
          setBalances(AMOUNT, 0, 0);
          clearLog();
          if (simEls.statusText) simEls.statusText.textContent = "Simulating engagement lifecycle";
          log("$ create_engagement(client, developer, token, 500, deadline)", "sim-log-call");
        },
      },
      {
        run: function () {
          log("→ event: created · engagement #" + engagementId, "sim-log-event");
        },
      },
      {
        run: function () {
          log("$ fund_engagement(" + engagementId + ")", "sim-log-call");
        },
      },
      {
        run: function () {
          setBalances(0, AMOUNT, 0);
          log("→ event: funded · " + AMOUNT + " XLM locked in escrow", "sim-log-event");
        },
      },
      {
        run: function () {
          log("$ submit_work(" + engagementId + ", url, pr, commit, note)", "sim-log-call");
        },
      },
      {
        run: function () {
          log("→ event: submitted · deliverable recorded on-chain", "sim-log-event");
        },
      },
      {
        run: function () {
          log("$ approve_work(" + engagementId + ")", "sim-log-call");
        },
      },
      {
        run: function () {
          setBalances(0, 0, AMOUNT);
          log("→ event: released · " + AMOUNT + " XLM → developer  [" + fakeHash() + "]", "sim-log-event");
        },
      },
      {
        run: function () {
          log("→ event: completed · engagement #" + engagementId + " closed", "sim-log-event");
          if (simEls.statusText) simEls.statusText.textContent = "Engagement complete";
        },
      },
    ];

    var stepIndex = 0;

    function tick() {
      steps[stepIndex].run();
      var isLast = stepIndex === steps.length - 1;
      stepIndex = (stepIndex + 1) % steps.length;
      timer = setTimeout(tick, isLast ? LOOP_PAUSE : STEP_DELAY);
    }

    // Only run the loop while the hero is actually visible, so it isn't
    // burning cycles once someone has scrolled deep into the page.
    var heroSim = document.querySelector(".hero-sim");
    if (heroSim && "IntersectionObserver" in window) {
      var simObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !timer) {
            tick();
          } else if (!entry.isIntersecting && timer) {
            clearTimeout(timer);
            timer = null;
          }
        });
      });
      simObserver.observe(heroSim);
    } else {
      tick();
    }
  }
})();
