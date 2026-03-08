export function renderDevicePopupHTML(device: {
  name: string
  number: string
  type?: string
  battery?: string
}): string {
  return `
    <div style="font-family: Inter, system-ui, sans-serif; min-width: 180px;">
      <div style="font-weight: 600; font-size: 14px; color: #111827;">${device.name || device.number}</div>
      ${device.type ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${device.type}</div>` : ''}
      ${device.battery ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Battery: ${device.battery}</div>` : ''}
      <button
        onclick="window.dispatchEvent(new CustomEvent('device-detail', {detail:'${device.number}'}))"
        style="margin-top: 8px; padding: 4px 12px; background: #3b82f6; color: white; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit;">
        Details
      </button>
    </div>
  `
}
