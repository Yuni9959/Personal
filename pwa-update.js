(() => {
  "use strict";

  const currentScriptUrl = document.currentScript?.src;
  if (!currentScriptUrl || !("serviceWorker" in navigator)) return;

  const serviceWorkerUrl = new URL("./sw.js", currentScriptUrl);
  const hadControllerAtStart = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  let updateRequested = false;
  let banner = null;

  function hasActiveTraining() {
    if (document.body.dataset.sessionActive === "true") return true;
    const quizView = document.querySelector("#quizView");
    return Boolean(quizView && !quizView.classList.contains("hidden"));
  }

  function showUpdate(registration) {
    if (banner || !registration.waiting) return;

    banner = document.createElement("aside");
    banner.className = "pwa-update-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");

    const message = document.createElement("p");
    message.textContent = "새 버전이 준비되었습니다.";

    const actions = document.createElement("div");
    actions.className = "pwa-update-actions";

    const laterButton = document.createElement("button");
    laterButton.type = "button";
    laterButton.textContent = "나중에";
    laterButton.addEventListener("click", () => {
      banner?.remove();
      banner = null;
    });

    const updateButton = document.createElement("button");
    updateButton.type = "button";
    updateButton.className = "pwa-update-confirm";
    updateButton.textContent = "업데이트";
    updateButton.addEventListener("click", () => {
      if (hasActiveTraining() &&
          !window.confirm("현재 훈련을 마치기 전에 업데이트하면 진행 화면이 닫힙니다. 지금 업데이트할까요?")) {
        return;
      }

      updateButton.disabled = true;
      laterButton.disabled = true;
      message.textContent = "새 버전을 적용하는 중입니다.";
      updateRequested = true;
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    });

    actions.append(laterButton, updateButton);
    banner.append(message, actions);
    document.body.appendChild(banner);
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || (!hadControllerAtStart && !updateRequested)) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(serviceWorkerUrl);

      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdate(registration);
      }

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" &&
              navigator.serviceWorker.controller) {
            showUpdate(registration);
          }
        });
      });

      window.setTimeout(() => registration.update().catch(() => {}), 1500);
    } catch (error) {
      console.warn("Service Worker를 등록하지 못했습니다.", error);
    }
  });
})();
