// Microsoft Fluent Emoji 3D icons, bundled locally so they pass our strict
// CSP (img-src 'self') and don't depend on a third-party CDN at runtime.
// Source: https://github.com/microsoft/fluentui-emoji
export const ICONS = {
  mic:      '/icons/microphone.png',
  cam:      '/icons/camera.png',
  screen:   '/icons/desktop.png',
  door:     '/icons/door.png',
  flip:     '/icons/flip.png',
  settings: '/icons/gear.png',
} as const;

export type IconName = typeof ICONS[keyof typeof ICONS];

export function iconHtml(name: IconName): string {
  return `<img class="icon" src="${name}" alt="" draggable="false" />`;
}
