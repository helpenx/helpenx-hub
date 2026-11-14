/* 轻天璇 Studio 系统架构页：节点悬停追踪 + 滚动揭示 */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 悬停任一节点，亮出它和相邻节点、相关连线，其余淡出 */
  var board = document.querySelector(".arch-board");
  if (board) {
    var nodes = [].slice.call(board.querySelectorAll("[data-node]"));
    var wires = [].slice.call(board.querySelectorAll("[data-edge]"));

    if (nodes.length && wires.length) {
      var links = {};
      function link(a, b) {
        links[a] = links[a] || [];
        links[b] = links[b] || [];
        if (links[a].indexOf(b) === -1) links[a].push(b);
        if (links[b].indexOf(a) === -1) links[b].push(a);
      }
      wires.forEach(function (wire) {
        wire.getAttribute("data-edge").split(" ").forEach(function (pair) {
          var ends = pair.split("|");
          link(ends[0], ends[1]);
        });
      });
      nodes.forEach(function (node) {
        var hub = node.getAttribute("data-hub");
        if (hub) link(hub, node.getAttribute("data-node"));
      });

      var runtime = board.querySelector(".arch-runtime");
      var current = null;

      function paint(id) {
        current = id;
        var related = links[id] || [];
        board.classList.add("is-tracing");
        nodes.forEach(function (node) {
          var nodeId = node.getAttribute("data-node");
          node.classList.toggle("is-focus", nodeId === id);
          node.classList.toggle("is-related", nodeId === id || related.indexOf(nodeId) !== -1);
        });
        wires.forEach(function (wire) {
          var hit = wire.getAttribute("data-edge").split(" ").some(function (pair) {
            return pair.split("|").indexOf(id) !== -1;
          });
          wire.classList.toggle("is-related", hit);
        });
        if (runtime) runtime.classList.toggle("is-related", !!runtime.querySelector("[data-node].is-related"));
      }

      function clear() {
        if (current === null) return;
        current = null;
        board.classList.remove("is-tracing");
        nodes.forEach(function (node) { node.classList.remove("is-focus", "is-related"); });
        wires.forEach(function (wire) { wire.classList.remove("is-related"); });
        if (runtime) runtime.classList.remove("is-related");
      }

      nodes.forEach(function (node) {
        node.addEventListener("mouseenter", function () { paint(node.getAttribute("data-node")); });
        node.addEventListener("mouseleave", clear);
        node.addEventListener("focus", function () { paint(node.getAttribute("data-node")); });
        node.addEventListener("blur", clear);
      });

      /* 生命周期步骤：点一下回到架构板，高亮对应组件片刻 */
      var steps = [].slice.call(document.querySelectorAll(".arch-step[data-focus]"));
      var stepTimer = null;
      steps.forEach(function (step) {
        step.addEventListener("click", function () {
          var id = step.getAttribute("data-focus");
          if (!links[id]) return;
          board.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
          paint(id);
          steps.forEach(function (s) { s.classList.remove("is-active"); });
          step.classList.add("is-active");
          if (stepTimer) window.clearTimeout(stepTimer);
          stepTimer = window.setTimeout(function () {
            step.classList.remove("is-active");
            clear();
          }, 2600);
        });
      });
    }
  }

  /* 滚动揭示：标题、架构板、每一层与说明逐段入场 */
  var revealNodes = [].slice.call(document.querySelectorAll(
    ".arch-page__back, .arch__head > *, .arch-toc, .arch-board, .arch-layer, " +
    ".arch-sec__head > *, .arch-step, .arch-gate, .arch-op, .arch-extend__item, .arch-table-wrap, " +
    ".arch-notes > li, .arch-page__actions"
  ));
  if (reduce || !("IntersectionObserver" in window)) {
    revealNodes.forEach(function (node) { node.classList.add("reveal", "is-visible"); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    revealNodes.forEach(function (node, i) {
      node.classList.add("reveal");
      node.style.setProperty("--reveal-delay", Math.min(i, 9) * 55 + "ms");
      observer.observe(node);
    });
  }

  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
