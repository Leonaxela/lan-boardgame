import { useEffect, useRef } from 'react';

/**
 * WebGL2 Navier-Stokes 流体动画背景
 * 参考：https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 */
export default function FluidBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return;

    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    // ── Config ──
    const SIM_RESOLUTION = 128;
    const DYE_RESOLUTION = 512;
    const DENSITY_DISSIPATION = 0.97;
    const VELOCITY_DISSIPATION = 0.98;
    const PRESSURE_ITERATIONS = 20;
    const CURL = 30;
    const SPLAT_RADIUS = 0.25;
    const SPLAT_FORCE = 6000;
    const PALETTE = [
      [0.86, 0.70, 0.36],  /* 金色 — 主调 #dcb35c */
      [0.96, 0.75, 0.30],  /* 暖琥珀 #f5bf4d */
      [0.85, 0.55, 0.25],  /* 古铜 #d98c40 */
      [0.75, 0.42, 0.20],  /* 深琥珀 #bf6b33 */
      [0.95, 0.88, 0.55],  /* 浅金 #fae099 */
      [0.82, 0.60, 0.32],  /* 暖棕 #d19952 */
    ];

    let textureUnit = 0;
    function bindTexture(_texture: any) { return textureUnit++; }

    // ── Shader sources ──
    const baseVS = `#version 300 es
      precision highp float;
      in vec2 aPosition;
      out vec2 vUv; out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
      uniform vec2 texelSize;
      void main(){
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0); vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y); vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }`;

    const clearFS = `#version 300 es
      precision mediump float;
      in highp vec2 vUv; uniform sampler2D uTexture; uniform float value;
      out vec4 fc; void main(){ fc=value*texture(uTexture,vUv); }`;

    const splatFS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uTarget; uniform float aspectRatio;
      uniform vec3 color; uniform vec2 point; uniform float radius;
      out vec4 fc;
      void main(){
        vec2 p=vUv-point; p.x*=aspectRatio;
        vec3 s=exp(-dot(p,p)/radius)*color;
        fc=vec4(texture(uTarget,vUv).xyz+s,1);
      }`;

    const advectionFS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uVelocity; uniform sampler2D uSource;
      uniform vec2 texelSize; uniform float dt; uniform float dissipation;
      out vec4 fc;
      void main(){
        vec2 c=vUv-dt*texture(uVelocity,vUv).xy*texelSize;
        fc=dissipation*texture(uSource,c);
      }`;

    const divergenceFS = `#version 300 es
      precision mediump float;
      in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
      uniform sampler2D uVelocity; out vec4 fc;
      void main(){
        float L=texture(uVelocity,vL).x, R=texture(uVelocity,vR).x;
        float T=texture(uVelocity,vT).y, B=texture(uVelocity,vB).y;
        fc=vec4(0.5*(R-L+T-B),0,0,1);
      }`;

    const curlFS = `#version 300 es
      precision mediump float;
      in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
      uniform sampler2D uVelocity; out vec4 fc;
      void main(){
        float L=texture(uVelocity,vL).y, R=texture(uVelocity,vR).y;
        float T=texture(uVelocity,vT).x, B=texture(uVelocity,vB).x;
        fc=vec4(0.5*(R-L-T+B),0,0,1);
      }`;

    const vorticityFS = `#version 300 es
      precision highp float;
      in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
      uniform sampler2D uVelocity; uniform sampler2D uCurl;
      uniform float curl; uniform float dt; out vec4 fc;
      void main(){
        float L=texture(uCurl,vL).x, R=texture(uCurl,vR).x;
        float T=texture(uCurl,vT).x, B=texture(uCurl,vB).x;
        float C=texture(uCurl,vUv).x;
        vec2 f=0.5*vec2(abs(T)-abs(B),abs(R)-abs(L));
        f/=length(f)+0.0001; f*=curl*C; f.y*=-1.0;
        vec2 v=texture(uVelocity,vUv).xy+f*dt;
        fc=vec4(v,0.0,1.0);
      }`;

    const pressureFS = `#version 300 es
      precision mediump float;
      in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
      uniform sampler2D uPressure; uniform sampler2D uDivergence; out vec4 fc;
      void main(){
        float L=texture(uPressure,vL).x, R=texture(uPressure,vR).x;
        float T=texture(uPressure,vT).x, B=texture(uPressure,vB).x;
        float C=texture(uDivergence,vUv).x;
        fc=vec4((L+R+B+T-C)*0.25,0,0,1);
      }`;

    const gradientFS = `#version 300 es
      precision mediump float;
      in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
      uniform sampler2D uPressure; uniform sampler2D uVelocity; out vec4 fc;
      void main(){
        float L=texture(uPressure,vL).x, R=texture(uPressure,vR).x;
        float T=texture(uPressure,vT).x, B=texture(uPressure,vB).x;
        fc=vec4(texture(uVelocity,vUv).xy-vec2(R-L,T-B),0,1);
      }`;

    const displayFS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uDye; uniform sampler2D uVelocity; uniform float time;
      out vec4 fc;
      void main(){
        vec3 c=texture(uDye,vUv).rgb;
        vec2 uv=vUv*2.0-1.0;
        float vig=1.0-0.35*dot(uv,uv);
        float spd=length(texture(uVelocity,vUv).xy);
        float glow=1.0+0.15*smoothstep(0.0,300.0,spd);
        c=c*vig*glow;
        c=c*(2.51*c+0.03)/(c*(2.43*c+0.59)+0.14);
        float grain=(fract(sin(dot(vUv+time,vec2(12.9898,78.233)))*43758.5453)-0.5)*0.025;
        c+=grain;
        fc=vec4(max(c,vec3(0.0)),1.0);
      }`;

    // ── Compile / Link ──
    function compile(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        console.error(gl!.getShaderInfoLog(s)); return null;
      }
      return s;
    }
    function link(vs: WebGLShader, fs: WebGLShader) {
      const p = gl!.createProgram()!;
      gl!.attachShader(p, vs); gl!.attachShader(p, fs); gl!.linkProgram(p);
      if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) { console.error(gl!.getProgramInfoLog(p)); return null; }
      return p;
    }

    const vs = compile(gl.VERTEX_SHADER, baseVS)!;
    function prog(name: string, fsSrc: string) {
      const fs = compile(gl!.FRAGMENT_SHADER, fsSrc);
      if (!fs) { console.error(`[Fluid] shader "${name}" compile failed`); return { program: gl!.createProgram()!, uniforms: {} }; }
      const p = link(vs, fs);
      if (!p) { console.error(`[Fluid] program "${name}" link failed`); return { program: gl!.createProgram()!, uniforms: {} }; }
      const u: Record<string, WebGLUniformLocation> = {};
      for (let i = 0; i < gl!.getProgramParameter(p, gl!.ACTIVE_UNIFORMS); i++) {
        const info = gl!.getActiveUniform(p, i)!;
        u[info.name] = gl!.getUniformLocation(p, info.name)!;
      }
      return { program: p, uniforms: u };
    }

    const P = {
      clear: prog('clear', clearFS),
      splat: prog('splat', splatFS),
      advection: prog('advection', advectionFS),
      divergence: prog('divergence', divergenceFS),
      curl: prog('curl', curlFS),
      vorticity: prog('vorticity', vorticityFS),
      pressure: prog('pressure', pressureFS),
      gradient: prog('gradient', gradientFS),
      display: prog('display', displayFS),
    };

    // ── Quad ──
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // ── FBO ──
    function createFBO(w: number, h: number, intF: number, fmt: number, type: number, filter: number) {
      gl!.activeTexture(gl!.TEXTURE0);
      const tex = gl!.createTexture()!;
      gl!.bindTexture(gl!.TEXTURE_2D, tex);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, intF, w, h, 0, fmt, type, null);
      const fbo = gl!.createFramebuffer()!;
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
      gl!.viewport(0, 0, w, h);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      return {
        texture: tex, fbo, width: w, height: h,
        attach(id: number) { gl!.activeTexture(gl!.TEXTURE0 + id); gl!.bindTexture(gl!.TEXTURE_2D, tex); return id; }
      };
    }

    function createDoubleFBO(w: number, h: number, intF: number, fmt: number, type: number, filter: number) {
      let a = createFBO(w, h, intF, fmt, type, filter);
      let b = createFBO(w, h, intF, fmt, type, filter);
      return {
        width: w, height: h, texelSizeX: 1/w, texelSizeY: 1/h,
        get read() { return a; }, set read(v: any) { a = v; },
        get write() { return b; }, set write(v: any) { b = v; },
        swap() { const t = a; a = b; b = t; }
      };
    }

    function getRes(res: number) {
      let ar = gl!.drawingBufferWidth / gl!.drawingBufferHeight;
      if (ar < 1) ar = 1 / ar;
      const mn = Math.round(res), mx = Math.round(res * ar);
      return gl!.drawingBufferWidth > gl!.drawingBufferHeight ? { width: mx, height: mn } : { width: mn, height: mx };
    }

    let dye: any, velocity: any, divFBO: any, curlFBO: any, pressure: any;

    function initFBOs() {
      const sr = getRes(SIM_RESOLUTION);
      const dr = getRes(DYE_RESOLUTION);
      velocity = createDoubleFBO(sr.width, sr.height, gl!.RG16F, gl!.RG, gl!.HALF_FLOAT, gl!.LINEAR);
      dye = createDoubleFBO(dr.width, dr.height, gl!.RGBA16F, gl!.RGBA, gl!.HALF_FLOAT, gl!.LINEAR);
      divFBO = createFBO(sr.width, sr.height, gl!.R16F, gl!.RED, gl!.HALF_FLOAT, gl!.NEAREST);
      curlFBO = createFBO(sr.width, sr.height, gl!.R16F, gl!.RED, gl!.HALF_FLOAT, gl!.NEAREST);
      pressure = createDoubleFBO(sr.width, sr.height, gl!.R16F, gl!.RED, gl!.HALF_FLOAT, gl!.NEAREST);
    }

    let firstResize = true;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(canvas!.clientWidth * dpr);
      const h = Math.floor(canvas!.clientHeight * dpr);
      if (firstResize || canvas!.width !== w || canvas!.height !== h) {
        firstResize = false;
        canvas!.width = w;
        canvas!.height = h;
        initFBOs();
      }
    }
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    // ── Blit ──
    function blit(target: any) {
      if (target == null) { gl!.viewport(0, 0, gl!.drawingBufferWidth, gl!.drawingBufferHeight); gl!.bindFramebuffer(gl!.FRAMEBUFFER, null); }
      else { gl!.viewport(0, 0, target.width, target.height); gl!.bindFramebuffer(gl!.FRAMEBUFFER, target.fbo); }
      gl!.bindVertexArray(vao);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
    }

    // ── Splat ──
    function splatAt(x: number, y: number, dx: number, dy: number, color: { r: number; g: number; b: number }) {
      textureUnit = 0;
      gl!.useProgram(P.splat.program);
      gl!.uniform1i(P.splat.uniforms.uTarget, velocity.read.attach(0));
      gl!.uniform1f(P.splat.uniforms.aspectRatio, canvas!.width / canvas!.height);
      gl!.uniform2f(P.splat.uniforms.point, x, y);
      gl!.uniform3f(P.splat.uniforms.color, dx, dy, 0);
      gl!.uniform1f(P.splat.uniforms.radius, correctRadius(SPLAT_RADIUS / 100));
      blit(velocity.write); velocity.swap();
      textureUnit = 0;
      gl!.uniform1i(P.splat.uniforms.uTarget, dye.read.attach(0));
      gl!.uniform3f(P.splat.uniforms.color, color.r, color.g, color.b);
      blit(dye.write); dye.swap();
    }

    function correctRadius(r: number) {
      const ar = canvas!.width / canvas!.height;
      if (ar > 1) r *= ar;
      return r;
    }

    // ── Auto splats ──
    let lastSplat = 0;
    function autoSplat(t: number) {
      if (t - lastSplat > 1.5) {
        lastSplat = t;
        const ci = Math.floor(Math.random() * PALETTE.length);
        const c = PALETTE[ci];
        splatAt(Math.random(), Math.random(), (Math.random()-0.5)*800, (Math.random()-0.5)*800,
          { r: c[0]*0.03, g: c[1]*0.03, b: c[2]*0.03 });
      }
    }

    // ── Init splats ──
    for (let i = 0; i < 5; i++) {
      const c = PALETTE[i % PALETTE.length];
      splatAt(0.15+Math.random()*0.7, 0.15+Math.random()*0.7,
        (Math.random()-0.5)*1500, (Math.random()-0.5)*1500,
        { r: c[0]*0.1, g: c[1]*0.1, b: c[2]*0.1 });
    }

    // ── Simulation ──
    function step(dt: number) {
      gl!.disable(gl!.BLEND);

      textureUnit = 0;
      gl!.useProgram(P.curl.program);
      gl!.uniform2f(P.curl.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl!.uniform1i(P.curl.uniforms.uVelocity, velocity.read.attach(0));
      blit(curlFBO);

      textureUnit = 0;
      gl!.useProgram(P.vorticity.program);
      gl!.uniform2f(P.vorticity.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl!.uniform1i(P.vorticity.uniforms.uVelocity, velocity.read.attach(0));
      gl!.uniform1i(P.vorticity.uniforms.uCurl, curlFBO.attach(1));
      gl!.uniform1f(P.vorticity.uniforms.curl, CURL);
      gl!.uniform1f(P.vorticity.uniforms.dt, dt);
      blit(velocity.write); velocity.swap();

      textureUnit = 0;
      gl!.useProgram(P.divergence.program);
      gl!.uniform2f(P.divergence.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl!.uniform1i(P.divergence.uniforms.uVelocity, velocity.read.attach(0));
      blit(divFBO);

      textureUnit = 0;
      gl!.useProgram(P.clear.program);
      gl!.uniform1i(P.clear.uniforms.uTexture, pressure.read.attach(0));
      gl!.uniform1f(P.clear.uniforms.value, 0.8);
      blit(pressure.write); pressure.swap();

      gl!.useProgram(P.pressure.program);
      gl!.uniform2f(P.pressure.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl!.uniform1i(P.pressure.uniforms.uDivergence, divFBO.attach(0));
      for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
        textureUnit = 0;
        gl!.uniform1i(P.pressure.uniforms.uDivergence, divFBO.attach(0));
        gl!.uniform1i(P.pressure.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write); pressure.swap();
      }

      textureUnit = 0;
      gl!.useProgram(P.gradient.program);
      gl!.uniform2f(P.gradient.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl!.uniform1i(P.gradient.uniforms.uPressure, pressure.read.attach(0));
      gl!.uniform1i(P.gradient.uniforms.uVelocity, velocity.read.attach(1));
      blit(velocity.write); velocity.swap();

      textureUnit = 0;
      gl!.useProgram(P.advection.program);
      gl!.uniform2f(P.advection.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl!.uniform1f(P.advection.uniforms.dt, dt);
      gl!.uniform1f(P.advection.uniforms.dissipation, VELOCITY_DISSIPATION);
      gl!.uniform1i(P.advection.uniforms.uVelocity, velocity.read.attach(0));
      gl!.uniform1i(P.advection.uniforms.uSource, velocity.read.attach(0));
      blit(velocity.write); velocity.swap();

      textureUnit = 0;
      gl!.uniform1f(P.advection.uniforms.dissipation, DENSITY_DISSIPATION);
      gl!.uniform1i(P.advection.uniforms.uVelocity, velocity.read.attach(0));
      gl!.uniform1i(P.advection.uniforms.uSource, dye.read.attach(1));
      blit(dye.write); dye.swap();
    }

    // ── Pointer input ──
    interface Ptr { id: number; tx: number; ty: number; ptx: number; pty: number; dx: number; dy: number; down: boolean; moved: boolean; color: {r:number;g:number;b:number} }
    let colorIdx = 0;
    function makeColor(): {r:number;g:number;b:number} {
      const c = PALETTE[colorIdx++ % PALETTE.length];
      return { r: c[0]*0.08, g: c[1]*0.08, b: c[2]*0.08 };
    }
    const ptr: Ptr = { id: -1, tx: 0, ty: 0, ptx: 0, pty: 0, dx: 0, dy: 0, down: false, moved: false, color: makeColor() };

    function onDown(ex: number, ey: number) {
      ptr.down = true; ptr.moved = false;
      ptr.tx = ex / canvas!.clientWidth;
      ptr.ty = 1.0 - ey / canvas!.clientHeight;
      ptr.ptx = ptr.tx; ptr.pty = ptr.ty;
      ptr.dx = 0; ptr.dy = 0;
      ptr.color = makeColor();
    }
    function onMove(ex: number, ey: number) {
      if (!ptr.down) return;
      ptr.ptx = ptr.tx; ptr.pty = ptr.ty;
      ptr.tx = ex / canvas!.clientWidth;
      ptr.ty = 1.0 - ey / canvas!.clientHeight;
      const ar = canvas!.width / canvas!.height;
      ptr.dx = ptr.tx - ptr.ptx; ptr.dy = ptr.ty - ptr.pty;
      if (ar < 1) ptr.dx *= ar; else ptr.dy /= ar;
      ptr.moved = Math.abs(ptr.dx) > 0 || Math.abs(ptr.dy) > 0;
    }
    function onUp() { ptr.down = false; }

    canvas!.addEventListener('mousedown', (e: MouseEvent) => onDown(e.offsetX, e.offsetY));
    canvas!.addEventListener('mousemove', (e: MouseEvent) => onMove(e.offsetX, e.offsetY));
    window.addEventListener('mouseup', onUp);

    // ── Render ──
    let lastT = 0;
    let rafId = 0;
    function render(time: number) {
      rafId = requestAnimationFrame(render);
      const t = time * 0.001;
      const dt = Math.min(t - lastT, 0.016666);
      lastT = t;
      resize();

      // Pointer splat
      if (ptr.moved) {
        ptr.moved = false;
        const dx = ptr.dx * SPLAT_FORCE;
        const dy = ptr.dy * SPLAT_FORCE;
        splatAt(ptr.tx, ptr.ty, dx, dy, ptr.color);
      }

      autoSplat(t);
      step(dt);

      textureUnit = 0;
      gl!.useProgram(P.display.program);
      gl!.uniform2f(P.display.uniforms.texelSize, 1/gl!.drawingBufferWidth, 1/gl!.drawingBufferHeight);
      gl!.uniform1i(P.display.uniforms.uDye, dye.read.attach(1));
      gl!.uniform1i(P.display.uniforms.uVelocity, velocity.read.attach(0));
      gl!.uniform1f(P.display.uniforms.time, t);
      blit(null);
    }
    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      canvas!.removeEventListener('mousedown', () => {});
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }} />;
}
