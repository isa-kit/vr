// Shared plumbing for the scenes built on ../procgen/: quality tier choice, loading screen, sun light with soft shadows.
import * as THREE from 'three';

export function pickQuality(QUALITY) {
  const isHeadsetUA = /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent), isCoarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  let pref = 'auto'; try { pref = localStorage.getItem('oortia-quality') || 'auto'; } catch (e) { /* ignore */ }
  const name = QUALITY[pref] ? pref : (isHeadsetUA ? 'light' : isCoarse ? 'medium' : 'high');
  return { Q: QUALITY[name], name, pref, isCoarse, setQuality(v, W) { try { localStorage.setItem('oortia-quality', v); } catch (e) { /* ignore */ } if (W && W.comfort) W.comfort.fade(() => location.reload()); else location.reload(); } };
}

// progress bar inside the Enter overlay; call tick(label) between heavy steps, done(W) at the end
// Yield to the browser without setTimeout: background/hidden tabs clamp setTimeout(0) to ~1 s per call, which turned ~25 loading steps into a 15–25 s wait.
const _ch = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null; let _q = [];
if (_ch) _ch.port1.onmessage = () => { const f = _q; _q = []; f.forEach(r => r()); };
export const yieldNow = () => new Promise(r => { if (_ch) { _q.push(r); _ch.port2.postMessage(0); } else setTimeout(r, 0); });

export function createLoader(total = 20, what = 'Building the scene') {
  const card = document.querySelector('#enter .card'), goBtn = card && card.querySelector('.go'); if (goBtn) goBtn.style.display = 'none';
  const bar = document.createElement('div'), fill = document.createElement('div'), label = document.createElement('div');
  bar.style.cssText = 'margin:16px auto 0;width:min(260px,70vw);height:6px;border-radius:3px;background:rgba(255,255,255,.25);overflow:hidden'; fill.style.cssText = 'height:100%;width:0%;background:#fff;transition:width .25s';
  label.style.cssText = 'margin-top:9px;font-size:13px;opacity:.85'; bar.appendChild(fill); if (card) card.append(bar, label);
  let steps = 0;
  return {
    async tick(l) { steps++; fill.style.width = Math.min(96, steps / total * 100) + '%'; label.textContent = what + '… ' + (l || ''); await yieldNow(); },
    done(W) { fill.style.width = '100%'; bar.remove(); label.remove(); if (goBtn) goBtn.style.display = ''; W.loading = false; },
  };
}

export function makeSunRig({ scene, renderer, Q, extent = 60 }) {
  const sun = new THREE.DirectionalLight(0xffffff, 1); scene.add(sun, sun.target);
  if (Q.shadowMap) {
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true; sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap); const c = sun.shadow.camera;
    c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent; c.near = 1; c.far = 500; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.07; sun.shadow.radius = 3;
  }
  return sun;
}
export function aimSun(sun, sky, x, y, z, dist = 180) { sun.target.position.set(x, y, z); sun.position.copy(sun.target.position).addScaledVector(sky.sunDir, dist); }
