(async function () {
  "use strict";

  const USER_ID = ""; // ここに AtCoder ID を入力
  const STORAGE_KEY = `synced_ids_${USER_ID}`;
  const SYNC_RESULT_KEY = "sync_result";
  const TOAST_DURATION_MS = 4000;
  const TOAST_FADE_DURATION_MS = 250;
  const TOAST_RELOAD_DELAY_MS = 500;
  const ATCODER_REQUEST_DELAY_BASE_MS = 1100;
  const ATCODER_REQUEST_DELAY_JITTER_MS = 100;
  const NOVISTEPS_REQUEST_DELAY_BASE_MS = 1000;
  const NOVISTEPS_REQUEST_DELAY_JITTER_MS = 500;
  const PROBLEMS_UPDATE_PATH = "/problems?/update";
  const ATCODER_SUBMISSIONS_API =
    "https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions";

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getDelayMs = (baseMs, jitterMs) => baseMs + Math.random() * jitterMs;

  const getAtCoderDelayMs = () =>
    getDelayMs(ATCODER_REQUEST_DELAY_BASE_MS, ATCODER_REQUEST_DELAY_JITTER_MS);

  const getNoviStepsDelayMs = () =>
    getDelayMs(
      NOVISTEPS_REQUEST_DELAY_BASE_MS,
      NOVISTEPS_REQUEST_DELAY_JITTER_MS,
    );

  function createSyncRequestBody(problemId) {
    const formData = new FormData();
    formData.append("taskId", problemId);
    formData.append("submissionStatus", "ac");
    return formData;
  }

  function getAcceptedProblemIds(submissions) {
    return [
      ...new Set(
        submissions
          .filter((item) => item.result === "AC")
          .map((item) => item.problem_id),
      ),
    ];
  }

  async function fetchAcceptedProblemIds(userId, fromSecond) {
    const response = await fetch(
      `${ATCODER_SUBMISSIONS_API}?user=${encodeURIComponent(userId)}&from_second=${fromSecond}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch submissions: ${response.status}`);
    }

    const submissions = await response.json();

    const maxEpochSecond = submissions.reduce(
      (max, item) => Math.max(max, item.epoch_second),
      0,
    );

    return {
      acceptedProblemIds: getAcceptedProblemIds(submissions),
      submissionsCount: submissions.length,
      nextFromSecond: maxEpochSecond,
    };
  }

  async function fetchAcceptedAllProblemIds(userId) {
    const acceptedAllProblemIds = new Set();
    let fromSecond = 0;

    while (true) {
      const { acceptedProblemIds, submissionsCount, nextFromSecond } =
        await fetchAcceptedProblemIds(userId, fromSecond);

      acceptedProblemIds.forEach((id) => acceptedAllProblemIds.add(id));

      if (submissionsCount === 0) {
        break;
      }

      if (nextFromSecond < fromSecond) {
        throw new Error("Unexpected submissions order from Problems API");
      }

      fromSecond = nextFromSecond + 1; // 次のリクエストでは前回の最終秒数の次から取得する
      await wait(getAtCoderDelayMs());
    }

    return [...acceptedAllProblemIds];
  }

  async function syncProblem(problemId) {
    return fetch(PROBLEMS_UPDATE_PATH, {
      method: "POST",
      body: createSyncRequestBody(problemId),
      headers: { "x-sveltekit-action": "true" },
    });
  }

  // ========================================
  // トースト通知（alert の代わり）
  // ========================================
  function showToast(message, type) {
    const old = document.getElementById("ns-toast");
    if (old) old.remove();

    const el = document.createElement("div");
    el.id = "ns-toast";
    el.className = `ns-toast ns-toast-${type || "info"}`;
    el.textContent = message;
    document.body.appendChild(el);

    setTimeout(() => {
      el.style.animation = `ns-fade-out ${TOAST_FADE_DURATION_MS}ms ease forwards`;
      setTimeout(() => el.remove(), TOAST_FADE_DURATION_MS);
    }, TOAST_DURATION_MS);
  }

  // ========================================
  // 確認モーダル（confirm の代わり）
  // ========================================
  function showConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "ns-confirm-overlay";

      const card = document.createElement("div");
      card.className = "ns-confirm-card";

      const msg = document.createElement("p");
      msg.textContent = message;
      msg.className = "ns-confirm-message";

      const btnRow = document.createElement("div");
      btnRow.className = "ns-confirm-actions";

      const makeBtn = (text, primary) => {
        const b = document.createElement("button");
        b.textContent = text;
        b.className = `ns-confirm-btn ${
          primary ? "ns-confirm-btn-primary" : "ns-confirm-btn-secondary"
        }`;
        return b;
      };

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      const cancelBtn = makeBtn("やめておく", false);
      const okBtn = makeBtn("同期する", true);

      cancelBtn.addEventListener("click", () => close(false));
      okBtn.addEventListener("click", () => close(true));

      btnRow.append(cancelBtn, okBtn);
      card.append(msg, btnRow);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  }

  // ========================================
  // リロード後の通知
  // ========================================
  const syncResult = sessionStorage.getItem(SYNC_RESULT_KEY);
  if (syncResult) {
    sessionStorage.removeItem(SYNC_RESULT_KEY);
    setTimeout(() => showToast(syncResult, "success"), TOAST_RELOAD_DELAY_MS);
  }

  // ========================================
  // 同期済みリストの読み書き
  // ========================================
  const getSyncedIds = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  };

  const saveSyncedIds = (idSet) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...idSet]));
  };

  // ========================================
  // 同期ボタンの注入
  // ========================================
  function injectSyncButton() {
    if (document.getElementById("ns-sync-btn") || !document.body) return;

    const btn = document.createElement("button");
    btn.id = "ns-sync-btn";

    const label = document.createElement("span");
    label.id = "ns-sync-label";
    label.textContent = "AC を同期";

    const progress = document.createElement("span");
    progress.id = "ns-sync-progress";

    btn.append(label, progress);

    function resetBtn() {
      label.textContent = "AC を同期";
      btn.disabled = false;
      btn.classList.remove("ns-busy");
      progress.style.width = "0%";
    }

    function setBusy(text) {
      btn.disabled = true;
      btn.classList.add("ns-busy");
      label.textContent = text;
    }

    btn.addEventListener("click", async () => {
      if (!USER_ID) {
        showToast(
          "AtCoder ID が設定されていません。\ncontent.js の USER_ID を確認してください。",
          "error",
        );
        return;
      }

      setBusy("確認中…");

      try {
        const allAcIds = await fetchAcceptedAllProblemIds(USER_ID);

        const syncedIds = getSyncedIds();
        const tasksToSync = allAcIds.filter((id) => !syncedIds.has(id));

        if (tasksToSync.length === 0) {
          showToast("すべて同期済みです！", "success");
          resetBtn();
          return;
        }

        resetBtn();
        const ok = await showConfirm(
          `新しく ${tasksToSync.length} 問の AC が見つかりました！\nNoviSteps に同期しますか？`,
        );
        if (!ok) return;

        setBusy("同期中…");

        let successCount = 0;
        for (let i = 0; i < tasksToSync.length; i++) {
          const pid = tasksToSync[i];
          const response = await syncProblem(pid);

          if (response.ok) {
            successCount++;
            syncedIds.add(pid);
          }

          const pct = Math.round(((i + 1) / tasksToSync.length) * 100);
          label.textContent = `同期中… ${i + 1} / ${tasksToSync.length}`;
          progress.style.width = `${pct}%`;
          await wait(getNoviStepsDelayMs());
        }

        saveSyncedIds(syncedIds);

        sessionStorage.setItem(
          SYNC_RESULT_KEY,
          `同期が完了しました！\n${successCount} 問を追加しました`,
        );
        location.reload();
      } catch (e) {
        console.error(e);
        showToast(
          "同期に失敗しました。\nしばらくしてからもう一度お試しください。",
          "error",
        );
        label.textContent = "もう一度試す";
        btn.disabled = false;
        btn.classList.remove("ns-busy");
      }
    });

    document.body.appendChild(btn);
  }

  injectSyncButton();
  new MutationObserver(injectSyncButton).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
