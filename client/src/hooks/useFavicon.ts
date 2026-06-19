import { useEffect } from 'react';

/**
 * 动态切换浏览器标签页 favicon。
 * @param iconPath 图标路径，如 '/user-icon.svg'
 */
export function useFavicon(iconPath: string) {
  useEffect(() => {
    const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    if (link) {
      link.href = iconPath;
    }
  }, [iconPath]);
}
