/**
 * Probes whether this browser's WebGPU implementation supports what three.js
 * needs. Some older Chromium builds expose WebGPU but reject newer descriptor
 * fields (e.g. texture view `swizzle`), failing mid-render; in that case we
 * start on the WebGL 2 backend instead.
 */
export async function webgpuUsable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return false;
    const device = await adapter.requestDevice();
    try {
      const tex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
      tex.createView({ swizzle: 'rgba' } as GPUTextureViewDescriptor);
      tex.destroy();
      return true;
    } finally {
      device.destroy();
    }
  } catch {
    return false;
  }
}
