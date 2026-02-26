
/* drawScript.safe.js — namespaced, redeclare-safe curved lane drawer
   - No globals like `drawMode` or a global `toggleDrawMode` are declared.
   - Exposes a single API: window.PathDrawer.toggle()
   - Compatibility: if no global toggleDrawMode exists, it defines a shim that calls PathDrawer.toggle().
*/

(() => {
  if (window.PathDrawer) {
    console.info("[PathDrawer] Already loaded; skipping re-init.");
    return;
  }

  const perspectiveConfig = {
    minWidth: 1,
    maxWidth: 320,
    easingExponent: 2,
  };

  const drawConfig = {
    previewDash: "10 10",
    outlineStroke: "#39ff88",
    outlineFill: "#39ff88",
    outlineFillOpacity: 0.28,
    outlineStrokeWidth: 1.2,
    centerStrokeWidth: 1.6,
    centerDash: "8 8",
    showChevrons: true,
    chevronCount: 5,
    chevronOpacity: 0.55,
    chevronStroke: "#ffd93b",
    chevronFill: "#ffef75",
    chevronStrokeWidth: 2,
    chevronDurationMs: 2600,
  };

  const minPointSpacing = 3.0;
  const samplesPerSegment = 32;
  const chevronSpacingPx = 160;

	// --- Horizon UI config ---
	const HORIZON_CFG = {
		defaultFrac: 0.50,      // reset to 50% on wipe
		hit: 18,                // pixels: hover/drag hit zone around the line
		minFrac: 0.10,          // clamp horizon between 10% and 90% of screen
		maxFrac: 0.90,
		topTint:  "rgba(255,60,60,0.08)",
		botTint:  "rgba(60,255,120,0.08)",
		line:     "#51a6ff",
		lineWidth: 2
	};

	(function ensureHorizonStyles(){
		if (document.getElementById("pd-horizon-styles")) return;
		const st = document.createElement("style");
		st.id = "pd-horizon-styles";
		st.textContent = `
			/* Horizon hint visuals */
			.pd-hintBubble { fill:#ffe38a; stroke:#b48a00; stroke-width:1.5;
											 filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
			.pd-hintNotch  { fill:#ffe38a; stroke:#b48a00; stroke-width:1.5; }
			.pd-hintText   { font:600 13px/1.0 system-ui, sans-serif; fill:#2b2b2b; }

			/* static arrows (no animation) */
			.pd-mouse      { fill:#eee; stroke:#333; stroke-width:1; }
			.pd-mouse-left { fill:#4ea3ff; }
			.pd-redx       { stroke:#ff3a3a; stroke-width:2.5; }

			/* soft blink (2s) for hint + buttons */
			@keyframes pdSoftBlink { 0%{opacity:.6} 50%{opacity:1} 100%{opacity:.6} }
			.pd-softblink { animation: pdSoftBlink 2s ease-in-out infinite; }

			/* allow bubble AND text to blink together with the hint */
			.pd-hintBubble.pd-softblink, .pd-hintText.pd-softblink { animation: pdSoftBlink 2s ease-in-out infinite; }

			/* smooth fade for the whole hint group */
			.pd-hintGroup { transition: opacity .3s ease; }

			/* ghosty glow for flashing toolbar buttons (keeps the button visible) */
			.overlay-bottomright.pd-flash{
				animation: pdGlow 2s ease-in-out infinite;
				box-shadow:
					0 0 0 0 rgba(255,227,138,.18),
					0 0 16px 6px rgba(255,227,138,.22);
				border-color: #b48a00 !important; /* subtle gold accent */
			}
			@keyframes pdGlow{
				0%,100%{
					box-shadow:
						0 0 0 0 rgba(255,227,138,.18),
						0 0 16px 6px rgba(255,227,138,.22);
				}
				50%{
					box-shadow:
						0 0 0 0 rgba(255,227,138,.32),
						0 0 26px 10px rgba(255,227,138,.55);
				}
			}
			/* Toolbar buttons created by drawScript */
			.pd-toolbar-btn{
				display:flex;
				align-items:center;
				gap:8px;
				padding:6px 12px;
				border-radius:6px;
				white-space:nowrap;
			}

			/* icon sizing inside our buttons */
			.pd-toolbar-btn .overlay-icon{
				width:18px; height:18px; flex:0 0 auto;
			}
			.pd-toolbar-btn .overlay-label{
				display:inline-block;
				line-height:1;
			}
			
		`;
		document.head.appendChild(st);
	})();

  function getSurfaceBounds(surface) {
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  const clamp01 = (v)=>Math.max(0, Math.min(1, v));
  const lerp = (a,b,t)=>a+(b-a)*t;
  const vecAdd = (a,b)=>({x:a.x+b.x, y:a.y+b.y});
  const vecSub = (a,b)=>({x:a.x-b.x, y:a.y-b.y});
  const vecScale=(a,s)=>({x:a.x*s, y:a.y*s});
  const vlen = (a)=>Math.hypot(a.x,a.y);
  const vnorm = (a)=>{ const L=vlen(a)||1; return {x:a.x/L,y:a.y/L}; };
  const vperp = (a)=>({x:-a.y,y:a.x});

	function perspectiveHalfWidth(y, bounds, horizonY){
		if (!bounds || !bounds.height) return perspectiveConfig.maxWidth;

		// Use current horizon (if not passed) so taper is relative to horizon, not the top of the screen
		const h = (typeof horizonY === "number")
			? horizonY
			: (window.PathDrawer?._state?.horizonY ?? 0);

		// Normalize: 0 at horizon, 1 at bottom
		const denom = Math.max(1, bounds.height - h);
		const t = Math.max(0, Math.min(1, (y - h) / denom));

		// Ease the taper. Higher exponent = stronger perspective (narrower near horizon).
		const eased = Math.pow(t, perspectiveConfig.easingExponent);

		// Interpolate from min at horizon → max at bottom
		return lerp(perspectiveConfig.minWidth, perspectiveConfig.maxWidth, eased);
	}


  function catmullRom(p0,p1,p2,p3,t){
    const t2=t*t, t3=t2*t;
    const a0 = -0.5*t3 + t2 - 0.5*t;
    const a1 =  1.5*t3 - 2.5*t2 + 1.0;
    const a2 = -1.5*t3 + 2.0*t2 + 0.5*t;
    const a3 =  0.5*t3 - 0.5*t2;
    return { x:a0*p0.x+a1*p1.x+a2*p2.x+a3*p3.x, y:a0*p0.y+a1*p1.y+a2*p2.y+a3*p3.y };
  }

  function sampleCatmullRom(points, segSamples) {
    if (!Array.isArray(points) || points.length < 2) return points||[];
    const pts = points.slice();
    if (pts.length === 2) {
      const [a,b] = pts, out=[], steps=Math.max(2,segSamples);
      for (let i=0;i<=steps;i++){ const t=i/steps; out.push({x:lerp(a.x,b.x,t), y:lerp(a.y,b.y,t)}); }
      return out;
    }
    const first=pts[0], last=pts[pts.length-1];
    const chain=[first, ...pts, last];
    const res=[];
    for (let i=0;i<chain.length-3;i++){
      const p0=chain[i], p1=chain[i+1], p2=chain[i+2], p3=chain[i+3];
      for (let s=0;s<segSamples;s++){ res.push(catmullRom(p0,p1,p2,p3,s/segSamples)); }
    }
    res.push(last);
    return res;
  }

  function buildLaneEdges(samples, bounds){
    if (!samples || samples.length<2) return null;
    const left=[], right=[];
    for (let i=0;i<samples.length;i++){
      const c=samples[i], prev=i>0?samples[i-1]:samples[i], next=i<samples.length-1?samples[i+1]:samples[i];
      const tangent=vnorm(vecSub(next,prev));
      const normal=vperp(tangent);
      const half=perspectiveHalfWidth(c.y,bounds);
      left.push(vecAdd(c, vecScale(normal,+half)));
      right.push(vecAdd(c, vecScale(normal,-half)));
    }
    return {left,right};
  }

	// Build edges but clamp half-width so BOTH sides stay below the horizon
	function buildLaneEdgesClamped(samples, bounds, horizonY, pad = 2){
		if (!samples || samples.length < 2) return null;
		const left = [], right = [];

		for (let i = 0; i < samples.length; i++){
			const c    = samples[i];
			const prev = i > 0 ? samples[i - 1] : samples[i];
			const next = i < samples.length - 1 ? samples[i + 1] : samples[i];

			const tangent = vnorm(vecSub(next, prev));
			const n       = vperp(tangent); // +n = “left”, −n = “right”
			const half    = perspectiveHalfWidth(c.y, bounds);

			// shrink half so neither side goes above horizon
			let allowed = half;
			const limitY = horizonY + pad;

			// left edge moves by +n*half → goes up if n.y < 0
			if (n.y < 0) {
				const maxHalf = (c.y - limitY) / (-n.y);
				allowed = Math.min(allowed, Math.max(0, maxHalf));
			}
			// right edge moves by −n*half → goes up if (−n.y) < 0 ⇔ n.y > 0
			if (n.y > 0) {
				const maxHalf = (c.y - limitY) / ( n.y);
				allowed = Math.min(allowed, Math.max(0, maxHalf));
			}

			left .push(vecAdd(c, vecScale(n, +allowed)));
			right.push(vecAdd(c, vecScale(n, -allowed)));
		}
		return { left, right };
	}

  function laneOutlinePath(left,right){
    if (!left?.length || !right?.length) return "";
    const pts=[...left, ...right.slice().reverse()];
    let d=`M ${pts[0].x} ${pts[0].y}`;
    for (let i=1;i<pts.length;i++) d+=` L ${pts[i].x} ${pts[i].y}`;
    return d+" Z";
  }

  function appendCenterline(svg, samples, options){
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("points", samples.map(p=>`${p.x},${p.y}`).join(" "));
    poly.setAttribute("fill","none");
    poly.setAttribute("stroke", options.stroke || "#39ff88");
    poly.setAttribute("stroke-width", String(options.strokeWidth ?? 1.6));
    poly.setAttribute("stroke-linecap","round");
    poly.setAttribute("stroke-linejoin","round");
    poly.setAttribute("vector-effect","non-scaling-stroke");
    if (options.dash) poly.setAttribute("stroke-dasharray", options.dash);
    poly.classList.add("drawn-centerline");
    svg.appendChild(poly);
    return poly;
  }

	function appendChevronStream(svg, samples, bounds, options = {}) {
		if (!drawConfig.showChevrons) return null;

		const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
		group.classList.add("chevrons");
		svg.appendChild(group);

		// ---- arc-length table on centerline ----
		const acc = [0];
		for (let i = 1; i < samples.length; i++) {
			acc[i] = acc[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
		}
		const total = acc[acc.length - 1] || 1;

		function sampleAtS(s) {
			s = Math.max(0, Math.min(total, s));
			let lo = 0, hi = acc.length - 1;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (acc[mid] < s) lo = mid + 1; else hi = mid;
			}
			const i = Math.max(1, lo), s0 = acc[i - 1], s1 = acc[i];
			const t = (s1 === s0) ? 0 : ((s - s0) / (s1 - s0));
			const p0 = samples[i - 1], p1 = samples[i];

			// smooth-ish tangent
			let tx = 0, ty = 0;
			if (i > 0) { tx += samples[i].x - samples[i - 1].x; ty += samples[i].y - samples[i - 1].y; }
			if (i < samples.length - 1) { tx += samples[i + 1].x - samples[i].x; ty += samples[i + 1].y - samples[i].y; }
			const m = Math.hypot(tx, ty) || 1;

			return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, tx: tx / m, ty: ty / m };
		}

		// ---- geometry helpers for edge intersections ----
		const cross = (ax, ay, bx, by) => ax * by - ay * bx;
		function lineSegIntersect(P, R, A, B) {
			const Sx = B.x - A.x, Sy = B.y - A.y, denom = cross(R.x, R.y, Sx, Sy);
			if (Math.abs(denom) < 1e-9) return null;
			const Qx = A.x - P.x, Qy = A.y - P.y;
			const u = cross(Qx, Qy, Sx, Sy) / denom;     // along normal line
			const v = cross(Qx, Qy, R.x, R.y) / denom;   // along segment
			if (v < 0 || v > 1) return null;
			return { u, x: P.x + R.x * u, y: P.y + R.y * u };
		}
		function normalIntersections(C, n, poly) {
			let pos = null, neg = null, up = Infinity, un = -Infinity;
			for (let i = 0; i < poly.length - 1; i++) {
				const hit = lineSegIntersect(C, n, poly[i], poly[i + 1]);
				if (!hit) continue;
				if (hit.u > 0 && hit.u < up) { up = hit.u; pos = { x: hit.x, y: hit.y }; }
				if (hit.u < 0 && hit.u > un) { un = hit.u; neg = { x: hit.x, y: hit.y }; }
			}
			return { pos, neg };
		}

		const leftEdge  = Array.isArray(options.laneLeft)  ? options.laneLeft  : null;
		const rightEdge = Array.isArray(options.laneRight) ? options.laneRight : null;

		// ---- triangle size from actual base width ----
		const heightRatio = 0.275;
		const minBaseCull = 8;
		const edgeInset   = 0;

		function trianglePathAtS(s) {
			const c = sampleAtS(s);
			const n = { x: -c.ty, y: c.tx }; // left-hand normal

			// base from edge intersections, fallback to half-width
			let BL = null, BR = null;
			if (leftEdge && rightEdge) {
				const L = normalIntersections({ x: c.x, y: c.y }, n, leftEdge);
				const R = normalIntersections({ x: c.x, y: c.y }, n, rightEdge);
				if (L.pos && R.neg) { BL = { x: L.pos.x - n.x * edgeInset, y: L.pos.y - n.y * edgeInset };
															BR = { x: R.neg.x + n.x * edgeInset, y: R.neg.y + n.y * edgeInset }; }
				else if (L.neg && R.pos) { BL = { x: L.neg.x - n.x * edgeInset, y: L.neg.y - n.y * edgeInset };
																		BR = { x: R.pos.x + n.x * edgeInset, y: R.pos.y + n.y * edgeInset }; }
			}
			if (!BL || !BR) {
				const half = perspectiveHalfWidth(c.y, bounds);
				BL = BL || { x: c.x - n.x * half, y: c.y - n.y * half };
				BR = BR || { x: c.x + n.x * half, y: c.y + n.y * half };
			}

			const baseW = Math.hypot(BR.x - BL.x, BR.y - BL.y);
			if (baseW < minBaseCull) return "";

			// apex on centerline, offset forward by height
			const H = Math.max(4, baseW * heightRatio);
			const A = sampleAtS(Math.min(total, s + H));

			return `M ${BL.x} ${BL.y} L ${BR.x} ${BR.y} L ${A.x} ${A.y} Z`;
		}

		// ---- layout without overlap ----
		const margin   = 150;                     // keep headroom near ends
		const usable   = Math.max(0, total - margin);
		// sample a few spots to estimate largest triangle base width for spacing
		let maxBase = 12;
		const probes = 20;
		for (let i = 0; i <= probes; i++) {
			const s = (total - usable) * 0.5 + (usable * i / probes);
			const d = trianglePathAtS(s);
			if (!d) continue;
			const a = d.split(/[MLZ ,]/).filter(Boolean).map(Number);
			if (a.length >= 6) {
				const bw = Math.hypot(a[2]-a[0], a[3]-a[1]);
				if (bw > maxBase) maxBase = bw;
			}
		}
		const gap    = 0.35;                      // 35% gap between triangles
		const spacingPx = Math.max(18, maxBase * (1 + gap));
		const maxCount  = Math.floor((usable || total) / spacingPx);
		const desired   = drawConfig.chevronCount || 5;
		const count     = Math.max(2, Math.min(desired, maxCount)); // ensure ≥2 if possible
		const spacingS  = (usable || total) / count;

		// create triangles
		const tris = [];
		for (let i = 0; i < count; i++) {
			const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
			p.setAttribute("fill", drawConfig.chevronFill);
			p.setAttribute("fill-opacity", String(drawConfig.chevronOpacity));
			p.setAttribute("stroke", drawConfig.chevronStroke);
			p.setAttribute("stroke-width", String(drawConfig.chevronStrokeWidth));
			p.setAttribute("stroke-linejoin", "round");
			p.setAttribute("stroke-linecap", "round");
			group.appendChild(p);
			tris.push(p);
		}

		// ---- movement at constant speed, 5× slower than before ----
		const duration = Math.max(400, (drawConfig.chevronDurationMs || 2600) * 5);
		const speedS   = (usable || total) / duration;   // arc-length units per ms

		let rafId = 0, t0 = performance.now();
		const startS = (total - usable) * 0.5;

		function frame(now) {
			const offset = ((now - t0) * speedS) % (usable || total);
			for (let i = 0; i < tris.length; i++) {
				const s = startS + (i * spacingS + offset) % (usable || total);
				const d = trianglePathAtS(s);
				if (d) tris[i].setAttribute("d", d); else tris[i].removeAttribute("d");
			}
			rafId = requestAnimationFrame(frame);
		}
		rafId = requestAnimationFrame(frame);
		group.__cleanup = () => cancelAnimationFrame(rafId);
		return group;
	}

	function clearOverlay(svg){
		while (svg.lastChild) {
			const n = svg.lastChild;
			if (typeof n.__cleanup === "function") {
				try { n.__cleanup(); } catch {}
			}
			svg.removeChild(n);
		}
	}

	// Render lane as a strip of trapezoids (per-segment fill) to avoid polygon self-intersections
	function drawLaneStrip(svg, edges) {
		const left  = edges.left;
		const right = edges.right;
		if (!left || !right || left.length < 2 || right.length < 2) return;

		for (let i = 0; i < left.length - 1 && i < right.length - 1; i++) {
			const L1 = left[i],     L2 = left[i + 1];
			const R1 = right[i],    R2 = right[i + 1];

			// One trapezoid per segment
			const d = `M ${L1.x} ${L1.y} L ${L2.x} ${L2.y} L ${R2.x} ${R2.y} L ${R1.x} ${R1.y} Z`;
			const seg = document.createElementNS("http://www.w3.org/2000/svg", "path");
			seg.setAttribute("d", d);
			seg.setAttribute("fill", drawConfig.outlineFill);
			seg.setAttribute("fill-opacity", String(drawConfig.outlineFillOpacity));
			seg.setAttribute("stroke", "none");                 // no stroke on the fill => no bulging joins
			seg.setAttribute("shape-rendering", "geometricPrecision");
			seg.setAttribute("pointer-events", "none");
			svg.appendChild(seg);
		}
	}

	// --- join repair helpers ---
	const EPS = 1e-6;
	const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;

	function lineIntersection(pA, dA, pB, dB) {
		const denom = cross2(dA.x, dA.y, dB.x, dB.y);
		if (Math.abs(denom) < EPS) return null;
		const qAx = pB.x - pA.x, qAy = pB.y - pA.y;
		const t = cross2(qAx, qAy, dB.x, dB.y) / denom;
		return { x: pA.x + dA.x * t, y: pA.y + dA.y * t };
	}

	// Make offset side polyline use a proper miter (clamped) on convex turns,
	// and a bevel (original vertex) on concave turns to avoid overlaps.
	function miterJoinSide(pts, isLeft, miterLimitPx = 40) {
		if (!pts || pts.length < 3) return pts || [];
		const out = [pts[0]];
		for (let i = 1; i < pts.length - 1; i++) {
			const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
			const d0 = { x: p1.x - p0.x, y: p1.y - p0.y };
			const d1 = { x: p2.x - p1.x, y: p2.y - p1.y };
			const L0 = Math.hypot(d0.x, d0.y) || 1, L1 = Math.hypot(d1.x, d1.y) || 1;
			const tSign = cross2(d0.x, d0.y, d1.x, d1.y);
			const convex = isLeft ? (tSign > 0) : (tSign < 0); // convex on that side?

			if (convex) {
				const inter = lineIntersection(p0, d0, p1, d1);
				if (inter) {
					const mLen = Math.hypot(inter.x - p1.x, inter.y - p1.y);
					const maxLen = Math.min(L0, L1) + miterLimitPx; // clamp spike
					out.push(mLen > maxLen ? p1 : inter);
				} else {
					out.push(p1); // parallel -> bevel
				}
			} else {
				out.push(p1);   // concave -> bevel to avoid self-overlap
			}
		}
		out.push(pts[pts.length - 1]);
		return out;
	}

	function fixOffsetJoins(edges) {
		return {
			left:  miterJoinSide(edges.left,  true,  40),
			right: miterJoinSide(edges.right, false, 40),
		};
	}

	function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

	function makeSVG(tag){ return document.createElementNS("http://www.w3.org/2000/svg", tag); }

	function buildHorizonGroup(svg, bounds, y){
		const g = makeSVG("g"); g.classList.add("pd-horizon"); svg.appendChild(g);

		const top = makeSVG("rect");
		top.setAttribute("x","0"); top.setAttribute("y","0");
		top.setAttribute("width", String(bounds.width));
		top.setAttribute("fill", HORIZON_CFG.topTint);
		top.setAttribute("pointer-events","none");
		g.appendChild(top);

		const bot = makeSVG("rect");
		bot.setAttribute("x","0");
		bot.setAttribute("width", String(bounds.width));
		bot.setAttribute("fill", HORIZON_CFG.botTint);
		bot.setAttribute("pointer-events","none");
		g.appendChild(bot);

		const line = makeSVG("line");
		line.setAttribute("stroke", HORIZON_CFG.line);
		line.setAttribute("stroke-width", String(HORIZON_CFG.lineWidth));
		line.setAttribute("x1","0"); line.setAttribute("x2", String(bounds.width));
		line.setAttribute("pointer-events","none");
		g.appendChild(line);

		// fat invisible hit zone
		const hit = makeSVG("rect");
		hit.setAttribute("x","0");
		hit.setAttribute("height", String(HORIZON_CFG.hit*2));
		hit.setAttribute("width", String(bounds.width));
		hit.setAttribute("fill","transparent");
		hit.style.cursor = "ns-resize";
		g.appendChild(hit);

		// ----- Hint (arrows on the line + bubble above + mouse left) -----
		const hint = makeSVG("g"); hint.classList.add("pd-hintGroup"); hint.style.pointerEvents="none"; g.appendChild(hint);

		// arrows share the SAME base on the line (y=0 in local coords)
		const arrows = makeSVG("g");
		const up = makeSVG("polygon");   // ▲ apex up, base y=0
		up.setAttribute("points","0,-14 8,0 -8,0");
		up.setAttribute("fill","#61b5ff");
		const dn = makeSVG("polygon");   // ▼ apex down, base y=0
		dn.setAttribute("points","0,14 8,0 -8,0");
		dn.setAttribute("fill","#ff7a7a");
		arrows.appendChild(up); arrows.appendChild(dn);
		hint.appendChild(arrows);

		// yellow bubble ABOVE the line, with a DOWNWARD tail whose apex is on the line
		const bubble = makeSVG("rect"); bubble.setAttribute("rx","6"); bubble.setAttribute("class","pd-hintBubble");
		const notch  = makeSVG("polygon"); notch.setAttribute("class","pd-hintNotch");
		const txt = makeSVG("text"); txt.setAttribute("class","pd-hintText");
		txt.setAttribute("dominant-baseline","middle");
		txt.setAttribute("text-anchor","end");          // bubble & text sit to the LEFT
		txt.textContent = "Adjust Horizon";
		hint.appendChild(bubble); hint.appendChild(notch); hint.appendChild(txt);

		// mouse icon to the LEFT of the bubble (no overlap)
		const mouse = makeSVG("g"); mouse.setAttribute("class","pd-mouse");
		const body = makeSVG("rect"); body.setAttribute("x","-24"); body.setAttribute("y","-12"); body.setAttribute("rx","5");
		body.setAttribute("width","18"); body.setAttribute("height","24");
		const leftBtn = makeSVG("rect"); leftBtn.setAttribute("class","pd-mouse-left");
		leftBtn.setAttribute("x","-24"); leftBtn.setAttribute("y","-12"); leftBtn.setAttribute("width","9"); leftBtn.setAttribute("height","7");
		mouse.appendChild(body); mouse.appendChild(leftBtn);
		hint.appendChild(mouse);

		// Position bubble+tail ABOVE and LEFT of the line origin.
		function layoutHint(xPos, yPos){
			hint.setAttribute("transform", `translate(${xPos} ${yPos})`);
			arrows.setAttribute("transform","translate(0,0)"); // triangles on the line

			// bubble metrics (bubble sits ABOVE the line)
			const padX=10, padY=6, gapAbove=10, LEFT_SHIFT=20;
			// Use a reasonable expected size if getBBox is unavailable at first paint
			const tb = txt.getBBox ? txt.getBBox() : { width: 110, height: 16 };

			// Bubble geometry
			const bubbleW = tb.width + padX*2;
			const bubbleH = tb.height + padY*2;
			const bubbleLeft = -16 - padX - tb.width - LEFT_SHIFT; // 20px left of arrows
			const bubbleTop  = -(gapAbove + bubbleH);              // above the line
			bubble.setAttribute("x", String(bubbleLeft));
			bubble.setAttribute("y", String(bubbleTop));
			bubble.setAttribute("width",  String(bubbleW));
			bubble.setAttribute("height", String(bubbleH));

			// Center text within the bubble
			txt.setAttribute("text-anchor","middle");
			const cx = bubbleLeft + bubbleW/2;
			const cy = bubbleTop  + bubbleH/2 + 0.5; // slight optical nudge
			txt.setAttribute("x", String(cx));
			txt.setAttribute("y", String(cy));

			// DOWNWARD tail: base on bubble bottom, apex at the line (0,0)
			const baseY = -gapAbove; // bubble bottom
			const tailBaseX = bubbleLeft + bubbleW - 10; // near right edge of bubble
			const tailHalf = 8;
			notch.setAttribute("points", `0,0 ${tailBaseX+tailHalf},${baseY} ${tailBaseX-tailHalf},${baseY}`);

			// mouse to the LEFT of the bubble, vertically centered with it
			mouse.setAttribute("transform", `translate(${bubbleLeft - 22} ${bubbleTop + bubbleH/2})`);
		}

		function position(yPos, xPos){
			top.setAttribute("height", String(yPos));
			bot.setAttribute("y", String(yPos));
			bot.setAttribute("height", String(bounds.height - yPos));
			line.setAttribute("y1", String(yPos)); line.setAttribute("y2", String(yPos));
			hit.setAttribute("y", String(yPos - HORIZON_CFG.hit));
			layoutHint((typeof xPos === "number" ? xPos : 22), yPos);
		}

		position(y);
		return { group:g, top, bot, line, hit, hint, position, layoutHint };
	}

	function ensureRedX(svg){
		let x = svg.querySelector("path.pd-redx");
		if (!x){
			x = makeSVG("path"); x.setAttribute("class","pd-redx"); x.style.pointerEvents="none";
			svg.appendChild(x);
		}
		return x;
	}

	function setHintVisible(s, show, blink=false){
		if (!s.horizonGroup?.hint) return;
		const grp = s.horizonGroup.hint;
		grp.style.opacity = show ? "1" : "0";
		const bub = grp.querySelector('.pd-hintBubble');
		const txt = grp.querySelector('.pd-hintText');
		[grp, bub, txt].forEach(el => {
			if (!el) return;
			if (blink) el.classList.add("pd-softblink");
			else       el.classList.remove("pd-softblink");
		});
	}

	function setButtonsState(s){
		const adj = document.getElementById("adjustHorizonBtn");
		const dr  = document.getElementById("beginDrawBtn");

		if (adj){
			const label = adj.querySelector(".overlay-label");
			if (label) label.textContent = (s.phase === "horizon") ? "Adjusting horizon..." : "Adjust Horizon";
			// flash yellow while actively adjusting
			if (s.phase === "horizon") adj.classList.add("pd-flash");
			else                       adj.classList.remove("pd-flash");
		}

		if (dr){
			const label = dr.querySelector(".overlay-label");
			if (label) label.textContent = (s.phase === "draw") ? "Drawing..." : "Draw";
			// flash yellow when we want to attract attention to Draw
			if (s.drawFlash) dr.classList.add("pd-flash"); else dr.classList.remove("pd-flash");
		}
	}

  const PathDrawer = {
    _state: {
      drawMode:false,
      canvas:null,
      svg:null,
      clicks:[],
      centerline:[],
      chevLayer:null,
			previewEl: null,
			ignoreNextClick: false,
			horizonY: null,
			horizonGroup: null,
			horizonDrag: false,
			phase: "idle",        // "horizon" | "draw" | "idle"
			redX: null,
      hintX: 22,
			drawFlash: false,			
    },

    _rebuildCenterline(bounds){
      const s = this._state;
      if (!s.clicks.length){ s.centerline=[]; return; }
      const raw = sampleCatmullRom(s.clicks, samplesPerSegment);
      const cleaned=[];
      for (const p of raw){
        const last=cleaned[cleaned.length-1];
        if (!last || Math.hypot(p.x-last.x, p.y-last.y) >= 1.0) cleaned.push(p);
      }
      s.centerline = cleaned;
    },
		
		_draw(showStopOnly = false){
			const s = this._state;
			const svg = s.svg;
			if (!svg) return;

			clearOverlay(svg);
			s.previewEl = null;

			const bounds = getSurfaceBounds(svg) || getSurfaceBounds(s.canvas);
			if (!bounds) return;

			// ---- horizon (always visible while in draw mode) ----
			if (s.drawMode){
				if (s.horizonY == null) s.horizonY = Math.round(bounds.height * HORIZON_CFG.defaultFrac);
				s.horizonGroup = buildHorizonGroup(svg, bounds, s.horizonY);
				// keep current hint X on first layout (no snap-left)
				if (s.horizonGroup?.position) s.horizonGroup.position(s.horizonY, s.hintX || 22);
			}

			// ---- lane (only draws below the horizon) ----
			if ((s.centerline?.length || 0) > 1){
				const edges = buildLaneEdgesClamped(s.centerline, bounds, s.horizonY);
				const edgesFixed = fixOffsetJoins(edges);
				drawLaneStrip(svg, edgesFixed);

				const mkEdgeStroke = (pts) => {
					const pl = makeSVG("polyline");
					pl.setAttribute("points", pts.map(p => `${p.x},${p.y}`).join(" "));
					pl.setAttribute("fill","none");
					pl.setAttribute("stroke", drawConfig.outlineStroke);
					pl.setAttribute("stroke-width", String(drawConfig.outlineStrokeWidth));
					pl.setAttribute("stroke-linejoin","miter");
					pl.setAttribute("stroke-miterlimit","2");
					pl.setAttribute("stroke-linecap","butt");
					pl.setAttribute("vector-effect","non-scaling-stroke");
					pl.setAttribute("pointer-events","none");
					return pl;
				};
				svg.appendChild(mkEdgeStroke(edgesFixed.left));
				svg.appendChild(mkEdgeStroke(edgesFixed.right));

				const center = appendCenterline(svg, s.centerline, { dash: drawConfig.centerDash, strokeWidth: drawConfig.centerStrokeWidth });
				if (center) center.setAttribute("pointer-events","none");

				s.chevLayer = drawConfig.showChevrons
					? appendChevronStream(svg, s.centerline, bounds, { laneLeft:edgesFixed.left, laneRight:edgesFixed.right })
					: null;
			} else if ((s.clicks?.length || 0) > 0){
				const preview = sampleCatmullRom(s.clicks, samplesPerSegment);
				const pl = makeSVG("polyline");
				pl.setAttribute("points", preview.map(p => `${p.x},${p.y}`).join(" "));
				pl.setAttribute("fill","none");
				pl.setAttribute("stroke", drawConfig.outlineStroke);
				pl.setAttribute("stroke-width","1.6");
				pl.setAttribute("stroke-dasharray", drawConfig.previewDash);
				pl.setAttribute("stroke-linecap","round");
				pl.setAttribute("stroke-linejoin","round");
				pl.setAttribute("vector-effect","non-scaling-stroke");
				pl.setAttribute("pointer-events","none");
				pl.classList.add("preview-centerline");
				s.previewEl = pl; svg.appendChild(pl);
			}

			this._updateButtons(showStopOnly);
		},


		_updateButtons(showStopOnly=false){
			const s=this._state;

			// --- Toolbar buttons next to Wipe (same container/markup as index.html) ---
			const toolbar = document.getElementById("wipePathBtn")?.parentElement; // the .right overlay host
			const rm = id => document.getElementById(id)?.remove();

			if (!s.drawMode || !toolbar){
				rm("adjustHorizonBtn"); rm("beginDrawBtn");
			} else {
				// (re)create “Adjust Horizon”
				rm("adjustHorizonBtn");
				const adj = document.createElement("div");
				adj.id = "adjustHorizonBtn";
				adj.className = "overlay-bottomright pd-toolbar-btn";
				adj.style.bottom = "200px";     // same row as Wipe
				adj.style.right  = "130px";     // moved 40px to the right (170 -> 130)
				adj.style.pointerEvents = "auto";
				adj.innerHTML = `
					<svg class="overlay-icon" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="2"/>
						<polygon points="12,6 15,12 9,12" fill="currentColor"/>
						<polygon points="12,18 9,12 15,12" fill="currentColor"/>
					</svg>
					<span class="overlay-label">Adjust Horizon</span>`;
				adj.onclick = () => {
					s.phase = "horizon";
					s.drawFlash = false;
					document.body.style.cursor = "ns-resize";
					setHintVisible(s, true, true);
					setButtonsState(s);
				};
				toolbar.appendChild(adj);

				// ensure initial label based on current phase
				setButtonsState(s);

				// (re)create “Draw”
				rm("beginDrawBtn");
				const dr = document.createElement("div");
				dr.id = "beginDrawBtn";
				dr.className = "overlay-bottomright pd-toolbar-btn";
				dr.style.bottom = "200px";
				dr.style.right  = "330px"; // temp; recalculated below
				dr.style.pointerEvents = "auto";
				dr.innerHTML = `
					<svg class="overlay-icon" viewBox="0 0 24 24" aria-hidden="true">
						<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>
						<path fill="currentColor" d="M20.71 7.04a1 1 0 0 0 0-1.41L18.37 3.3a1 1 0 0 0-1.41 0L15.13 5.13l3.75 3.75 1.83-1.83z"/>
					</svg>
					<span class="overlay-label">Draw</span>`;
				dr.onclick = (ev) => {
					ev.stopPropagation();
					s.ignoreNextClick = true;

					const bounds = getSurfaceBounds(s.svg) || getSurfaceBounds(s.canvas);
					if (s.clicks.length===0 && bounds){
						const anchor = { x: bounds.width/2, y: bounds.height - 1 };
						const lift   = Math.max(40, Math.floor(bounds.height * 0.06));
						const p1     = { x: anchor.x, y: Math.max(s.horizonY+4, anchor.y - lift) };
						s.clicks=[anchor,p1];
						PathDrawer._rebuildCenterline(bounds);
					}
					s.phase="draw";
					s.drawFlash = false;
					setHintVisible(s, false, false);
					setButtonsState(s);
					document.body.style.cursor="crosshair";
					PathDrawer._draw(false);
				};
				toolbar.appendChild(dr);

				// Auto-position Draw based on Adjust's width (keeps a neat gap)
				requestAnimationFrame(() => {
					const adjRight = 130;     // Adjust's distance from right edge
					const gapPx    = 16;      // space between the two buttons
					const adjW     = adj.offsetWidth || 160;
					adj.style.right = adjRight + "px";
					dr.style.right  = (adjRight + adjW + gapPx) + "px";
				});
			}


			// --- Floating START/STOP (unchanged behavior) ---
			const btns=document.getElementById("pathControlButtons");
			if (!btns) return;

			["startButton","stopButton"].forEach(id => document.getElementById(id)?.remove());

			const clickCount = s.clicks?.length || 0;
			const centerlineCount = s.centerline?.length || 0;
			const hasUserPath = (clickCount >= 3) || (centerlineCount >= 3);
			const canSendPath = s.phase === "draw" && hasUserPath;

			if ((!showStopOnly || canSendPath) && canSendPath){
				const b=document.createElement("button");
				b.id="startButton"; b.textContent="START";
				b.onclick=()=>{
					const pathToSend = (s.centerline?.length>1) ? s.centerline : s.clicks;
					try{
						if (window.websocketCarInput && window.websocketCarInput.readyState===1){
							window.websocketCarInput.send("PATH,"+JSON.stringify(pathToSend));
							window.showToast?.("▶️ Path sent");
						} else window.showToast?.("Robot WS not connected", true);
					}catch(e){ console.warn("send PATH failed", e); }
				};
				btns.appendChild(b);
			}

			if ((centerlineCount)>1){
				const last=s.centerline[s.centerline.length-1];
				const b=document.createElement("button");
				b.id="stopButton"; b.textContent="STOP";
				b.onclick=()=>{
					try{
						if (window.websocketCarInput && window.websocketCarInput.readyState===1){
							window.websocketCarInput.send("PATH_STOP");
							window.showToast?.("⛔ Path stop sent");
						} else window.showToast?.("Robot WS not connected", true);
					}catch(e){ console.warn("send PATH_STOP failed", e); }
				};
				b.style.position="absolute";
				b.style.left=`${last.x}px`; b.style.top=`${last.y}px`;
				b.style.transform="translate(-50%,-120%)";
				b.style.pointerEvents="auto";
				btns.appendChild(b);
			}
			setButtonsState(s);
		},

		_onMouseMove: (e) => {
			const s = PathDrawer._state;
			if (!s.drawMode) return;

			const bounds = getSurfaceBounds(s.svg) || getSurfaceBounds(s.canvas);
			if (!bounds) return;

			const x = e.clientX - bounds.x;
			const y = e.clientY - bounds.y;

			// Horizon adjust phase / dragging
			if (s.phase === "horizon" || s.horizonDrag){
				const near = Math.abs(y - s.horizonY) <= HORIZON_CFG.hit * 1.5;
				// move hint to cursor when near the line
			if (s.horizonGroup?.layoutHint && near){
				s.hintX = clamp(x, 40, bounds.width - 160);
				s.horizonGroup.layoutHint(s.hintX, s.horizonY);
			}
				if (s.horizonDrag){
					const yNew = clamp(y, bounds.height*HORIZON_CFG.minFrac, bounds.height*HORIZON_CFG.maxFrac);
					s.horizonY = yNew;
					if (s.horizonGroup?.position) s.horizonGroup.position(yNew, s.hintX);
				}
				return; // don't draw preview while adjusting
			}

			// Draw phase preview — clamp to horizon
			if ((s.clicks?.length || 0) > 0 && s.phase === "draw") {
				const minY = s.horizonY + 1;  // small gap so we never cross the line
				const yClamped = Math.max(y, minY);

			 const tooHigh = y < minY;
			 s.redX = s.redX || ensureRedX(s.svg);
			 const sz = 10;
			 s.redX.setAttribute("d", tooHigh
				 ? `M ${x-sz} ${y-sz} L ${x+sz} ${y+sz} M ${x+sz} ${y-sz} L ${x-sz} ${y+sz}`
				 : ""
			 );
			 document.body.style.cursor = tooHigh ? "not-allowed" : "crosshair";

				const preview = sampleCatmullRom(s.clicks.concat({ x, y: yClamped }), samplesPerSegment);

				if (s.previewEl && s.previewEl.parentNode) s.previewEl.parentNode.removeChild(s.previewEl);
				const pl = makeSVG("polyline");
				pl.setAttribute("points", preview.map(p => `${p.x},${p.y}`).join(" "));
				pl.setAttribute("fill","none");
				pl.setAttribute("stroke", tooHigh ? "#ff4040" : drawConfig.outlineStroke);
				pl.setAttribute("stroke-width","1.6");
				pl.setAttribute("stroke-dasharray", drawConfig.previewDash);
				pl.setAttribute("stroke-linecap","round");
				pl.setAttribute("stroke-linejoin","round");
				pl.setAttribute("vector-effect","non-scaling-stroke");
				pl.setAttribute("pointer-events","none");
				pl.classList.add("preview-centerline");
				s.previewEl = pl; s.svg.appendChild(pl);

				PathDrawer._updateButtons(true);
			}
		},

		_onMouseDown: (e) => {
			const s = PathDrawer._state;
			if (!s.drawMode) return;
			if (e.button !== 0) return;
			const bounds = getSurfaceBounds(s.svg) || getSurfaceBounds(s.canvas);
			if (!bounds) return;
			const y = e.clientY - bounds.y;
			if (s.phase === "horizon" && Math.abs(y - s.horizonY) <= HORIZON_CFG.hit*1.5) {
				s.horizonDrag = true;
				setHintVisible(s, true, true);   // show with blink
				s.drawFlash = false;
				setButtonsState(s);              // "Adjusting horizon..."
			}
		},

		_onMouseUp: () => {
			const s = PathDrawer._state;
			if (!s.drawMode) return;
			if (s.horizonDrag){
				s.horizonDrag = false;
				setHintVisible(s, false, false);  // fade out
				s.drawFlash = true;               // start flashing the Draw button
				s.phase = "idle";                 // not drawing until they press Draw
				setButtonsState(s);               // Adjust → "Adjust Horizon", Draw flashes
			}
		},

		_onClick:(e)=>{
			const s=PathDrawer._state;
			if (!s.drawMode) return;
			if (s.ignoreNextClick) { s.ignoreNextClick = false; return; }
			if (e.button!==0) return;

			const bounds = getSurfaceBounds(s.svg) || getSurfaceBounds(s.canvas);
			if (!bounds) return;
			const x=e.clientX-bounds.x, y=e.clientY-bounds.y;

			if (s.phase !== "draw") return; // ignore clicks until user hits "Draw"

			const minY = s.horizonY + 1;
			if (y < minY) return; // cannot place points above horizon

			const last=s.clicks[s.clicks.length-1];
			if (!last || Math.hypot(x-last.x, y-last.y) >= 1.0){
				s.clicks.push({x, y: Math.max(y, minY)});
				PathDrawer._rebuildCenterline(bounds);
				PathDrawer._draw();
			}
		},


		_onContextMenu: (e) => {
			const s = PathDrawer._state;
			if (!s.drawMode) return;
			e.preventDefault();

			const hostRect = (s.svg?.getBoundingClientRect?.() || s.canvas?.getBoundingClientRect?.());
			const bounds   = getSurfaceBounds(s.svg) || getSurfaceBounds(s.canvas);
			if (hostRect && bounds) {
				const x = e.clientX - hostRect.left;
				const y = e.clientY - hostRect.top;
				const yClamped = Math.max(y, s.horizonY + 1);   // <-- keep below horizon
				const last = s.clicks[s.clicks.length - 1];
				if (!last || Math.hypot(x - last.x, yClamped - last.y) >= 1) {
					s.clicks.push({ x, y: yClamped });
				}
				PathDrawer._rebuildCenterline(bounds);
			}
			if (s.drawMode) PathDrawer.toggle();
		},



		toggle(){
			const s = this._state;
			s.drawMode = !s.drawMode;

			const btn = document.getElementById("drawPathBtn");
			if (btn){
				btn.style.backgroundColor = s.drawMode ? "#4CAF50" : "#444";
				btn.innerText = s.drawMode ? "✏️ Drawing..." : "✏️ Draw Path";
			}

			s.canvas = document.getElementById("drawingCanvas");
			s.svg    = document.getElementById("drawingOverlay");

			if (s.drawMode){
				if (s.canvas){
					s.canvas.width = window.innerWidth;
					s.canvas.height = window.innerHeight;
					s.canvas.style.pointerEvents = "auto";
					s.canvas.style.cursor = "crosshair";
					s.canvas.style.zIndex = "20";
				}

				// reset
				s.clicks=[]; s.centerline=[];
				s.phase = "horizon";      // <— user adjusts horizon first
				s.horizonY = null;        // will be set in _draw
				s.redX = ensureRedX(s.svg); if (s.redX) s.redX.setAttribute("d","");

				window.addEventListener("mousemove", this._onMouseMove, { passive: true });
				window.addEventListener("mousedown", this._onMouseDown);
				window.addEventListener("mouseup", this._onMouseUp);
				window.addEventListener("click", this._onClick);
				window.addEventListener("contextmenu", this._onContextMenu);

				this._draw(false); // draws horizon & buttons immediately
			} else {
				window.removeEventListener("mousemove", this._onMouseMove);
				window.removeEventListener("mousedown", this._onMouseDown);
				window.removeEventListener("mouseup", this._onMouseUp);
				window.removeEventListener("click", this._onClick);
				window.removeEventListener("contextmenu", this._onContextMenu);
				document.body.style.cursor = "default";
				if (s.canvas){
					s.canvas.style.pointerEvents = "none";
					s.canvas.style.cursor = "default";
				}
				this._draw(true);
			}
		}


  };

  window.PathDrawer = PathDrawer;

	window.stopDrawing = (e) => {
		if (e?.preventDefault) e.preventDefault();
		if (window.PathDrawer?._state?.drawMode) window.PathDrawer.toggle();
	};


	window.toggleDrawMode = () => window.PathDrawer.toggle();

	window.clearDrawing = () => {
		const s = window.PathDrawer?._state;
		if (!s) return;
		s.clicks = [];
		s.centerline = [];
		s.phase = "idle";
		s.horizonY = null;   // reset to default next time (50%)
		if (s.svg) clearOverlay(s.svg);
		const btns = document.getElementById("pathControlButtons");
		if (btns) btns.innerHTML = "";
		if (s.drawMode) window.PathDrawer.toggle(); // exit draw mode if active
	};




  console.info("[PathDrawer] Loaded OK.");
})();
