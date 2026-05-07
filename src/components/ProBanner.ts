import { onEntitlementChange } from '@/services/entitlements';

/**
 * ProBanner Component - Competition Build
 * This component is intentionally disabled to provide a clean, 
 * professional dashboard for the 5/13 presentation.
 */

let bannerEl: HTMLElement | null = null;

// 即使传入了 container，我们也直接返回，不进行任何 DOM 操作
export function showProBanner(container: HTMLElement): void {
  return;
}

// 隐藏逻辑保持空函数
export function hideProBanner(): void {
  if (bannerEl) {
    bannerEl.remove();
    bannerEl = null;
  }
}

// 永远返回 false，确保 UI 布局不会为横幅留出空白
export function isProBannerVisible(): boolean {
  return false;
}

/**
 * 监听权限变化。
 * 返回一个空的清理函数，确保不会触发任何重新渲染横幅的逻辑。
 */
export const onEntitlementChangeProxy = onEntitlementChange(() => {
  return;
});

// 导出原有的函数名以保持与其他文件的导入兼容
export { onEntitlementChange };