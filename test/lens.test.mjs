import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:800}, deviceScaleFactor:1 });
await page.goto('http://localhost:5173/',{waitUntil:'networkidle'});
await page.waitForTimeout(1500);

// Ask the SHADER what it computes, by rendering the refraction offset
// itself as colour. No template matching, no ambiguity.
const r = await page.evaluate(()=>{
  const p=window.__panel, gl=p.renderer.gl, c=p.canvas;
  const frag=`#version 300 es
precision highp float;
uniform vec2 uResolution,uCenter,uHalfSize; uniform float uRadius,uBevel,uBevelPower,uProfile,uIOR,uThickness,uSplay;
out vec4 o;
float sdRoundRect(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.0)+length(max(q,0.0))-r;}
float convexHeight(float t,float pw){t=clamp(t,0.0,1.0);float u=1.0-t;return pow(max(1.0-pow(u,pw),0.0),1.0/pw);}
float smootherstep(float t){t=clamp(t,0.0,1.0);return t*t*t*(t*(t*6.0-15.0)+10.0);}
float surfaceHeight(float t,float pw,float pr){float cv=convexHeight(t,pw);float cc=1.0-cv;float lip=mix(cv,cc,smootherstep(t));
  return pr<0.5?mix(cv,lip,pr*2.0):mix(lip,cc,(pr-0.5)*2.0);}
vec2 bendXY(vec3 I,vec3 N,float eta){vec3 r=refract(I,N,eta);if(dot(r,r)<1e-8)return vec2(0.0);return r.xy/max(abs(r.z),0.25);}
void main(){
  vec2 pp=vec2(gl_FragCoord.x,uResolution.y-gl_FragCoord.y);
  vec2 local=pp-uCenter; vec2 half_=uHalfSize;
  float radius=min(uRadius,min(half_.x,half_.y));
  float d=sdRoundRect(local,half_,radius);
  if(d>0.0){o=vec4(0.0);return;}
  float bevel=max(uBevel,1.0);
  float t=clamp(-d/bevel,0.0,1.0);
  float h=surfaceHeight(t,uBevelPower,uProfile);
  vec2 q=local/max(half_,vec2(1.0));
  float rN=clamp(length(q),0.0,1.0);
  float lensH=sqrt(max(1.0-rN*rN,0.0));
  h=mix(h,lensH,uSplay);
  float e=1.0;
  vec2 grad=vec2(sdRoundRect(local+vec2(e,0),half_,radius)-sdRoundRect(local-vec2(e,0),half_,radius),
                 sdRoundRect(local+vec2(0,e),half_,radius)-sdRoundRect(local-vec2(0,e),half_,radius))/(2.0*e);
  grad=normalize(grad+vec2(1e-6));
  const float DELTA=0.002;
  float bs=(surfaceHeight(t+DELTA,uBevelPower,uProfile)-surfaceHeight(t-DELTA,uBevelPower,uProfile))/(2.0*DELTA);
  bs*=uThickness/bevel;
  float ls=clamp(-rN/max(sqrt(max(1.0-rN*rN,0.0)),0.35),-4.0,4.0);
  vec2 radial=normalize(q/max(half_,vec2(1.0))+vec2(1e-6));
  vec2 dir=normalize(mix(grad,radial,uSplay)+vec2(1e-6));
  float slope=mix(bs,ls,uSplay);
  vec3 N=normalize(vec3(-dir*slope,1.0));
  vec3 I=vec3(0,0,-1);
  float depth=uThickness*(h+uSplay);
  vec2 off=bendXY(I,N,1.0/max(uIOR,1.0001))*depth;
  // encode |offset| in px into red, 0..60px -> 0..255
  o=vec4(clamp(length(off)/60.0,0.0,1.0),0,0,1);
}`;
  const vs=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
  const mk=(ty,s)=>{const sh=gl.createShader(ty);gl.shaderSource(sh,s);gl.compileShader(sh);
    if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh));return sh;};
  const pr=gl.createProgram();gl.attachShader(pr,mk(gl.VERTEX_SHADER,vs));gl.attachShader(pr,mk(gl.FRAGMENT_SHADER,frag));
  gl.linkProgram(pr); if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(pr));
  const rect={x:190,y:290,width:900,height:220};
  const U=n=>gl.getUniformLocation(pr,n);
  const run=(splay)=>{
    gl.useProgram(pr); gl.bindVertexArray(gl.createVertexArray());
    gl.viewport(0,0,c.width,c.height); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U('uResolution'),c.width,c.height);
    gl.uniform2f(U('uCenter'),rect.x+rect.width/2,rect.y+rect.height/2);
    gl.uniform2f(U('uHalfSize'),rect.width/2,rect.height/2);
    gl.uniform1f(U('uRadius'),44); gl.uniform1f(U('uBevel'),60); gl.uniform1f(U('uBevelPower'),2.2); gl.uniform1f(U('uProfile'),0.0);
    gl.uniform1f(U('uIOR'),1.20); gl.uniform1f(U('uThickness'),34); gl.uniform1f(U('uSplay'),splay);
    gl.drawArrays(gl.TRIANGLES,0,3);
    const cy=rect.y+rect.height/2;
    const samp=[];
    for(const fx of [0.5,0.55,0.6,0.65,0.7]){
      const x=rect.x+rect.width*fx;
      const px=new Uint8Array(4);
      gl.readPixels(Math.round(x),Math.round(c.height-cy),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
      samp.push(+(px[0]/255*60).toFixed(1));
    }
    return samp;
  };
  return { splay0:run(0.0), splay1:run(1.0) };
});
console.log('refraction offset (px) along panel centre row, x = 50%..70% of width:');
console.log('  splay 0 :', JSON.stringify(r.splay0));
console.log('  splay 1 :', JSON.stringify(r.splay1));
const s0=r.splay0.reduce((a,b)=>a+b,0), s1=r.splay1.reduce((a,b)=>a+b,0);
// A bevelled sheet is optically flat away from the rim, so its interior
// offset must be ~0. A lens curves across the whole face, so the interior
// must actually bend light. Measured from the shader's own refraction
// offset rather than from pixels: template-matching a smooth backdrop
// finds false minima and reports motion that is not there.
const flatOK = s0 < 0.5;
const lensOK = s1 > s0 + 5;
console.log('splay 0 interior is flat :', flatOK ? 'PASS' : `FAIL (${s0.toFixed(1)}px)`);
console.log('splay 1 interior refracts:', lensOK ? 'PASS' : `FAIL (${s1.toFixed(1)}px)`);
await browser.close();
process.exit(flatOK && lensOK ? 0 : 1);
