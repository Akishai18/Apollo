"use client";

import { useEffect, useRef } from "react";

/*
  A continuously flowing fluid/aurora rendered on the GPU (raw WebGL, no deps).
  A domain-warped fbm field evolves smoothly with time — never a ping-pong loop —
  so it's always moving, with diagonal light streaks drifting through it and the
  colour slowly travelling indigo → violet with warm amber glints. Biased to the
  right so left-aligned copy stays clean. Renders one static frame under
  prefers-reduced-motion.
*/

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uAmbient; // 0 = bold hero, 1 = dim even page-wide ambient

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  // slow right<->left travel of the whole bright mass (heavier-right overall)
  float sway = sin(uTime * 0.15) * 0.17;
  vec2 p = uv;
  p.x *= uRes.x / uRes.y;
  p.x += sway;
  float t = uTime * 0.05;

  // domain warp → flowing, organic motion
  vec2 q = vec2(fbm(p * 1.4 + vec2(0.0, t)), fbm(p * 1.4 + vec2(5.2, -t)));
  float f = fbm(p * 1.4 + 2.2 * q + vec2(t * 0.6, -t * 0.4));

  // diagonal light streaks drifting continuously (the beams), warped by the
  // flow field so they ripple instead of marching rigidly
  float diag = p.x * 0.9 + p.y * 0.5 + (f - 0.5) * 0.6;
  float beams = 0.5 + 0.5 * sin(diag * 6.0 - uTime * 0.45);
  beams = pow(beams, 4.0);
  float beamsFine = 0.5 + 0.5 * sin(diag * 12.0 - uTime * 0.3 + f * 4.0);
  beamsFine = pow(beamsFine, 7.0);

  // the heavy side is centred to the right but drifts with the sway
  float center = 0.62 + sway;
  float field = smoothstep(0.25, 1.0, f);
  float rightMask = smoothstep(center - 0.78, center + 0.26, uv.x);
  float evenMask = 0.32 + 0.45 * field; // organic, not side-biased (ambient)
  float mask = mix(rightMask, evenMask, uAmbient);
  float warmMask = mix(smoothstep(center - 0.08, 1.05, uv.x), 0.35 + 0.3 * field, uAmbient);

  vec3 base = vec3(0.035, 0.040, 0.062);
  vec3 indigo = vec3(0.30, 0.37, 1.0);
  vec3 violet = vec3(0.56, 0.33, 1.0);
  vec3 bright = vec3(0.78, 0.84, 1.0);
  vec3 warm = vec3(1.0, 0.62, 0.30);

  vec3 col = base;
  col = mix(col, indigo, field * 0.5);
  col = mix(col, violet, smoothstep(0.55, 1.0, f) * 0.5);
  col += indigo * beams * 0.95 * mask;
  col += bright * beamsFine * 0.55 * mask;
  col += warm * beams * 0.30 * warmMask;

  // hero: brighten right / darken left.  ambient: even, mid brightness.
  col *= mix(mix(0.42, 1.3, rightMask), 0.62, uAmbient);
  // gentle top + bottom falloff (hero only)
  float fall = smoothstep(0.0, 0.22, uv.y) * smoothstep(0.0, 0.30, 1.0 - uv.y) * 0.6 + 0.55;
  col *= mix(fall, 1.0, uAmbient);
  // dim the ambient further for legibility under content
  col *= mix(1.0, 0.6, uAmbient);

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

export function ShaderBackground({
  className = "",
  ambient = false,
}: {
  className?: string;
  ambient?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vert || !frag) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uAmbient = gl.getUniformLocation(prog, "uAmbient");
    gl.uniform1f(uAmbient, ambient ? 1 : 0);

    // render at reduced internal resolution — it's soft, so this is free perf
    const scale = ambient ? 0.5 : 0.7;
    function resize() {
      const cw = canvas!.clientWidth || parent!.clientWidth;
      const ch = canvas!.clientHeight || parent!.clientHeight;
      const w = Math.max(1, Math.floor(cw * scale));
      const h = Math.max(1, Math.floor(ch * scale));
      canvas!.width = w;
      canvas!.height = h;
      gl!.viewport(0, 0, w, h);
      gl!.uniform2f(uRes, w, h);
    }
    resize();

    let raf = 0;
    let running = true;
    const start = performance.now();

    const speed = ambient ? 0.7 : 1;
    function draw(now: number) {
      if (!running) return;
      gl!.uniform1f(uTime, ((now - start) / 1000) * speed);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    }

    if (reduce) {
      gl.uniform1f(uTime, 8.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      raf = requestAnimationFrame(draw);
    }

    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [ambient]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
