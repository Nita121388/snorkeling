// Snorkeling 更新流程原型控制器 — 纯演示，无真实下载逻辑。
// 场景与 updater.ts 状态机一一对应：
//   idle        = "up-to-date" + 自动检查进行中（banner 不消失，对应 P0 修复）
//   available   = "manual-update"（banner: Update）
//   downloading = "downloading" + manualProgress（进度 + 取消）
//   ready       = "ready"（banner 点击 → 重启确认弹窗）
//   error       = "error" + phase failed（banner: Update Error，点击重试）
//   channel     = About 弹窗通道选择（stable / beta）
//   zipwindows  = 安装形态支持性面板
//   debug       = Update Debug Info

const banner = document.getElementById("updateBanner");
const bannerIco = document.getElementById("bannerIco");
const bannerText = document.getElementById("bannerText");
const bannerCancel = document.getElementById("bannerCancel");
const supportPanel = document.getElementById("supportPanel");
const supportList = document.getElementById("supportList");
const supportHint = document.getElementById("supportHint");

const scrims = {
  restart: document.getElementById("restartScrim"),
  about: document.getElementById("aboutScrim"),
  debug: document.getElementById("debugScrim"),
};

let channel = "stable";
let fakeProgressTimer = null;

function closeScrims() {
  Object.values(scrims).forEach((s) => (s.hidden = true));
}

function setBanner(opts) {
  // opts: {icon, text, error?, busy?, cancellable?}
  banner.hidden = false;
  banner.classList.toggle("is-error", Boolean(opts.error));
  banner.classList.toggle("is-busy", Boolean(opts.busy));
  bannerIco.textContent = opts.icon;
  bannerText.textContent = opts.text;
  bannerCancel.hidden = !opts.cancellable;
}

function hideBanner() {
  banner.hidden = true;
}

const scenes = {
  idle() {
    // P0 关键演示：自动检查（checking-for-update）期间，已有信息不被冲掉。
    // 旧实现此时 banner 返回 null 直接消失；新实现保持可见。
    setBanner({ icon: "⟳", text: "Checking for updates…", busy: true });
    banner.classList.remove("is-error");
    setTimeout(() => {
      // 模拟一次超时（旧实现会永远卡在 checking，banner 消失）
      setBanner({ icon: "⟳", text: "No updates available · last checked just now", busy: true });
      banner.style.opacity = "0.75";
      setTimeout(() => {
        banner.style.opacity = "";
        hideBanner();
      }, 1200);
    }, 1500);
  },
  available() {
    setBanner({ icon: "↗", text: `Update · 0.0.126` });
  },
  downloading() {
    let received = 0;
    const total = 208788711;
    if (fakeProgressTimer) clearInterval(fakeProgressTimer);
    fakeProgressTimer = setInterval(() => {
      received += 4 * 1024 * 1024;
      if (received >= total) {
        received = total;
        clearInterval(fakeProgressTimer);
        setBanner({ icon: "⬇", text: "Downloaded · verifying…", busy: true });
        setTimeout(() => scenes.ready(), 800);
        return;
      }
      const pct = Math.floor((received / total) * 100);
      setBanner({
        icon: "⬇",
        text: `Downloading ${fmtMB(received)} / ${fmtMB(total)} (${pct}%)`,
        busy: true,
        cancellable: true,
      });
    }, 200);
  },
  ready() {
    if (fakeProgressTimer) clearInterval(fakeProgressTimer);
    setBanner({ icon: "⟳", text: "Ready · restart to install" });
  },
  error() {
    setBanner({ icon: "!", text: "Update Error · click to retry", error: true });
  },
  channel() {
    scrims.about.hidden = false;
  },
  zipwindows() {
    supportPanel.hidden = false;
    supportList.innerHTML = `
      <li><span class="sup-head">macOS zip 解压 <span class="badge ok">完整支持</span></span>
          <span class="sup-note">退出后由独立脚本 ditto 替换 bundle，正是不依赖安装器的形态</span></li>
      <li><span class="sup-head">Windows 安装版 .exe <span class="badge ok">完整支持</span></span>
          <span class="sup-note">electron-updater 原生通道（现状已支持）</span></li>
      <li><span class="sup-head">Windows zip 解压 <span class="badge part">部分</span></span>
          <span class="sup-note">现有代码判定不支持自动更新；MVP 引导下载 .exe 安装包，P2 可加退出后 robocopy 替换</span></li>
      <li><span class="sup-head">Linux (deb/AppImage) <span class="badge part">部分</span></span>
          <span class="sup-note">本机不在此平台，暂走手动安装引导</span></li>`;
    supportHint.textContent =
      "结论：macOS 解压安装完全覆盖（本 fork 主场景）；其余平台保持「可检测 + 可下载安装包」，不做静默替换。";
  },
  debug() {
    fillDebugText();
    scrims.debug.hidden = false;
  },
};

function fmtMB(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

// 场景按钮
let activeBtn = null;
document.querySelectorAll(".controller [data-scene]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (activeBtn) activeBtn.classList.remove("active");
    activeBtn = btn;
    btn.classList.add("active");
    closeScrims();
    supportPanel.hidden = true;
    scenes[btn.dataset.scene]();
  });
});

// 主题
document.getElementById("themeToggle").addEventListener("click", () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === "dark" ? "light" : "dark";
});

// banner 点击行为（镜像 updatebanner.tsx 的 onClick 分支）
banner.addEventListener("click", (e) => {
  if (e.target === bannerCancel) return;
  const text = bannerText.textContent;
  if (text.startsWith("Update ·") || text.startsWith("Ready")) {
    // 就绪 → 重启确认弹窗（NEW）
    document.getElementById("restartChannel").textContent =
      channel === "beta" ? "Beta" : "Stable";
    scrims.restart.hidden = false;
  } else if (text.startsWith("Update Error")) {
    scenes.downloading(); // 重试（断点续传：真实实现从 .part 继续）
  }
});
bannerCancel.addEventListener("click", (e) => {
  e.stopPropagation();
  if (fakeProgressTimer) clearInterval(fakeProgressTimer);
  hideBanner(); // cancelled：真实实现回到 manual-update 可重下状态
});

// 通道按钮（控制器 + About 弹窗共用）
document.querySelectorAll("[data-channel]").forEach((btn) => {
  btn.addEventListener("click", () => {
    channel = btn.dataset.channel;
    document.querySelectorAll("[data-channel]").forEach((b) => {
      b.classList.toggle("active", b.dataset.channel === channel);
    });
    // 切通道后：真实实现立即重新检查该通道的最新版本
    if (!scrims.about.hidden) {
      // About 里切换只改设置，不弹 banner
      return;
    }
    scenes.available();
    bannerText.textContent = `Update · ${channel === "beta" ? "0.0.127-beta" : "0.0.126"}`;
  });
});

// 弹窗按钮
document.getElementById("restartNow").addEventListener("click", () => {
  closeScrims();
  setBanner({ icon: "⟳", text: "Installing… app will relaunch", busy: true });
  setTimeout(() => {
    hideBanner();
    document.querySelector(".term-line.dim").textContent =
      "Snorkeling 0.14.6-beta.0.snorkeling.0.0.126 (restart applied)";
  }, 1400);
});
document.getElementById("restartLater").addEventListener("click", () => {
  closeScrims();
  setBanner({ icon: "⟳", text: "Ready · applies on next quit" });
});
document.getElementById("closeAbout").addEventListener("click", () => closeScrims());
document.getElementById("copyUpdateDebug").addEventListener("click", () => {
  scrims.about.hidden = true;
  scenes.debug();
});
document.getElementById("closeDebug").addEventListener("click", () => closeScrims());

// 点遮罩关闭 + Esc 关闭
Object.values(scrims).forEach((s) =>
  s.addEventListener("click", (e) => {
    if (e.target === s) closeScrims();
  })
);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeScrims();
});

// debug 文案初始就绪（避免空面板）
function fillDebugText() {
  document.getElementById("debugText").textContent = JSON.stringify(
    {
      version: "0.14.6-beta.0.snorkeling.0.0.125",
      platform: "darwin arm64",
      channel: channel,
      updaterStatus: "ready",
      statusTrail: ["manual-update", "checking(kept)", "downloading", "ready"],
      staged: "~/Library/Application Support/Snorkeling/updates/0.0.126/Snorkeling.app",
      lastChecked: new Date().toISOString(),
      lastError: null,
      supportState: { manualInstallOnly: false, supported: true },
      installMode: "macOS zip (ad-hoc, swap script)",
    },
    null,
    2
  );
}
fillDebugText();

// 初始场景：支持 ?scene=debug 直达（评审/截图用），默认 available
const wanted = new URLSearchParams(location.search).get("scene");
const initBtn = document.querySelector(`[data-scene="${wanted}"]`) || document.querySelector('[data-scene="available"]');
initBtn.click();
