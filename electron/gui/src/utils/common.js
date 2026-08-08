export async function apiPost(url, body = {}, options = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...options,
  });
  return response.json();
}

export function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== "string") return `rgba(59, 130, 246, ${alpha})`;
  let c = hex.replace("#", "");
  if (c.length === 3)
    c = c
      .split("")
      .map((x) => x + x)
      .join("");
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(59, 130, 246, ${alpha})`;
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

export function applyThemeVars(s = {}) {
  const root = document.documentElement;
  if (!root) return;

  if (s.themeAccentColor) {
    root.style.setProperty("--accent", s.themeAccentColor);
    root.style.setProperty(
      "--accent-hover",
      hexToRgba(s.themeAccentColor, 0.85),
    );
    root.style.setProperty("--dub-btn-color", s.themeAccentColor);
    root.style.setProperty("--dub-btn-bg", hexToRgba(s.themeAccentColor, 0.15));
    root.style.setProperty(
      "--dub-btn-border",
      hexToRgba(s.themeAccentColor, 0.35),
    );
  }
  const secColor = s.themeSecondaryColor || s.themeSubColor;
  if (secColor) {
    root.style.setProperty("--accent-secondary", secColor);
    root.style.setProperty("--sub-btn-color", secColor);
    root.style.setProperty("--sub-btn-bg", hexToRgba(secColor, 0.15));
    root.style.setProperty("--sub-btn-border", hexToRgba(secColor, 0.35));
  }
  const sidebarColor = s.themeSidebarColor || s.themeAccentColor || "#8b5cf6";
  root.style.setProperty("--sidebar-active-color", sidebarColor);
  root.style.setProperty("--sidebar-active-bg", hexToRgba(sidebarColor, 0.2));
  root.style.setProperty(
    "--sidebar-active-bg-hover",
    hexToRgba(sidebarColor, 0.32),
  );
  root.style.setProperty("--sidebar-active-glow", hexToRgba(sidebarColor, 0.3));

  if (s.themeBgColor) {
    root.style.setProperty("--bg-primary", s.themeBgColor);
    root.style.setProperty("--bg-secondary", hexToRgba(s.themeBgColor, 0.85));
    root.style.setProperty("--bg-tertiary", hexToRgba(s.themeBgColor, 0.7));
    root.style.setProperty("--glass", hexToRgba(s.themeBgColor, 0.65));
  }
  if (s.themeTextColor) {
    root.style.setProperty("--text-main", s.themeTextColor);
    root.style.setProperty("--text-muted", hexToRgba(s.themeTextColor, 0.65));
  }
  if (s.catalogTitleFontSize) {
    root.style.setProperty(
      "--catalog-title-font-size",
      `${s.catalogTitleFontSize}px`,
    );
  }
  if (s.catalogTitleLines) {
    root.style.setProperty("--catalog-title-lines", `${s.catalogTitleLines}`);
  }
  if (s.catalogColumns) {
    root.style.setProperty("--catalog-columns", s.catalogColumns);
  }
}
