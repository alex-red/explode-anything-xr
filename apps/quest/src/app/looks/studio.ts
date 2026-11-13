import { BackSide, BoxGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, PMREMGenerator, Scene, type Texture, type WebGLRenderer } from '@iwsdk/core';

/**
 * A small photo studio, prefiltered once into an environment map: a soft grey room with a big
 * overhead softbox and two strip lights. Metals and glass need something to reflect, or they
 * read as flat grey; this gives them highlights without loading an HDR file.
 */
let cached: Texture | null | undefined;

export function studioEnvironment(renderer: WebGLRenderer | null | undefined): Texture | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (!renderer || typeof (renderer as { getRenderTarget?: unknown }).getRenderTarget !== 'function') return null;
  const scene = new Scene();
  const disposables: Array<{ dispose(): void }> = [];
  const add = (w: number, h: number, intensity: number, x: number, y: number, z: number, rx: number, ry: number) => {
    const geo = new PlaneGeometry(w, h);
    const mat = new MeshBasicMaterial({ toneMapped: false });
    mat.color.setRGB(intensity, intensity, intensity * 1.02);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    scene.add(m);
    disposables.push(geo, mat);
  };
  const roomGeo = new BoxGeometry(10, 6, 10);
  const roomMat = new MeshBasicMaterial({ color: 0x2c3036, side: BackSide, toneMapped: false });
  scene.add(new Mesh(roomGeo, roomMat));
  disposables.push(roomGeo, roomMat);
  add(4, 3, 6, 0, 2.9, 0, Math.PI / 2, 0); // overhead softbox
  add(0.6, 4, 3.5, -4.9, 0.5, 0, 0, Math.PI / 2); // left strip
  add(0.6, 4, 2.5, 4.9, 0.5, -1, 0, -Math.PI / 2); // right strip
  add(5, 1.2, 1.2, 0, 0.2, 4.9, 0, Math.PI); // front fill
  add(10, 10, 0.25, 0, -2.9, 0, -Math.PI / 2, 0); // a warm-grey floor bounce
  const xr = (renderer as { xr?: { enabled: boolean } }).xr;
  const wasXr = xr?.enabled ?? false;
  let pmrem: PMREMGenerator | null = null;
  try {
    if (xr) xr.enabled = false; // render the cube faces with the cube camera, not the headset's
    pmrem = new PMREMGenerator(renderer);
    cached = pmrem.fromScene(scene, 0.03).texture;
  } catch {
    cached = null; // no GPU (tests) or a lost context: materials still work, only duller
  } finally {
    if (xr) xr.enabled = wasXr;
    try {
      pmrem?.dispose();
    } catch {
      /* nothing to free */
    }
    for (const d of disposables) d.dispose();
  }
  return cached;
}
