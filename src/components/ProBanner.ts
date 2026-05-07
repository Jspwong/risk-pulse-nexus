import { trackGateHit } from '@/services/analytics';
import { hasPremiumAccess } from '@/services/panel-gating';
import { onEntitlementChange, getEntitlementState } from '@/services/entitlements';
import { getCurrentClerkUser } from '@/services/clerk';

let bannerEl: HTMLElement | null = null;
let bannerContainer: HTMLElement | null = null;

const DISMISS_KEY = 'wm-pro-banner-launched-dismissed';
const LEGACY_DISMISS_KEY = 'wm-pro-banner-dismissed';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function isDismissed(): boolean {
  localStorage.removeItem(LEGACY_DISMISS_KEY);
  const ts = localStorage.getItem(DISMISS_KEY);
  if (!ts) return false;
  if (Date.now() - Number(ts) > DISMISS_MS) {
    localStorage.removeItem(DISMISS_KEY);
    return false;
  }
  return true;
}

function dismiss(): void {
  if (!bannerEl) return;
  bannerEl.classList.add('pro-banner-out');
  setTimeout(() => {
    bannerEl?.remove();
    bannerEl = null;
  }, 300);
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
}

export function showProBanner(container: HTMLElement): void {
  // --- 关键修改：彻底禁用 ---
  return; 

  bannerContainer = container;
  if (bannerEl) return;
  if (window.self !== window.top) return;
  if (isDismissed()) return;
  if (hasPremiumAccess()) return;
  if (getCurrentClerkUser() && getEntitlementState() === null) return;

  trackGateHit('pro-banner');

  const banner = document.createElement('div');
  banner.className = 'pro-banner';
  banner.innerHTML = `
    <span class="pro-banner-badge">PRO</span>
    <span class="pro-banner-text">
      <strong>Pro is launched</strong> — More Signal, Less Noise.
    </span>
    <a class="pro-banner-cta" href="/pro#pricing">Upgrade to Pro →</a>
    <button class="pro-banner-close" aria-label="Dismiss">×</button>
  `;

  banner.querySelector('.pro-banner-close')!.addEventListener('click', (e) => {
    e.preventDefault();
    dismiss();
  });

  const header = container.querySelector('.header');
  if (header) {
    header.before(banner);
  } else {
    container.prepend(banner);
  }

  bannerEl = banner;
  requestAnimationFrame(() => banner.classList.add('pro-banner-in'));
}

export function hideProBanner(): void {
  if (!bannerEl) return;
  bannerEl.classList.add('pro-banner-out');
  setTimeout(() => {
    bannerEl?.remove();
    bannerEl = null;
  }, 300);
}

export function isProBannerVisible(): boolean {
  // --- 关键修改：始终返回 false ---
  return false;
}

// 禁用状态同步监听，减少不必要的开销
onEntitlementChange(() => {
  // 逻辑已切断
  return;
});